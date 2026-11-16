# AI flashcard generation

Milestone 10 turns study material into flashcards. A signed-in user pastes notes, reads in a
document or picks one of their decks, chooses the kind, difficulty and number of cards, and gets a
list of generated cards to review, edit, regenerate, select and save. **Nothing is saved until the
user saves it**, and saved cards are ordinary Snap Notes cards.

- [How it works](#how-it-works)
- [Using it](#using-it)
- [Card types and how they are saved](#card-types-and-how-they-are-saved)
- [Documents](#documents)
- [Quality checks](#quality-checks)
- [Limits](#limits)
- [Security and privacy](#security-and-privacy)
- [Setting up a provider](#setting-up-a-provider)
- [Local development](#local-development)
- [Testing](#testing)
- [Known limitations](#known-limitations)

## How it works

```
Browser (static site)                     Supabase project
┌──────────────────────────────┐          ┌─────────────────────────────────────────────┐
│ Generate page                │  HTTPS   │ Edge Function generate-flashcards           │
│  material, settings ─────────┼─ (JWT) ─►│  1. size + shape of the request (zod)       │
│  review list (reducer)       │          │  2. who is asking   ── auth server          │
│  documents read locally      │          │  3. allowance       ── ai_generation_begin()│
│  (PDF.js, ZIP, DOMParser)    │◄─────────┼─ 4. provider (Claude) with JSON schema      │
│ save → addCards → sync       │  cards   │  5. every card checked (quality.ts)         │
└──────────────────────────────┘          └─────────────────────────────────────────────┘
```

| Path                                                         | What it is                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `supabase/functions/generate-flashcards/index.ts`            | The Edge Function's entry point: reads secrets, starts the server  |
| `supabase/functions/_shared/flashcards/contract.ts`          | Request/reply schemas, limits and card rules, shared with the app  |
| `supabase/functions/_shared/flashcards/handler.ts`           | The request handler: validation, auth, allowance, provider, checks |
| `supabase/functions/_shared/flashcards/prompt.ts`            | The system prompt, the user message and the reply's JSON Schema    |
| `supabase/functions/_shared/flashcards/quality.ts`           | Grounding, duplicate and completeness checks on every card         |
| `supabase/functions/_shared/flashcards/provider.ts`          | The provider interface; `anthropic.ts` implements it               |
| `supabase/migrations/20261116000000_ai_generation_quota.sql` | The per-account allowance                                          |
| `src/cloud/generation.ts`                                    | The app's generation client interface and reply validation         |
| `src/documents/`                                             | Text, PDF and Word extraction in the browser                       |
| `src/domain/generatedCards.ts`                               | Card types → term/definition, and adding cards to a deck           |
| `src/ui/generate/`                                           | The Generate page, its review list and its state                   |

**Why an Edge Function.** The site is static, and an AI provider key must never reach a browser.
Supabase already authenticates every user, so a function in the same project can check the
caller's token, count their requests in Postgres, and call the provider with a key kept in the
project's secrets. Nothing else needs hosting. The handler is a plain `Request → Response`
function with everything it talks to passed in, so the same code runs in Deno and in the app's
test suite.

**Provider-neutral.** The handler sees an `AiProvider` with one method: given a system prompt,
a message and a JSON Schema, return JSON text. The browser and the handler never know which
provider is behind it; `AI_PROVIDER` chooses. Anthropic is the one provider implemented today,
through the official SDK, using structured outputs (the reply must match the schema), an
explicit effort level, and server-side fallback when the model declines on a policy ground.

## Using it

**Generate** appears in the navigation when the build has a backend (and on each deck's page as
_Generate cards with AI_, which preselects that deck). Without a backend the link is hidden and
the page explains why; signed out, it asks the user to sign in.

1. **Material.** Paste or type up to 30,000 characters; read a document (below); or add a deck's
   cards as `term: definition` lines, for example to turn them into multiple-choice cards.
2. **Settings.** Optional topic; card type (question and answer, term and definition, multiple
   choice, fill in the blank, or mixed); difficulty (easy, medium, hard or mixed); 5–30 cards;
   and the deck to save to, existing or new.
3. **Generate.** Progress shows while it runs (usually 15–60 s), with _Cancel_. Repeated clicks
   are ignored. A failure explains itself and offers _Try again_, which resends exactly the same
   request; a used-up allowance says when to come back.
4. **Review.** Every card can be edited (question, answer, choices and which is correct), changed
   to another type, regenerated on its own, removed, or ticked/unticked. _Generate more cards_
   adds 3, 5 or 10 that avoid the questions already listed. Each card can show the passage of the
   material it came from. The list shows how many cards were generated, selected and saved, and
   why any asked-for cards were left out.
5. **Save.** Selected cards go into the chosen deck in one write. A card that cannot be saved yet
   (an empty answer, a missing blank, no correct choice) is marked and blocks the save until it is
   fixed or unticked. Saved cards are locked in the list, with a link to edit them like any card,
   and the page offers to study them straight away.

Generating a new set while unsaved cards are listed asks first, and so does leaving the page.

## Card types and how they are saved

Snap Notes has one kind of card, with a term and a definition, used by every study mode, sync and
analytics. **Generated cards are saved as ordinary cards**, so nothing else had to change and a
saved card can be edited, moved, deleted, reviewed and synced like any other:

| Type                | Term (front)                                     | Definition (back)          |
| ------------------- | ------------------------------------------------ | -------------------------- |
| Question and answer | The question                                     | The answer                 |
| Term and definition | The term                                         | The definition             |
| Multiple choice     | The question, a blank line, then `A. …` `B. …` … | The correct option: `B. …` |
| Fill in the blank   | The sentence with `_____`                        | The missing word           |

Saving never duplicates: a card whose term and definition (ignoring case and spacing) are already
in the deck is skipped and reported, and a saved card in the review list cannot be saved again.
New decks are created in the same write as their cards. Sync uploads the new cards like any other
change, under their own IDs, so a retried upload cannot duplicate them either.

Saved cards start as **new** for spaced repetition and appear in Review's _Learn new cards_; once
studied in any mode they count in Analytics like every other card.

## Documents

Documents are read **in the browser**; the file itself is never uploaded. Only the extracted text,
which the user can see and edit first, is sent when they choose to generate.

| Format        | How it is read                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `.txt`, `.md` | UTF-8, or UTF-16 with a byte-order mark                                                                    |
| `.pdf`        | [PDF.js](https://mozilla.github.io/pdf.js/), loaded only when a PDF is chosen                              |
| `.docx`       | The ZIP archive is read with the browser's `DecompressionStream`, and `word/document.xml` with `DOMParser` |

- **The contents decide the type, not the name.** The first bytes are checked (`%PDF-`, a ZIP
  archive, valid text), and a file whose name and contents disagree is refused with an
  explanation. Old `.doc` files and every other format are refused with a suggestion.
- **Limits:** 10 MB per file; 300 PDF pages; 200,000 characters of extracted text (more is cut
  off, and the user is told). The editor then holds the text, and anything over the 30,000
  character generation limit can be trimmed with one click.
- **Nothing in a file runs.** PDF.js runs with JavaScript evaluation and XFA forms off. ZIP entries
  are size-checked before and during decompression (so a small file cannot expand without limit)
  and checked against their CRC-32. Word XML with a `DOCTYPE` (entity tricks) is refused.
- Empty, password-protected, damaged, and scanned (image-only) files each get their own message.

## Quality checks

The prompt asks for grounded, distinct, clearly worded cards that test understanding, keep
technical terms and quote their evidence. The server then **checks** every card rather than
trusting the prompt:

- **Shape:** each card must match the schema, and the rules in `cardProblem` (non-empty question
  and answer within length limits; exactly one `_____` in a fill-in-the-blank card that does not
  contain its own answer; 3–5 distinct options with exactly one equal to the answer).
- **Grounding:** each card's `evidence` must be found in the material: an exact quote ignoring
  case, spacing and punctuation, or a close one (three in four of its word pairs present). A card
  based on anything else is dropped as _not supported by your material_.
- **Duplicates:** cards whose questions share most of their content words (ignoring words such as
  _the_ or _what_), or that have the same answer and similar questions, are dropped, including
  repeats of questions already in the review list.
- **Multiple-choice options are shuffled**, so the correct one is not always first.
- **A reply that is not JSON, has no card list, or was cut off** by the output limit is refused as
  a whole, with a message suggesting fewer cards.

The reply tells the app how many cards were dropped and why, and the page says so.

## Limits

| Limit                  | Value                                        | Enforced          |
| ---------------------- | -------------------------------------------- | ----------------- |
| Material               | 40–30,000 characters                         | Server (and page) |
| Cards per request      | 1–30                                         | Server (and page) |
| Topic                  | 120 characters                               | Server (and page) |
| Request body           | 200 KB, checked while reading                | Server            |
| Requests per account   | 20 per rolling hour, 60 per rolling 24 hours | Postgres          |
| Provider request       | 60 s, one automatic retry                    | Server            |
| Waiting in the browser | 150 s                                        | Page              |

The allowance is counted by `ai_generation_begin()` before the provider is contacted, using the
caller's own token: it cannot be raised from the browser, and a user calling it directly only uses
up their own allowance. A status check, an invalid request, or a server with no provider
configured never uses any. Each request's time (only) is kept for 24 hours, then deleted; rows
are removed with the account. There is no billing or subscription.

## Security and privacy

- **Keys stay on the server.** The provider key is an Edge Function secret. The browser holds only
  the publishable key and the user's own session, as before. No key or `.env` file is committed.
- **Authentication first.** The function checks the caller's token with the auth server before
  doing anything with the request, and the database checks it again when counting. The gateway's
  own JWT check is off (`verify_jwt = false` in `supabase/config.toml`) because it does not
  support asymmetric signing keys; every request is authenticated by the function instead.
- **Validation everywhere.** Requests are parsed with strict zod schemas (unknown fields are
  refused, so no user ID can be injected). Replies are validated again in the browser.
- **Prompt injection.** Study material and existing questions are untrusted data. They are placed
  in delimited blocks that the text cannot close or open (`neutralizeTags`), the system prompt
  tells the model that instructions inside them are just text, the topic is JSON-quoted, and the
  model's reply is constrained by a schema and then checked card by card. The model holds no
  secrets and has no tools, so an injected instruction can at worst produce cards, which are then
  checked against the material and reviewed by the user before being saved.
- **No content in logs.** The function logs outcomes, counts and timings only.
- **Disclosure.** The page says, before generating, that the text is sent through Snap Notes'
  server to the named provider, that Snap Notes does not store it, that documents are read on the
  device, and that AI-written cards can contain mistakes and should be checked.
- **Ownership.** Saved cards are written by the existing data layer and synced by the existing
  sync functions, so Row Level Security and every Milestone 8 rule apply unchanged.
- **CORS.** Any origin may call the function by default, because requests are authorised by the
  bearer token, not cookies. Set `AI_ALLOWED_ORIGINS` to restrict browsers to listed origins.

## Setting up a provider

Generation is off until a provider key is set; the page then says it is not set up. On a hosted
project (after the [backend setup](accounts-and-sync.md#setting-up-a-hosted-backend)):

```bash
npx supabase@2.122.0 db push                                       # adds ai_generation_begin()
npx supabase@2.122.0 secrets set ANTHROPIC_API_KEY=<your key>
npx supabase@2.122.0 functions deploy generate-flashcards
```

| Secret (Edge Function) | Required | Meaning                                                         |
| ---------------------- | -------- | --------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`    | Yes      | The provider's API key. Without it, generation is switched off. |
| `AI_PROVIDER`          | No       | `anthropic` (the default, and the only provider implemented).   |
| `AI_MODEL`             | No       | A model ID to use instead of the default, `claude-opus-5-5`.    |
| `AI_ALLOWED_ORIGINS`   | No       | Comma-separated origins, e.g. `https://abbas-4.github.io`.      |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided to every Edge Function by Supabase. The site's
build needs nothing new: it already knows the project URL. Requests go to the provider's API, so
its terms and data policies apply to the material sent.

## Local development

`npm run db:start` now also starts the Edge Runtime, which serves the function at
`http://127.0.0.1:54321/functions/v1/generate-flashcards`. Without a key it answers that
generation is not set up. To try real generation locally, put the key in a git-ignored file and
serve the function with it:

```bash
echo 'ANTHROPIC_API_KEY=<your key>' > supabase/functions/.env   # git-ignored (.env.*/.env)
npx supabase@2.122.0 functions serve generate-flashcards --env-file supabase/functions/.env
```

After pulling this milestone into an existing local stack, apply the new migration with
`npx supabase@2.122.0 migration up --local` (or `npm run db:reset`, which rebuilds the database).

## Testing

| Command                    | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                 | Contract rules; grounding and duplicate checks; prompt and injection handling; the handler (auth, allowance, validation, sizes, provider failures, timeouts, malformed replies, logging); the Anthropic provider through the real SDK with a scripted HTTP layer; document extraction (real TXT, DOCX and PDF files, damaged, encrypted, oversized, mismatched); the review reducer; the Generate page end to end, through saving, sync, Review and analytics |
| `npm run check:functions`  | Type-checks the Edge Function with Deno                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run test:integration` | The allowance in Postgres (20/hour, per account, private table), and the function served locally: authentication, validation, and "not set up" without using the allowance                                                                                                                                                                                                                                                                                    |

Live generation against a provider is not part of any automated test: it needs a real key and
costs money. The tests use a scripted provider and never present its output as real.

## Known limitations

- **Generation needs an account and a connection.** It is not available in a build without a
  backend, signed out, or offline.
- **Card types are stored as text.** A multiple-choice card is a term with lettered options and a
  definition naming the right one; Study, Learn and Review show it that way, but Quiz and Match
  treat it like any card (Quiz builds its own options from other cards' definitions). Changing a
  saved card's type means editing its text.
- **Scanned PDFs** (pictures of text) yield no text; there is no OCR. Headers, footers and
  comments in Word documents are not read. Older `.doc`, `.pptx`, images and other formats are not
  supported.
- **Grounding is checked against the quoted evidence**, not the whole card: a card can quote a real
  passage and still draw a wrong conclusion from it. Review remains essential, and the page says so.
- **Duplicate detection is word-based** and tuned for English function words; in other languages
  it compares every word, which catches less rewording.
- **The allowance is fixed in SQL** (20/hour, 60/day). Changing it is a new migration.
- **Generated cards are not kept between visits** until saved: reloading the page loses the
  review list (the page warns before leaving).
