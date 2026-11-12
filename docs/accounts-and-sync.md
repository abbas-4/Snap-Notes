# Accounts and cloud sync

Milestone 8 adds optional accounts. Signed in, a user's decks, cards, learning progress and
review history stay in step across every browser they use, and come back after a browser is
cleared. Signed out, or in a build without a backend, Snap Notes is exactly the local-only app it
was before: nothing here is needed to study.

- [Architecture](#architecture)
- [Database schema](#database-schema)
- [How sync works](#how-sync-works)
- [Conflict resolution](#conflict-resolution)
- [Offline use](#offline-use)
- [Linking a browser to an account (data migration)](#linking-a-browser-to-an-account-data-migration)
- [Security](#security)
- [Account deletion](#account-deletion)
- [Local development](#local-development)
- [Setting up a hosted backend](#setting-up-a-hosted-backend)
- [Deployment](#deployment)
- [Testing](#testing)
- [Known limitations](#known-limitations)

## Architecture

```
Browser (GitHub Pages, static)                    Supabase project
┌──────────────────────────────────┐              ┌───────────────────────────────────────┐
│ AppDataProvider / ProgressProvider│  localStorage│ Auth (GoTrue): accounts, bcrypt       │
│   cards, decks, progress  ────────┼─► saved first│   hashes, JWT sessions, reset emails  │
│ SyncProvider ── sync engine ──────┼──── HTTPS ──►│ PostgREST ─► sync_pull / sync_push /  │
│   (src/sync, pure TypeScript)     │  (JWT)       │   delete_account (Postgres functions) │
│ AuthProvider ── Supabase Auth ────┼──── HTTPS ──►│ Postgres: tables + Row Level Security │
└──────────────────────────────────┘              └───────────────────────────────────────┘
```

**Why Supabase.** The app is a static site on GitHub Pages with no server. The earlier plan of a
Node/Express/Prisma server would have meant hosting and operating a new service, hand-writing
password hashing, sessions and reset emails, adding an email provider, and handling cross-site
cookies between `github.io` and that server. Supabase provides an audited auth server and
PostgreSQL with Row Level Security, keeps the site static, and adds one runtime dependency
(`@supabase/supabase-js`, loaded only when accounts are configured). Every server-side rule is
plain SQL in [`supabase/migrations`](../supabase/migrations), so it is reviewable and runs
identically on a laptop, in CI and in production.

**Where the code lives.**

| Path                           | What it is                                                                 |
| ------------------------------ | -------------------------------------------------------------------------- |
| `supabase/migrations/*.sql`    | Tables, constraints, indexes, RLS policies and the sync / delete functions |
| `supabase/config.toml`         | Local stack settings: auth rules, redirect URLs, password policy           |
| `src/sync/`                    | The sync engine: records, merge rules, change tracking, linking. No React  |
| `src/storage/syncStore.ts`     | The sync state saved in this browser (`snapnotes.sync.v1`)                 |
| `src/cloud/`                   | Config checks, the auth interface, the wire protocol, the Supabase adapter |
| `src/ui/account/`              | Auth and sync providers, account pages, the navigation indicator           |
| `src/**/*.integration.test.ts` | Tests against a real local Supabase stack                                  |

The engine (`src/sync/engine.ts`) talks to the server through a small `SyncTransport` interface
and to the device through a `LocalStore`, so the same code is tested against the real database
and against a scripted server that can fail at exact moments.

## Database schema

One table per kind of record, each keyed by `(user_id, id)`:

| Table            | Key                | Holds                                                       |
| ---------------- | ------------------ | ----------------------------------------------------------- |
| `decks`          | `user_id, id`      | `name`, `created_at`, `updated_at`                          |
| `cards`          | `user_id, id`      | `deck_id`, `term`, `definition`, `created_at`, `updated_at` |
| `card_progress`  | `user_id, card_id` | The spaced repetition record from Milestone 7               |
| `review_history` | `user_id, day`     | Reviews and correct answers per day                         |
| `sync_accounts`  | `user_id`          | The account's revision counter                              |

Every synced row also has:

- `revision`: a number from the account's own counter, assigned by the server on every change.
  Devices ask for "everything after revision N"; device clocks never decide ordering.
- `deleted`: a tombstone flag. A deleted record keeps its ID and revision so offline devices
  learn about the deletion, and its content columns are cleared (enforced by a check constraint).
- `server_updated_at`: when the server last wrote the row.

`created_at` / `updated_at` are the app's own millisecond timestamps, stored exactly as the app
keeps them. **The domain model is unchanged**: the app still stores `schemaVersion: 2` data and
`snapnotes.progress.v1` progress, and export files are unchanged.

Constraints mirror the app's validation: ID format (`[A-Za-z0-9_-]{1,64}`), non-blank deck names,
cards with at least one non-blank side, `updated_at >= created_at`, valid stages and ranges for
progress, `correct <= reviews` per day, and text up to 100,000 characters per field. A live card
must name a deck row of the same account (composite foreign key), and progress must belong to an
existing card. Indexes on `(user_id, revision)` serve pulls.

All foreign keys to `auth.users` cascade, so deleting an account deletes every row it owns.

**Migrating the database**: migrations are applied in filename order by
`supabase db reset` (local) and `supabase db push` (hosted). Add a new timestamped file for any
change; never edit a migration that has been applied to a hosted project.

## How sync works

**The device remembers what the server last confirmed.** For every record, this browser keeps the
last version it knows the server holds (the _base_) and that version's server revision, in
`snapnotes.sync.v1`. A record whose local version differs from its base is a change waiting to be
uploaded. There is no separate queue of edits: pending changes are always exactly the difference
between what is here and what the server confirmed, which means they:

- survive a reload or a crash (both the data and the base are in localStorage);
- collapse many edits to one record into a single upload;
- cannot drift out of step with the data.

**One sync run** (`runSync`):

1. **Pull** every change after the saved cursor, page by page (`sync_pull`).
2. **Merge** each record into local data: no local change → take the server's version; local
   change only → keep it; both changed → merge (see below). Save the data, then the new base and
   cursor, in that order.
3. **Push** the pending changes in batches of 200 (`sync_push`), decks before the cards in them,
   cards before their progress, deleted decks last. Each change carries the revision it was made
   on top of. The server answers per change: `applied` (new revision), `conflict` (with its
   current row) or `rejected` (invalid).
4. Merge any conflicts and go round again (at most four rounds).

**Idempotent and safe to interrupt.**

- If a push reaches the server but the reply is lost, the retry finds the row already saying
  exactly what is being pushed and reports it as applied without writing. Nothing is duplicated.
- The base is saved after every batch, so an interrupted upload resumes where it stopped.
- Local data is written before the sync state that describes it. If the page closes in between,
  the next run sees the same server changes again, finds them already applied, and moves on.
- A failed request never changes or removes local data.
- Server pushes for one account are serialised by a row lock, and pulls wait for a push in
  progress, so a pull can never skip a revision.

**When it runs**: right after sign-in, two seconds after a change, when the connection comes back,
when the tab becomes visible again, every 60 seconds while the page is open, and from **Sync now**
on the account page. Only one tab syncs at a time (Web Locks); other tabs pick up its results
through `storage` events.

**Failures**: network errors and busy servers are retried automatically after 5 s, 15 s, 30 s,
1 min, 2 min, then every 5 min. A refused session triggers one token refresh; if that fails, the
user is told to sign in again. A record the server rejects as invalid is listed on the account page
and not sent again until it is edited.

## Conflict resolution

A conflict is **detected by revision**, not by clock: a change is a conflict only when the server
holds a newer revision than the one the device built on. The rules (`src/sync/merge.ts`):

1. **Only one side changed** → that side wins. Both made the same change → nothing to decide.
2. **Editing beats deleting.** A card or deck deleted on one device but edited on another is kept,
   with the edit, so a deletion can never silently destroy work. The user is told and can delete
   it again.
3. **Cards and decks merge field by field.** A term edited on one device and a definition on
   another both survive. Only when the _same_ field was changed to different values on both is one
   chosen: the more recent edit (by the app's `updatedAt`; on a tie, the server's), and the other
   version is **kept as a conflict** on the account page with _Use the other version_.
4. **Learning progress adds up.** Reviews of one card on two devices are both counted (each side's
   reviews since the shared version are added), and the schedule comes from whichever device
   reviewed it most recently. With no shared version (when linking), the larger count is used so
   reviews are never counted twice.
5. **Review history adds up** per day the same way.
6. **Decks and their cards stay consistent.** A deck deleted on one device while another device
   added a card to it comes back, holding that card; the server refuses to delete a deck that still
   has live cards, and refuses a live card in a deleted deck, so the devices always re-check.

Every device applies the same rules to the same inputs, so they converge whichever syncs first.
Clocks are consulted only to choose between two edits of the same field, and the losing edit is
kept. Conflicts are listed under **Account → Sync → Changes to review** (up to 200, newest first).

## Offline use

Nothing about studying waits for the network. Every change is validated and saved to
localStorage first, exactly as before accounts existed, then uploaded a moment later.

- Offline, changes accumulate as pending changes; the navigation shows "Offline · N changes
  waiting" and the account page shows the count.
- A reload keeps them, because they are derived from saved data.
- Back online (`online` event), sync runs immediately.
- A saved session is shown as signed in even when the server cannot be reached to refresh it.

| Indicator (navigation dot and label) | Meaning                                           |
| ------------------------------------ | ------------------------------------------------- |
| Synced (green)                       | Everything here is on the server                  |
| Syncing… (pulsing)                   | A sync is running                                 |
| N changes to sync                    | Changes waiting, uploading shortly                |
| Offline · N changes waiting (grey)   | No connection; changes are safe here              |
| Sync problem (red)                   | The last attempt failed; details and retry time   |
| Finish setting up sync (amber)       | This browser's data must be joined to the account |
| Sign in (amber dot)                  | The session ended; sign in again                  |

## Linking a browser to an account (data migration)

The first time a browser syncs with an account, its data and the account's are joined
(`src/sync/link.ts`). Local storage is never deleted or reset by creating an account or signing in.

| This browser                     | The account | What happens                                                                    |
| -------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| Empty (never used)               | Anything    | The account's data is downloaded                                                |
| Has data                         | Empty       | This browser's data is uploaded, IDs unchanged                                  |
| Has data                         | Has data    | The user chooses: **Combine** or **Use the account's**                          |
| Last synced with another account | Anything    | The user chooses; replacing is suggested, with a warning about unsynced changes |

**Combine** keeps everything. Records with the same ID are the same record and are merged with the
rules above. A deck with the same name (ignoring case and spaces) as an account deck is that deck;
a card with the same deck, term and definition as an account card is that card, and its progress
is merged into the account's copy. Linking a second device, or the same data twice, never
duplicates anything. IDs are preserved, including IDs carried over from the original app.

**Use the account's** replaces this browser's cards with the account's, after offering a backup
download. The account itself is not changed.

**Interrupted linking**: the combined data and a base describing the server are saved first; the
upload is ordinary sync. If the upload stops, the next sync resumes it. If linking fails before
anything is saved, nothing changed and it can simply be retried (it retries automatically after
network errors).

**Lost sync state** (`snapnotes.sync.v1` cleared or unreadable) is safe: the browser links again,
and its records are recognised by ID or content rather than duplicated.

## Security

- **Passwords** go only to Supabase Auth over HTTPS and are stored as bcrypt hashes. The app never
  stores them; tests check that the saved session contains no password. Minimum 8 characters with
  letters and digits, enforced by the server.
- **Sessions**: a one-hour JWT access token and a refresh token that rotates on every use, under
  the namespaced key `snapnotes.auth.v1`. Email links use the PKCE flow: the one-time code is
  exchanged by the browser that asked for it and is removed from the address bar immediately.
- **No secret keys in the browser.** The build takes only the project URL and publishable key. The
  app refuses to enable accounts if given a `sb_secret_…` or `service_role` key.
- **The server decides whose data it is.** `sync_pull`, `sync_push` and `delete_account` take the
  account from the verified JWT (`auth.uid()`); any user ID in a request is ignored. They run
  with a fixed, empty `search_path`.
- **Row Level Security** is on for every table, with policies allowing users to read only their own
  rows. All direct inserts, updates and deletes are revoked; writes go only through `sync_push`.
  Anonymous callers cannot execute any function.
- **Validation on the server**: every pushed record is type-checked and constrained in SQL, per
  record, so a bad record is rejected alone and never stored.
- **Errors and logs**: the UI shows written messages, never raw server errors (which could reveal
  whether an email is registered). Sign-in failures read the same for a wrong password and an
  unknown email. Nothing logs card content or tokens.
- **Account deletion requires a recent sign-in** (the server checks the JWT's `amr` timestamp is
  under ten minutes old), and the UI asks for the password again.

The integration tests check each of these against the real database: cross-user reads return
nothing, the same record ID in two accounts stays separate, injected user IDs are ignored, direct
table writes return 403, unauthenticated and expired or tampered tokens are refused, and deletion
removes exactly one account's rows.

## Account deletion

**Account → Delete account** asks for the password, then deletes the auth user. Every deck, card,
progress record and review day stored for the account is removed by cascading foreign keys. Every
device is signed out (their sessions can no longer be renewed).

- **This browser**: keeps its cards as a local-only collection by default, or removes them if the
  user ticks the box. The sync state is cleared either way.
- **Other devices**: keep the copy they already have, saved only on that device. Their next sync
  finds the session ended and asks them to sign in.

**Signing out** keeps the data on the browser by default (a user signing back in carries on
syncing). The _Also remove my cards…_ option is for shared computers; it never touches the
account's copy. The original app's key (`abbas_flashcards_v1`) is never written in any of these.

## Local development

You need Node.js (see `.nvmrc`) and Docker.

```bash
npm ci
npm run db:start        # local Supabase: Postgres + auth + API + Mailpit, migrations applied
npm run db:status       # prints the local URL and keys
```

Create `.env.local` (git-ignored) from [`.env.example`](../.env.example):

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY from npm run db:status>
```

```bash
npm run dev             # http://localhost:5173/Snap-Notes/
```

Emails (sign-up confirmation when enabled, password reset, email change) arrive in Mailpit at
<http://127.0.0.1:54324>. `npm run db:reset` re-creates the database from the migrations;
`npm run db:stop` stops the stack. Without `.env.local`, `npm run dev` runs the local-only app.

## Setting up a hosted backend

1. Create a project at <https://supabase.com/dashboard>.
2. Apply the schema from this repository:

   ```bash
   npx supabase@2.122.0 login
   npx supabase@2.122.0 link --project-ref <project-ref>
   npx supabase@2.122.0 db push
   ```

3. **Authentication → URL Configuration**: Site URL `https://abbas-4.github.io/Snap-Notes/`, and
   add `https://abbas-4.github.io/Snap-Notes/**` to Redirect URLs.
4. **Authentication → Providers → Email**: keep email sign-in on; turn **Confirm email** on
   (recommended); set the minimum password length to 8 and require letters and digits, to match the
   app.
5. **Authentication → SMTP**: configure your own email provider. Supabase's built-in sender is for
   testing only and is limited to a few emails an hour.
6. **Project Settings → API**: copy the Project URL and the **publishable** key (or the legacy
   `anon` key). Never use the secret / `service_role` key in the app.

## Deployment

The site is still built and published by
[`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml). To switch accounts
on, add two repository **variables** (Settings → Secrets and variables → Actions → _Variables_,
not _Secrets_: both values are public and are compiled into the JavaScript):

| Variable                   | Value                                |
| -------------------------- | ------------------------------------ |
| `SUPABASE_URL`             | `https://<project-ref>.supabase.co`  |
| `SUPABASE_PUBLISHABLE_KEY` | The project's publishable / anon key |

Without them the build is the local-only app, so the variables can be added (or removed, as a
rollback) at any time. Accounts are visible only once the React app itself is published
(`PUBLISH: app`, see the README's Deployment section).

Order for a first deployment: apply the migrations (`db push`), configure auth URLs and SMTP, add
the two variables, then let the workflow run.

## Testing

| Command                    | What it covers                                                                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                 | Merge rules, change tracking, linking, the engine against a scripted server (lost replies, partial batches, refused writes, full storage), config and protocol checks, and the account UI                                               |
| `npm run test:integration` | The same engine and the real Supabase client against a local stack: registration, sign-in, sessions, password recovery through Mailpit, two-device sync, conflicts, interrupted uploads, RLS and cross-user isolation, account deletion |

`npm run test:integration` needs `npm run db:start` first, and refuses to run against anything but
a local stack. CI runs both.

## Known limitations

- **Sync is not real-time.** Changes from other devices arrive within about a minute while the
  page is open (or at once with _Sync now_), not instantly.
- **A reload while offline needs the browser's cache.** The app has no service worker yet, so a
  page opened offline relies on the browser having cached it. An open tab works offline
  indefinitely.
- **Password reset links work in the browser that asked for them** (a property of the PKCE flow).
  Opened elsewhere, the page explains and offers a new link.
- **Choosing between two edits of the same field uses the devices' clocks.** A device with a badly
  wrong clock can win a tie it should lose. The other version is always kept for the user to
  restore.
- **The base copy roughly doubles the space sync takes in localStorage.** Collections near the
  browser's storage limit (around 5 MB) may be unable to save sync state; this is reported, and no
  card is lost.
- **Tombstones are kept indefinitely**, so a device offline for any length of time still learns
  about deletions. They hold no content.
- **A reset of a card's progress can be undone** by another device that reviewed that card
  offline before hearing about the reset, because new reviews win over deletions.
