# Snap Notes

[![CI](https://github.com/abbas-4/Snap-Notes/actions/workflows/ci.yml/badge.svg)](https://github.com/abbas-4/Snap-Notes/actions/workflows/ci.yml)

Snap Notes is a flashcard and study app. You write cards with a term and a definition, then
review them in five modes:

- **Review**: spaced repetition. Each card comes back when you are about to forget it, and your progress is saved.
- **Study**: flip through cards one at a time.
- **Quiz**: multiple-choice questions built from your own definitions.
- **Learn**: reveal each definition and say whether you knew it; cards you miss come back until you know them.
- **Match**: pair terms with their definitions against the clock.

Cards are kept in **decks**, so a subject can be studied on its own.

**Live app:** <https://abbas-4.github.io/Snap-Notes/>

## Project status

The original app is a single HTML file ([`legacy/index.html`](legacy/index.html)) that keeps
cards in the browser's `localStorage`. It is being rebuilt as a typed, tested React application,
one small milestone at a time. **The live site still serves the original app, unchanged.** The
rebuild has reached feature parity and can migrate existing cards safely; the last step of
Milestone 5 is the switch that publishes it at the same address (see [Deployment](#deployment)).

| Milestone | Scope                                                                                | Status                                               |
| --------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| 1         | Tooling, domain types, storage layer, `migrateV1()`, import/export validation, CI    | ✅ Done                                              |
| 2         | React UI: layout, navigation, Home, List, Add/Edit, import/export                    | ✅ Done                                              |
| 3         | Study and Quiz modes (keyboard accessible, no timing races)                          | ✅ Done                                              |
| 4         | Learn and Match modes                                                                | ✅ Done                                              |
| 5         | Cutover: deploy the new app at the same URL, migrate data on first load, smoke tests | 🚧 Migration and recovery built; site switch pending |
| 6         | Decks: create, rename, delete, move cards between decks, and study one deck          | ✅ Done                                              |
| 7         | Spaced repetition, saved learning progress, review dashboard and statistics          | ✅ Done                                              |
| 8+        | Backend (Node, Express, PostgreSQL, Prisma), accounts, sync across devices           | Later                                                |

A backend is deliberately left for later. Everything up to Milestone 7 works entirely in the
browser. A server becomes necessary only for features the browser can't provide: accounts,
syncing across devices, and sharing decks.

## Tech stack

- [React](https://react.dev) 19 and [TypeScript](https://www.typescriptlang.org) (strict mode)
- [Vite](https://vite.dev) for the dev server and builds
- [Tailwind CSS](https://tailwindcss.com) v4
- [React Router](https://reactrouter.com) in hash mode, so `#list`-style URLs keep working on GitHub Pages
- [Zod](https://zod.dev) to validate stored data and imported files
- [Vitest](https://vitest.dev) and [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- ESLint, Prettier, and GitHub Actions

## Getting started

You need Node.js 24 (see [`.nvmrc`](.nvmrc)); any version from 22.22 up works.

```bash
git clone https://github.com/abbas-4/Snap-Notes.git
cd Snap-Notes
npm ci
npm run dev
```

The dev server runs on `localhost`, which has its own `localStorage`, separate from the live
site, so local development never reads or changes cards saved on `abbas-4.github.io`.

To try the original app locally, open `legacy/index.html` in a browser.

### Scripts

| Command                           | What it does                                                |
| --------------------------------- | ----------------------------------------------------------- |
| `npm run dev`                     | Start the Vite dev server                                   |
| `npm test`                        | Run all tests once (`npm run test:watch` to re-run on save) |
| `npm run coverage`                | Run tests with a coverage report                            |
| `npm run lint`                    | Lint with ESLint                                            |
| `npm run format` / `format:check` | Format with Prettier / check formatting                     |
| `npm run typecheck`               | Type-check with `tsc`                                       |
| `npm run build`                   | Type-check and build into `dist/`                           |
| `npm run verify:legacy`           | Confirm `legacy/index.html` is byte-for-byte the original   |
| `npm run verify:site -- <dir>`    | Check an assembled site (or `--url` for the live one)       |

## Project structure

```
legacy/index.html       The original app, preserved unchanged and served on GitHub Pages
src/
  domain/               Pure TypeScript: data types, IDs, shuffle, quiz and match rounds, mode
                        sessions, the spaced repetition engine, review queues and statistics
  storage/              localStorage access, legacy migration, import/export, learning progress,
                        Zod schemas
  ui/                   React components: layout, pages, app-data provider
  test/                 Test setup and helpers (an in-memory Storage, app rendering)
  App.tsx, main.tsx     React entry point: routes and providers
scripts/                Repository scripts (legacy and site verification)
.github/workflows/      CI and GitHub Pages deployment
```

Code in `domain/` and `storage/` never touches the DOM or global state, so it can be tested
directly. Storage functions take the `Storage` object as an optional parameter, and tests use an
in-memory fake.

## Data and migration

|                  | Original app                                     | Rebuild                                                                 |
| ---------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| localStorage key | `abbas_flashcards_v1`                            | `snapnotes.data.v2`, plus `snapnotes.progress.v1` for learning progress |
| Shape            | `[{ id, term, definition, created?, updated? }]` | `{ schemaVersion: 2, decks, cards }`                                    |
| Export file      | The bare array                                   | `{ format: "snap-notes", schemaVersion: 2, exportedAt, decks, cards }`  |

The first time the rebuild opens in a browser that has cards from the original app, it moves
them over automatically:

- **The original key is never written to or deleted.** The legacy data stays in place as a
  backup, and the original app keeps working from it.
- Migration runs only when there is no `snapnotes.data.v2` data at all. Any existing v2 data,
  even an empty collection, always wins, so the migration happens once and never overwrites
  anything.
- `migrateV1()` ([`src/storage/migrations.ts`](src/storage/migrations.ts)) is a pure function:
  - It keeps term and definition text exactly as written, including text that looks like HTML.
  - It converts numbers and booleans to text.
  - It replaces missing, unsafe, or duplicate IDs.
  - It fills in missing timestamps.
  - It puts every card in a default **My Cards** deck.
  - It returns a report of every change it made.
- The migrated data is written under the new key and read back to confirm it landed. A short
  record of what happened is kept under `snapnotes.migration.v1`; it only drives the notice in
  the app and never decides whether a migration runs.
- The app then says what happened: a notice when every card moved, a list of the entries that
  could not be moved (with a download of the original data) when only some did.
- If the browser can't save the migrated cards (for example, storage is full), they stay on
  screen, a warning explains it, nothing partial is left behind, and the next visit tries again.
- If the original data can't be read as cards at all, the app writes nothing and asks what to
  do: download the original data, open the original app, restore from a backup file, or start
  with an empty collection. It never starts empty on its own.
- Import accepts both the original array format and the new versioned format. Versioned files
  are validated strictly. Importing the same file twice doesn't duplicate cards. When the
  original app's data is present, **Import cards from the original app** on the home page merges
  it in, which also covers cards added there after the switch.

**Before the cutover, export your cards from the live app** (Home → Export) to keep a backup.
`localStorage` is shared by every project hosted on `abbas-4.github.io`, which is why the new keys
have a `snapnotes.` prefix.

## Decks

Every card belongs to a deck. Decks have been part of the stored format since the first
milestone, so collections saved before they had a screen already have one — **My Cards** — and
**nothing is migrated**: the stored shape is still `schemaVersion: 2` and the storage key is
unchanged. A build from before this milestone reads data written by it without any loss; it
simply shows every card in one list again.

- **Decks** in the navigation lists every deck with its card count, and creates new ones.
- A deck's own page renames it, deletes it, and starts any of the four modes on just that deck.
- **Deleting a deck never deletes cards.** Its cards move to a deck you choose first, and the
  last remaining deck cannot be deleted, so a card always has somewhere to live.
- Deck names are trimmed, cannot be empty, and cannot repeat another deck's name (ignoring case).
  Imported data is not held to the last rule, so an unusual file still loads.
- A card's deck is changed on the card's own form, or from the **Deck** control on each row of
  the card list.
- Every mode takes an optional deck: `#/study?deck=<id>`, and the same for `#/quiz`, `#/learn`,
  `#/match` and `#/list`. Without it, the navigation's Study, Quiz, Learn and Match still cover
  every card, so old links and bookmarks keep working. A link naming a deck that has since been
  deleted says so instead of quietly showing everything.

Three things worth knowing about decks and import files:

- **Import cards from the original app** always brings a **My Cards** deck with it, because that
  is where the original app's cards are placed. If you delete that deck and import again, it
  comes back.
- Importing a backup does **not** rename a deck you have since renamed. Decks are matched by ID,
  and the name you have now wins.
- A card you have moved to another deck can come back as a second copy when you import an older
  backup, because a card is recognised by its deck, term and definition together.

## Spaced repetition and saved progress

**Review** schedules each card for the day you are about to forget it, and remembers how well you
know it between visits.

- **The engine** ([`src/domain/srs.ts`](src/domain/srs.ts)) is a simplified, SM-2-inspired
  scheduler. It is pure, takes the current time as an argument, and holds no React or storage
  code, so every rule below is covered by tests.
- Answers are graded **Again**, **Hard**, **Good** or **Easy** (keys <kbd>1</kbd>–<kbd>4</kbd>,
  after <kbd>Space</kbd> reveals the answer). Each button shows the interval it would schedule.
- Successful reviews follow **1 day, 3 days, 7 days**, and from there the interval is multiplied
  by the card's ease, which rises with _Easy_ and falls with _Hard_ and _Again_ (kept within
  1.3–2.8). _Hard_ never schedules further out than _Good_, and _Easy_ always schedules further.
  No interval is ever negative, zero, or more than a year.
- **Again** clears the card's streak, lowers its ease, returns it to the start of the schedule,
  and brings it back within the same session, ten minutes later.
- Intervals are **whole calendar days**, and a card falls due at the _start_ of its day. A card
  answered at 23:50 with a one-day interval is due ten minutes later, at midnight, not at 23:50
  the next night. Day arithmetic is local and calendar-based, so a clock change does not shift a
  schedule.
- A card is **new** until it is first reviewed, **learning** until it is on a multi-day schedule,
  and **mastered** once it is scheduled three weeks or more ahead.

### Where progress is kept

Learning progress lives under its own key, `snapnotes.progress.v1`, next to the cards rather than
inside them:

```json
{
  "version": 1,
  "records": [
    {
      "cardId": "…",
      "deckId": "…",
      "reviews": 4,
      "correct": 3,
      "incorrect": 1,
      "stage": "review",
      "intervalDays": 7,
      "ease": 2.5,
      "lastReviewedAt": 0,
      "dueAt": 0,
      "streak": 3
    }
  ],
  "history": [{ "day": "2026-11-11", "reviews": 12, "correct": 10 }]
}
```

- **The card format is unchanged.** Data is still `schemaVersion: 2`, export files are still the
  same shape, and a build from before this milestone reads everything written by it. There is
  nothing to migrate: cards saved earlier simply count as new until they are first reviewed.
- Progress is validated on the way in and out, **one record at a time**: a single damaged record
  costs that card's history and nothing else. Progress that cannot be read at all starts again
  from empty, with a notice — and **the cards are never touched**.
- Progress written by a newer version of the app is left exactly as it is, never overwritten.
- Records are kept in step with the cards: a deleted card's record goes with it, a card that
  moves deck takes its record along, and duplicate records are collapsed into the one with more
  reviewing behind it.
- **Editing a card keeps its history**, so fixing a typo does not cost weeks of scheduling.
- Every write is read back to confirm it landed; a refused write is reported rather than
  silently dropped.

### Reviewing, deck progress and statistics

- **Review** shows what is due, what is overdue, what is new, and what is mastered, with
  sessions for due cards, new cards, difficult cards, or everything. Due sessions put overdue
  cards first, then difficult ones, then the rest of today's.
- Every session can be narrowed to one deck: `#/review?deck=<id>`, and `#/review?mode=due` links
  straight into one.
- When nothing is waiting, Review says so and gives the day the next card is due.
- **Decks** show how far each deck has come, and what it has waiting, so you can see which deck
  needs attention without opening it.
- **Your progress** (`#/stats`) reports reviews completed, accuracy, reviews today, current and
  longest streaks, cards mastered, the last 14 days of activity and the week ahead. Every figure
  is read from the saved records and the day-by-day log; nothing is estimated, and a collection
  that has never been reviewed shows zeroes.
- Progress can be reset for **one card** (on the card's own form), for **a whole deck** (on the
  deck's page) or for **everything** (on the statistics page). Each asks first, and none of them
  touches a card, a deck or anything else you have written.

## Deployment

GitHub Pages is deployed by [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)
(repository **Settings → Pages → Source: GitHub Actions**; with "Deploy from a branch" Pages
publishes the repository root instead, which is a blank page).

One value in that workflow, `PUBLISH`, decides what the site serves:

| `PUBLISH` | Site root                                 | `/legacy/index.html` |
| --------- | ----------------------------------------- | -------------------- |
| `legacy`  | The original app, byte-for-byte (current) | Not published        |
| `app`     | The React build from `dist/`              | The original app     |

Every run tests and builds the React app and checks that the build is deployable, whichever
value is set. On pull requests the site is only assembled and verified; it deploys only from
`main`, and a smoke job then checks what the live site really serves.

- **Cutover:** change `PUBLISH` to `app`. The address stays the same. Old bookmarks such as
  `#home`, `#add:<id>` and `#study:<id>` are redirected. Pages caches pages for about ten
  minutes, so some visitors see the previous page briefly.
- **Rollback:** change `PUBLISH` back to `legacy`. (That run still tests and builds the React
  app first; if those can't pass, re-run the deploy job of the last run that published the
  original app.) The original app reads only its own key, so
  it shows the cards exactly as they were before the cutover. Cards created in the rebuild stay
  under `snapnotes.data.v2`, untouched, and reappear when the rebuild is published again. The
  original app can't read the rebuild's export files, so those cards aren't visible during a
  rollback.

## License

[MIT](LICENSE)
