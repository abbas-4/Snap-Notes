# Snap Notes

[![CI](https://github.com/abbas-4/Snap-Notes/actions/workflows/ci.yml/badge.svg)](https://github.com/abbas-4/Snap-Notes/actions/workflows/ci.yml)

Snap Notes is a flashcard and study app. You write cards with a term and a definition, then
review them in four modes:

- **Study**: flip through cards one at a time.
- **Quiz**: multiple-choice questions built from your own definitions.
- **Learn**: type the answer; a card counts as mastered after two correct answers in a row.
- **Match**: pair terms with their definitions.

**Live app:** <https://abbas-4.github.io/Snap-Notes/>

## Project status

The original app is a single HTML file ([`legacy/index.html`](legacy/index.html)) that keeps
cards in the browser's `localStorage`. It is being rebuilt as a typed, tested React application,
one small milestone at a time. **The live site still serves the original app, unchanged**, and
will keep doing so until the rebuild reaches feature parity and can migrate existing cards safely.

| Milestone | Scope                                                                                | Status  |
| --------- | ------------------------------------------------------------------------------------ | ------- |
| 1         | Tooling, domain types, storage layer, `migrateV1()`, import/export validation, CI    | ✅ Done |
| 2         | React UI: layout, navigation, Home, List, Add/Edit, import/export                    | Planned |
| 3         | Study and Quiz modes (keyboard accessible, no timing races)                          | Planned |
| 4         | Learn and Match modes                                                                | Planned |
| 5         | Cutover: deploy the new app at the same URL, migrate data on first load, smoke tests | Planned |
| 6         | Decks: create, rename, and study cards by deck                                       | Planned |
| 7         | Spaced repetition and saved progress                                                 | Planned |
| 8+        | Backend (Node, Express, PostgreSQL, Prisma), accounts, sync across devices           | Later   |

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

## Project structure

```
legacy/index.html       The original app, preserved unchanged and served on GitHub Pages
src/
  domain/               Pure TypeScript: data types, IDs, shuffle, quiz generation
  storage/              localStorage access, legacy migration, import/export, Zod schemas
  test/                 Test setup and helpers (an in-memory Storage)
  App.tsx, main.tsx     React entry point (placeholder until Milestone 2)
scripts/                Repository scripts (legacy verification)
.github/workflows/      CI and GitHub Pages deployment
```

Code in `domain/` and `storage/` never touches the DOM or global state, so it can be tested
directly. Storage functions take the `Storage` object as an optional parameter, and tests use an
in-memory fake.

## Data and migration

|                  | Original app                                     | Rebuild                                                                |
| ---------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| localStorage key | `abbas_flashcards_v1`                            | `snapnotes.data.v2`                                                    |
| Shape            | `[{ id, term, definition, created?, updated? }]` | `{ schemaVersion: 2, decks, cards }`                                   |
| Export file      | The bare array                                   | `{ format: "snap-notes", schemaVersion: 2, exportedAt, decks, cards }` |

How existing cards will be carried over:

- **The original key is never written to or deleted.** The legacy data stays in place as a backup.
- `migrateV1()` ([`src/storage/migrations.ts`](src/storage/migrations.ts)) is a pure function:
  - It keeps term and definition text exactly as written, including text that looks like HTML.
  - It converts numbers and booleans to text.
  - It replaces missing, unsafe, or duplicate IDs.
  - It fills in missing timestamps.
  - It puts every card in a default **My Cards** deck.
  - It returns a report of every change it made.
- Migrated data is written under the new key. Data the app can't read is never overwritten.
- Import accepts both the original array format and the new versioned format. Versioned files
  are validated strictly. Importing the same file twice doesn't duplicate cards.
- Automatic migration starts only at cutover (Milestone 5). Until then the rebuild doesn't read
  or write `localStorage` at all.

**Before the cutover, export your cards from the live app** (Home → Export) to keep a backup.
`localStorage` is shared by every project hosted on `abbas-4.github.io`, which is why the new key
has a `snapnotes.` prefix.

## Deployment

GitHub Pages is deployed by [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)
(repository **Settings → Pages → Source: GitHub Actions**). Until cutover, the workflow publishes
`legacy/index.html` as the site's `index.html` and checks that it's byte-for-byte the original.
On pull requests it only assembles and verifies the site; it deploys only from `main`.

## License

[MIT](LICENSE)
