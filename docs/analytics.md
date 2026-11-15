# Learning analytics

Milestone 9 adds an **Analytics** page (`#/analytics`) that answers: how much am I studying, how
accurately, am I improving, which cards and decks need attention, how consistently do I study, and
what should I study next. Every figure is worked out from what the app has actually recorded. A
collection that has never been studied shows empty states, not invented numbers.

- [What is recorded](#what-is-recorded)
- [The dashboard](#the-dashboard)
- [How each metric is calculated](#how-each-metric-is-calculated)
- [Streaks](#streaks)
- [Weak cards](#weak-cards)
- [Recommendations](#recommendations)
- [Goals](#goals)
- [Storage, sync and the database migration](#storage-sync-and-the-database-migration)
- [Code layout](#code-layout)
- [Testing](#testing)
- [Assumptions and limitations](#assumptions-and-limitations)

## What is recorded

Before this milestone the app kept, per card, a lifetime Review count and its spaced repetition
schedule, and per day, the number of Review answers and how many were right. That is enough to
schedule cards, but not to say when the user studied, for how long, in which mode, or how quickly.

This milestone adds a **study log**: one record per study session.

| Field                        | Meaning                                                                   |
| ---------------------------- | ------------------------------------------------------------------------- |
| `id`                         | Random, created by the device the session happened on                     |
| `mode`                       | `review`, `quiz`, `learn` or `match`                                      |
| `deckId`                     | The deck the session was started on, or `null` for every deck             |
| `day`                        | The local calendar day (`YYYY-MM-DD`), fixed when recorded                |
| `startedAt` / `endedAt`      | When the first card was shown / the last answer given                     |
| `durationMs`                 | Active study time (pauses count for at most two minutes)                  |
| `answered` / `correct`       | Answers given and how many were right                                     |
| `responseMs`, `timedAnswers` | The total of measured response times, and how many answers were timed     |
| `results`                    | Per card: right and wrong answers (kept for the newest 400 sessions only) |

What counts as an answer, per mode:

| Mode   | Correct                  | Missed                     | Timed from                     |
| ------ | ------------------------ | -------------------------- | ------------------------------ |
| Review | Hard, Good, Easy         | Again                      | the card appearing             |
| Quiz   | the right choice         | a wrong choice             | the question appearing         |
| Learn  | "I know it"              | "Still learning"           | the card appearing             |
| Match  | a right pair (term card) | a wrong pair (term's card) | not timed (tiles on one board) |

Study (flipping cards) has no answers and is not recorded.

A session ends at **local midnight**, after a **30-minute pause**, when the mode or deck changes, when
a mode is restarted, or once it holds 500 different cards; the next answer starts a new one.
Recording never interrupts studying: if the log cannot be saved (for example, storage is full), a
banner says so and the mode carries on. Review answers are still saved to learning progress first,
exactly as before.

## The dashboard

All sections read the same period, chosen at the top (**7 days**, **30 days** (default), **90
days**, **All time**). The period is kept in the address (`#/analytics?period=7d`), so it survives a
refresh and can be linked to.

| Section              | Shows                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| What to study next   | Up to four recommendations, each with its reason and a button into the relevant study mode                                               |
| Overview             | Sessions, cards reviewed, correct and missed answers, accuracy, study time, average response time, current and longest streak            |
| Progress over time   | Charts of cards reviewed (correct/missed), accuracy, study time and sessions, by day, week or month; hover or arrow keys; table view     |
| Learning performance | Observed accuracy by mode and its trend, kept apart from the schedule's **estimated** memory strength                                    |
| Deck performance     | Every deck: cards, studied, answers, accuracy band, last studied, two-week trend and activity; sorting; strongest and weakest; open deck |
| Weak cards           | Cards the user keeps missing, with the reason; open card, open deck, practise them all in Learn                                          |
| Study activity       | A year-long calendar heatmap, streaks, days studied, and the last eight weeks                                                            |
| Study goals          | Set, edit and switch off four kinds of goal; progress for today or this week; recent days or weeks met                                   |
| Study history        | Every recorded session, newest first, filtered by date range, deck and performance, ten per page                                         |

The page is loaded on first visit (it has its own bundle) with a loading message; if it cannot be
loaded offline it says so. A fault while drawing it is caught and shown in place of the page, with
_Try again_; studying is never affected. While a sync is running, the page says it is updating from
other devices, and the figures change as soon as the merged data is saved.

## How each metric is calculated

All calculations live in [`src/domain/analytics.ts`](../src/domain/analytics.ts), are pure, and take
the time as an argument.

**Counting each answer once.** A Review answer is written to two places: the day-by-day review log
(Milestone 7) and a session. For each day, the analytics take:

- every session's answers, in every mode; plus
- from the review log, only the Review answers its sessions do not hold
  (`max(0, log − Review answers in sessions)`).

So a day studied after this milestone is counted from its sessions, and a day before it from the
review log. The two are never simply added. The same rule holds after sync, because both the review
log and the sessions are merged without double counting (see below).

| Metric                    | Definition                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| Study sessions            | Recorded sessions with a day in the period                                                     |
| Cards reviewed            | Answers in the period, all modes (as above)                                                    |
| Correct / missed answers  | Of those answers                                                                               |
| Accuracy                  | Correct ÷ answers; "—" when there are none                                                     |
| Study time                | Sum of session `durationMs`. Review answers from before sessions were recorded have no time    |
| Average response          | Sum of measured response times ÷ timed answers. An answer slower than 60 s is not timed        |
| Change vs previous period | The same figure over the period of equal length just before (not shown for All time)           |
| Accuracy trend            | Improving / declining when it moved by 5 points or more, with at least 10 answers on each side |
| Days studied              | Local days with at least one answer                                                            |

**Charts** have one point per day up to 92 days, per Monday-to-Sunday week up to two years, and per
month beyond, empty buckets included. Accuracy is plotted only where there were answers.

**Observed accuracy vs estimated memory strength.** Accuracy measures how the user answered. It is
not a measurement of long-term retention, and Quiz and Match accuracy can be helped by recognising
the choices. The _Estimated memory strength_ panel says what the spaced repetition schedule
estimates instead: cards by stage (new, learning, reviewing, mastered), the average interval,
overdue cards ("at risk"), and the share learned. It is labelled an estimate everywhere it appears.
"Recall in Review" is observed: the share of Review answers in the period that were remembered.

**Decks.** Answers follow their card, as learning progress does: a card moved to another deck takes
its history with it. Answers on a card that has since been deleted count towards the deck the
session was started on (or no deck, for an "every deck" session). For **All time**, Review answers
come from each card's lifetime record, which also covers reviews made before sessions were recorded,
and answers in the other modes from sessions; for the other periods, everything comes from sessions.
A deck's **trend** compares its accuracy over the last 14 days with the 14 before (at least 10
answers each). Strongest and weakest are named only when at least two decks have 10 or more answers
in the period, and they differ.

**History** lists sessions newest first. A session's deck is the deck it was started on, or for an
"every deck" session, the decks of the cards answered. Performance bands: strong 80% or more, fair
50–79%, weak under 50%.

## Streaks

One rule, used by Analytics and by the Statistics page:

- A **study day** is a local calendar day with at least one answer, in any mode (Review, Quiz,
  Learn or Match), including Review answers recorded before sessions existed.
- Studying on consecutive calendar days extends the streak; a day missed ends it.
- **Today does not break a streak before it is over**: a streak that ran up to yesterday still
  counts until midnight.
- The **longest streak** is the longest run of consecutive study days ever recorded.

Days are the device's local calendar days, computed with calendar arithmetic (`addDays`,
`daysBetween` in `src/domain/srs.ts`), so a 23- or 25-hour day at a clock change still counts once.
A session's day is stored when it is recorded, like the review log's, so moving to another time zone
later never moves past study to another day.

## Weak cards

A card is listed only from its actual answers: lifetime Review answers (its learning record) plus
Quiz, Learn and Match answers from the sessions that keep per-card detail.

1. It must have **at least 3 answers, at least 2 of them wrong**. A single miss never lists a card.
2. It is weak when **fewer than 60% of its answers were right**, or when it was **missed in at least
   two of its last three sessions**.
3. A card answered correctly in **each of its last three sessions** is left off: it has been learned
   since.

Each card shows its reasons ("Right 2 of 11 times", "Missed in 2 of its last 3 sessions", "Forgotten
5 times in Review"), attempts, accuracy, the last time it was answered and its last three session
outcomes. The list is ordered by `(1 − accuracy) × log2(1 + attempts) + 0.5 × recent misses`, then
by most recently answered. **Practise weak cards** opens Learn on just those cards
(`#/learn?focus=weak`, optionally with `&deck=<id>`). Deleted cards are never listed.

## Recommendations

[`src/domain/recommendations.ts`](../src/domain/recommendations.ts) applies fixed rules, in this
priority order, and shows at most four. The same data always gives the same recommendations. No
external service is used.

| Rule                         | When                                                 | Goes to                     |
| ---------------------------- | ---------------------------------------------------- | --------------------------- |
| Catch up on overdue reviews  | Cards due since an earlier day                       | Review, due cards           |
| Get back into a rhythm       | No streak, last study two or more days ago           | Review (due) or Learn       |
| Practise your weak cards     | Any weak cards (higher priority with five or more)   | Learn, weak cards           |
| Keep your streak going       | A streak of two or more days, not yet studied today  | Review (due) or Learn       |
| Review today's due cards     | Cards due today, none overdue                        | Review, due cards           |
| Revisit a deck               | The deck whose accuracy fell furthest in two weeks   | Learn, that deck            |
| Finish today's / week's goal | A goal not yet met in the current day or week        | Review (due) or Learn       |
| Return to a deck             | A deck with cards not studied for seven days or more | Review (due) or Learn, deck |
| Start on new cards           | Nothing due and cards never reviewed                 | Review, new cards           |

With fewer than **10 recorded answers**, the section shows a getting-started message instead (add
cards, or start reviewing), because there is too little history to recommend from honestly.

## Goals

Four goals, each optional:

| Goal                    | Period              | Measured as                         | Range  |
| ----------------------- | ------------------- | ----------------------------------- | ------ |
| Cards reviewed per day  | today               | answers today, all modes            | 1–1000 |
| Study time per day      | today               | whole minutes of session time today | 1–600  |
| Study sessions per week | this week (Mon–Sun) | sessions this week                  | 1–100  |
| Study days per week     | this week (Mon–Sun) | study days this week                | 1–7    |

A goal is never deleted, only switched off, and every change is kept with its time (the newest 50).
Past days and weeks are judged against the target that applied **then**, so raising a goal does not
rewrite history; a period with no goal in force is shown as "no goal". The goal history shows the
last 14 days or 8 weeks.

Goals are saved with the study log. Signed in, they sync to the account like everything else (see
below); signed out, they stay in the browser.

## Storage, sync and the database migration

**In the browser** the study log and goals live under a new key, `snapnotes.analytics.v1`:

```json
{ "version": 1, "sessions": [ … ], "goals": [ … ] }
```

The card format (`snapnotes.data.v2`), the progress format (`snapnotes.progress.v1`) and the export
format are **unchanged**. Like progress, the log is validated record by record on the way in and out
(a damaged session costs only itself, with a notice), every write is read back, a log written by a
newer version is left untouched, and another tab's changes are picked up through `storage` events.

To fit browser storage, the newest **400** sessions keep their per-card `results`; older ones keep
only their totals (which is all the history, charts and streaks need), and beyond **3,000** sessions
the oldest are dropped. The rule depends only on the sessions, not the clock, so every device
compacts the same way. Long-term figures do not depend on it: the review log and each card's lifetime
record are kept as before.

**Resetting all progress** (Statistics page) now also forgets the study sessions, which hold the
streaks and analytics; goals are kept. Resetting one card or one deck does not touch the log (as it
never touched the review log), and deleting a card or deck never deletes sessions: the study
happened, and the analytics account for it.

**Sync.** Sessions and goals are two new record kinds in the Milestone 8 sync engine — no second
sync system. They use the same pull/merge/push cycle, revisions, tombstones, offline queue (pending
changes are the difference from the server's last confirmed version) and retry rules.

- **Sessions never conflict in practice.** Each is written only by the device it happened on, under
  a random ID. Two copies of one session can differ only by how far it had got, so the copy with
  more answers is kept. Sync is a union by ID: a session can never be counted twice, and the review
  log keeps its own Milestone 8 rule (reviews since the shared version are added; with no shared
  version, the larger count is used).
- **Goals**: the later change sets the target; the change histories from both devices are combined.
- **Linking** a browser to an account joins sessions by ID, and moves a session's results onto the
  account's copy of a card when the card was matched by content under another ID. _Use the
  account's_ replaces this browser's study log and goals with the account's, so one account's study
  history never appears in another's.
- **Signing out with _remove my data_** removes the study log from the browser too, and **deleting
  the account** removes it from the server (and from the browser when that box is ticked).

**Database migration** —
[`supabase/migrations/20261114000000_study_analytics.sql`](../supabase/migrations/20261114000000_study_analytics.sql).
It only adds; nothing existing is altered or removed:

- Two tables, `study_sessions` and `study_goals`, keyed by `(user_id, id)`, with `revision`,
  `deleted` and `server_updated_at` like the Milestone 8 tables; check constraints mirroring the
  app's validation; indexes on `(user_id, revision)`; cascading deletes from `auth.users`.
- Row Level Security on both: users read only their own rows; no direct writes.
- `apply_session` / `apply_goal`, called by `sync_push` per change, validate every field (including
  each per-card result and goal change) and are idempotent for retried uploads.
- `sync_pull` gains a `kinds text[]` parameter, defaulting to the four Milestone 8 kinds. An app from
  before this milestone does not send it and so is **never sent a record it cannot read**: mixed
  versions keep syncing. When such a device is updated, its saved sync state has no entries for the
  new kinds; it then reads the account again from the start, once, to pick up the sessions and goals
  it skipped. Records it already has are recognised by revision and skipped, so nothing is applied
  twice.

Apply it with `npm run db:reset` locally, or `npx supabase@2.122.0 db push` on a hosted project
(before deploying a build of this milestone with accounts enabled).

## Code layout

| Path                                         | What it is                                                            |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `src/domain/studySessions.ts`                | The session record, recording answers, session boundaries, compaction |
| `src/domain/studyGoals.ts`                   | Goal kinds, ranges, setting goals, targets over time, merging         |
| `src/domain/analytics.ts`                    | Every calculation on the page                                         |
| `src/domain/recommendations.ts`              | The recommendation rules                                              |
| `src/storage/analyticsStore.ts`              | The `snapnotes.analytics.v1` key: schemas, load, save                 |
| `src/ui/StudyLogProvider.tsx`, `studyLog.ts` | Owns the log; `useSessionRecorder` for the study modes                |
| `src/ui/useAnalytics.ts`                     | Memoised index of the input, weak cards                               |
| `src/ui/analytics/`                          | The page, its sections, the chart and the error boundary              |

The page indexes the input once per change to the data (`buildAnalyticsBase`), and recomputes the
figures only when that index, the period or the calendar day changes — not on every render or clock
tick. A history of 3,000 sessions, 2,000 cards and ten years of review log is summarised in well
under a second in the tests.

## Testing

| Test file                                 | Covers                                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/analytics.test.ts`            | Totals, double counting, periods, trends, streaks, DST and time zones, series, heatmap, decks, weak cards, history, goals, performance |
| `src/domain/studySessions.test.ts`        | Recording, timing, session boundaries, duplicates, compaction                                                                          |
| `src/domain/studyGoals.test.ts`           | Validation, changes, targets over time, merging                                                                                        |
| `src/domain/recommendations.test.ts`      | Every rule, getting started, ordering and determinism                                                                                  |
| `src/storage/analyticsStore.test.ts`      | Loading, damaged entries, newer versions, full storage, the shared validation rules                                                    |
| `src/sync/studyLogSync.test.ts`           | Merge rules, two devices offline, lost replies, deleted cards, linking and remapping, separate accounts, upgrading devices             |
| `src/sync/studyLog.integration.test.ts`   | The same against the real database: round trips, idempotency, validation, RLS isolation, older apps, account deletion                  |
| `src/ui/analytics/AnalyticsPage.test.tsx` | Navigation and loading, empty states, periods, charts, decks, weak cards, goals, recommendations, history, errors                      |
| `src/ui/studyLog.test.tsx`                | Recording in Review, Quiz, Learn and Match; nothing in Study; reset                                                                    |

## Assumptions and limitations

- **History before this milestone is partial.** Reviews made earlier exist only as daily totals and
  per-card lifetime counts. They count in totals, charts, streaks and all-time deck figures, but have
  no time, no response time, no mode other than Review, and are not listed in the session history
  (the page says how many days this affects). Quiz, Learn and Match answers before this milestone
  were never recorded and cannot be recovered.
- **Study time is active time**, approximated from the gaps between answers, each counted for at
  most two minutes; time spent after the last answer of a session is not counted. Response times
  over 60 seconds are not timed. Match answers are not timed.
- **Accuracy is not retention.** The memory strength panel is an estimate from the schedule, and is
  labelled as one.
- **Per-card detail is kept for the newest 400 sessions.** Weak card detection from Quiz, Learn and
  Match therefore covers recent sessions; Review answers always count in full.
- **The review log keeps 365 days** (unchanged from Milestone 7). Review-only days older than that
  are no longer in all-time totals or streaks; sessions keep their own history.
- **Weeks run Monday to Sunday** for weekly goals, summaries and charts, whatever the browser's
  locale.
- **Days are the device's local days.** Two devices in different time zones each record their own
  local day; nothing is converted.
- **Mixed app versions**: an older app keeps syncing but does not show analytics, and its _Reset all
  progress_ does not clear sessions saved by a newer one.
- Charts are hand-drawn SVG (no chart library); on narrow screens the year heatmap scrolls sideways
  inside its panel.
