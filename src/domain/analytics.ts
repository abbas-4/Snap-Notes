import { isReviewable } from './reviewQueue';
import {
  countProgress,
  currentStreak,
  longestStreak,
  timestampFromDayKey,
  type DailyActivity,
  type ProgressCounts,
} from './progressStats';
import { addDays, dayKey, daysBetween, startOfDay, type CardProgress } from './srs';
import { STUDY_MODES, type StudyMode, type StudySession } from './studySessions';
import {
  GOAL_DEFINITIONS,
  GOAL_KINDS,
  targetAt,
  type GoalKind,
  type StudyGoal,
} from './studyGoals';
import type { AppData, Card, Deck, Timestamp } from './types';

/**
 * Learning analytics: every figure on the Analytics page, worked out from what
 * the app has actually recorded. Nothing is estimated unless it says so, and
 * nothing here reads storage, the clock or React.
 *
 * Where the figures come from:
 *
 * - **Sessions** (`StudySession`): every Review, Quiz, Learn and Match session
 *   since the study log was added, with its answers, time and cards.
 * - **The day-by-day review log** (`DailyActivity`, Milestone 7): how many
 *   Review answers were given each day, and how many were right. It reaches
 *   further back than the sessions.
 * - **Learning progress** (`CardProgress`): each card's lifetime Review count,
 *   and its spaced repetition schedule.
 *
 * Review answers are written to both the review log and a session. To count
 * each answer once, a day's Review answers are taken from its sessions, and the
 * review log adds only what the sessions do not hold (answers from before the
 * study log existed). The two are never simply added together.
 */

export type AnalyticsPeriod = '7d' | '30d' | '90d' | 'all';

export const ANALYTICS_PERIODS: readonly { id: AnalyticsPeriod; days: number | null }[] = [
  { id: '7d', days: 7 },
  { id: '30d', days: 30 },
  { id: '90d', days: 90 },
  { id: 'all', days: null },
];

export function isAnalyticsPeriod(value: unknown): value is AnalyticsPeriod {
  return ANALYTICS_PERIODS.some((period) => period.id === value);
}

/** Below this many answers, an accuracy is not compared with another. */
export const MIN_TREND_ANSWERS = 10;

/** A change in accuracy smaller than this (in points from 0 to 1) is "steady". */
export const TREND_THRESHOLD = 0.05;

/** Deck trends compare the last this-many days with the same number of days before them. */
export const TREND_WINDOW_DAYS = 14;

/** A deck needs this many answers in the period to be called strongest or weakest. */
export const MIN_RANKED_DECK_ANSWERS = 10;

/** Thresholds behind the weak card list (see {@link findWeakCards}). */
export const WEAK_MIN_ATTEMPTS = 3;
export const WEAK_MIN_MISSES = 2;
export const WEAK_ACCURACY = 0.6;
/** How many of a card's most recent sessions are looked at for "recent misses". */
export const WEAK_RECENT_SESSIONS = 3;

/** Session accuracy bands used by the history filter. */
export const STRONG_ACCURACY = 0.8;
export const FAIR_ACCURACY = 0.5;

// ---------------------------------------------------------------------------
// The input, indexed once
// ---------------------------------------------------------------------------

export interface AnalyticsInput {
  data: AppData;
  records: ReadonlyMap<string, CardProgress>;
  history: readonly DailyActivity[];
  sessions: readonly StudySession[];
  goals: readonly StudyGoal[];
}

/** Everything recorded on one local calendar day. */
export interface DayActivity {
  day: string;
  /** Midnight at the start of the day. */
  at: Timestamp;
  answered: number;
  correct: number;
  sessions: number;
  studyMs: number;
  responseMs: number;
  timedAnswers: number;
  /** Review answers known only from the day-by-day log, with no session (and so no time). */
  untrackedAnswers: number;
  /** Answers by mode. Untracked review answers count as Review. */
  byMode: Record<StudyMode, { answered: number; correct: number }>;
}

function emptyModes(): DayActivity['byMode'] {
  return {
    review: { answered: 0, correct: 0 },
    quiz: { answered: 0, correct: 0 },
    learn: { answered: 0, correct: 0 },
    match: { answered: 0, correct: 0 },
  };
}

function emptyDay(day: string, at: Timestamp): DayActivity {
  return {
    day,
    at,
    answered: 0,
    correct: 0,
    sessions: 0,
    studyMs: 0,
    responseMs: 0,
    timedAnswers: 0,
    untrackedAnswers: 0,
    byMode: emptyModes(),
  };
}

/** The input, indexed for the questions the page asks. Build once, then reuse. */
export interface AnalyticsBase {
  input: AnalyticsInput;
  /** Days with any activity, by day key. */
  days: ReadonlyMap<string, DayActivity>;
  /** The same days, oldest first. */
  activeDays: readonly DayActivity[];
  /** Sessions on a usable day, oldest first. */
  sessions: readonly StudySession[];
  cards: ReadonlyMap<string, Card>;
  decks: ReadonlyMap<string, Deck>;
  /** The first day anything was recorded, or null. */
  earliest: Timestamp | null;
}

function clampCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Indexes the input: one entry per day with every session and review on it.
 * Entries with an unusable day or counts are left out rather than guessed at.
 */
export function buildAnalyticsBase(input: AnalyticsInput): AnalyticsBase {
  const days = new Map<string, DayActivity>();
  const dayFor = (key: string): DayActivity | null => {
    const existing = days.get(key);
    if (existing) return existing;
    const at = timestampFromDayKey(key);
    if (at === null) return null;
    const created = emptyDay(key, at);
    days.set(key, created);
    return created;
  };

  const seen = new Set<string>();
  const sessions: StudySession[] = [];
  for (const session of input.sessions) {
    // The store keeps one copy of each session; this guards anything else.
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    const entry = dayFor(session.day);
    if (!entry) continue;
    sessions.push(session);
    const answered = clampCount(session.answered);
    const correct = Math.min(clampCount(session.correct), answered);
    entry.sessions += 1;
    entry.answered += answered;
    entry.correct += correct;
    entry.studyMs += clampCount(session.durationMs);
    const timed = Math.min(clampCount(session.timedAnswers), answered);
    entry.timedAnswers += timed;
    entry.responseMs += timed === 0 ? 0 : clampCount(session.responseMs);
    entry.byMode[session.mode].answered += answered;
    entry.byMode[session.mode].correct += correct;
  }

  for (const logged of input.history) {
    const reviews = clampCount(logged.reviews);
    if (reviews === 0) continue;
    const entry = dayFor(logged.day);
    if (!entry) continue;
    const inSessions = entry.byMode.review;
    const untracked = Math.max(0, reviews - inSessions.answered);
    if (untracked === 0) continue;
    const untrackedCorrect = Math.min(
      untracked,
      Math.max(0, Math.min(clampCount(logged.correct), reviews) - inSessions.correct),
    );
    entry.untrackedAnswers += untracked;
    entry.answered += untracked;
    entry.correct += untrackedCorrect;
    inSessions.answered += untracked;
    inSessions.correct += untrackedCorrect;
  }

  for (const [key, entry] of days) if (entry.answered === 0) days.delete(key);
  const activeDays = [...days.values()].sort((a, b) => a.at - b.at);
  sessions.sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1));

  return {
    input,
    days,
    activeDays,
    sessions,
    cards: new Map(input.data.cards.map((card) => [card.id, card])),
    decks: new Map(input.data.decks.map((deck) => [deck.id, deck])),
    earliest: activeDays[0]?.at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Periods and totals
// ---------------------------------------------------------------------------

export interface DateRange {
  /** Midnight at the start of the first day. */
  start: Timestamp;
  /** Midnight at the start of the last day (today). */
  end: Timestamp;
  /** Calendar days covered, including both ends. */
  days: number;
}

/** The days a period covers, ending today. "All time" starts on the first day anything was recorded. */
export function periodRange(
  period: AnalyticsPeriod,
  now: Timestamp,
  earliest: Timestamp | null,
): DateRange {
  const end = startOfDay(now);
  const length = ANALYTICS_PERIODS.find((p) => p.id === period)?.days ?? null;
  if (length === null) {
    const start = earliest !== null && earliest < end ? startOfDay(earliest) : end;
    return { start, end, days: daysBetween(start, end) + 1 };
  }
  return { start: addDays(end, -(length - 1)), end, days: length };
}

/** The range of the same length just before `range`, for comparing with it. */
export function previousRange(range: DateRange): DateRange {
  return {
    start: addDays(range.start, -range.days),
    end: addDays(range.start, -1),
    days: range.days,
  };
}

/** Every day key in a range, oldest first. */
export function daysIn(range: DateRange): { day: string; at: Timestamp }[] {
  const result: { day: string; at: Timestamp }[] = [];
  for (let i = 0; i < range.days; i += 1) {
    const at = addDays(range.start, i);
    result.push({ day: dayKey(at), at });
  }
  return result;
}

function inRange(at: Timestamp, range: DateRange): boolean {
  return at >= range.start && at <= range.end;
}

export interface Totals {
  sessions: number;
  answered: number;
  correct: number;
  incorrect: number;
  /** From 0 to 1, or null when nothing was answered. */
  accuracy: number | null;
  /** Active study time recorded in sessions. */
  studyMs: number;
  /** The mean measured response time, or null when no answer was timed. */
  averageResponseMs: number | null;
  timedAnswers: number;
  activeDays: number;
  /** Review answers with no session behind them, so no time or deck. */
  untrackedAnswers: number;
}

export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

function totalsOf(entries: Iterable<DayActivity>): Totals {
  let sessions = 0;
  let answered = 0;
  let correct = 0;
  let studyMs = 0;
  let responseMs = 0;
  let timedAnswers = 0;
  let activeDays = 0;
  let untrackedAnswers = 0;
  for (const entry of entries) {
    sessions += entry.sessions;
    answered += entry.answered;
    correct += entry.correct;
    studyMs += entry.studyMs;
    responseMs += entry.responseMs;
    timedAnswers += entry.timedAnswers;
    untrackedAnswers += entry.untrackedAnswers;
    if (entry.answered > 0) activeDays += 1;
  }
  return {
    sessions,
    answered,
    correct,
    incorrect: answered - correct,
    accuracy: ratio(correct, answered),
    studyMs,
    averageResponseMs: timedAnswers > 0 ? Math.round(responseMs / timedAnswers) : null,
    timedAnswers,
    activeDays,
    untrackedAnswers,
  };
}

/** Totals over a range of days. */
export function totalsFor(base: AnalyticsBase, range: DateRange): Totals {
  return totalsOf(base.activeDays.filter((entry) => inRange(entry.at, range)));
}

export type TrendDirection = 'improving' | 'declining' | 'steady' | 'insufficient';

export interface Trend {
  direction: TrendDirection;
  earlier: number | null;
  later: number | null;
  /** later − earlier, in points from −1 to 1, or null when either is unknown. */
  change: number | null;
}

/**
 * Whether accuracy went up, down or stayed level between two stretches of
 * answers. Too few answers on either side is "insufficient", never a guess.
 */
export function compareAccuracy(
  earlier: { answered: number; correct: number },
  later: { answered: number; correct: number },
  minAnswers = MIN_TREND_ANSWERS,
  threshold = TREND_THRESHOLD,
): Trend {
  const before = ratio(earlier.correct, earlier.answered);
  const after = ratio(later.correct, later.answered);
  const change = before === null || after === null ? null : after - before;
  if (earlier.answered < minAnswers || later.answered < minAnswers || change === null) {
    return { direction: 'insufficient', earlier: before, later: after, change };
  }
  // A small tolerance keeps exact thresholds from flipping on rounding.
  if (change >= threshold - 1e-9)
    return { direction: 'improving', earlier: before, later: after, change };
  if (change <= -threshold + 1e-9)
    return { direction: 'declining', earlier: before, later: after, change };
  return { direction: 'steady', earlier: before, later: after, change };
}

/** Days with study activity, in the review log's shape, for the streak functions. */
function streakLog(base: AnalyticsBase): DailyActivity[] {
  return base.activeDays.map((entry) => ({
    day: entry.day,
    reviews: entry.answered,
    correct: entry.correct,
  }));
}

export interface StreakSummary {
  /** Days studied in a row up to today (or yesterday, while today is not over). */
  current: number;
  longest: number;
  /** Every day with study activity, ever. */
  totalActiveDays: number;
  studiedToday: boolean;
  /** The most recent day with study activity, or null. */
  lastActiveAt: Timestamp | null;
}

/**
 * Streaks, by one rule everywhere: a day counts when at least one answer was
 * recorded on it, in any mode. Days are local calendar days, so a 23- or
 * 25-hour day still counts once, and today does not break a streak before it
 * is over.
 */
export function streakSummary(base: AnalyticsBase, now: Timestamp): StreakSummary {
  const log = streakLog(base);
  const last = base.activeDays[base.activeDays.length - 1];
  return {
    current: currentStreak(log, now),
    longest: longestStreak(log),
    totalActiveDays: base.activeDays.length,
    studiedToday: base.days.has(dayKey(now)),
    lastActiveAt: last?.at ?? null,
  };
}

export interface Overview {
  range: DateRange;
  totals: Totals;
  /** The same figures for the period before, or null for "all time". */
  previous: Totals | null;
  /** Accuracy in this period compared with the one before. */
  accuracyTrend: Trend;
  streaks: StreakSummary;
}

export function overview(base: AnalyticsBase, period: AnalyticsPeriod, now: Timestamp): Overview {
  const range = periodRange(period, now, base.earliest);
  const totals = totalsFor(base, range);
  const previous = period === 'all' ? null : totalsFor(base, previousRange(range));
  return {
    range,
    totals,
    previous,
    accuracyTrend: previous
      ? compareAccuracy(previous, totals)
      : { direction: 'insufficient', earlier: null, later: totals.accuracy, change: null },
    streaks: streakSummary(base, now),
  };
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

export type Granularity = 'day' | 'week' | 'month';

export interface SeriesPoint {
  /** The day key of the bucket's first day. */
  key: string;
  start: Timestamp;
  /** Midnight at the start of the bucket's last day. */
  end: Timestamp;
  answered: number;
  correct: number;
  incorrect: number;
  accuracy: number | null;
  sessions: number;
  studyMs: number;
  activeDays: number;
  untrackedAnswers: number;
}

/** Monday at midnight, starting the week that holds `at`. Weeks run Monday to Sunday. */
export function startOfWeek(at: Timestamp): Timestamp {
  const weekday = new Date(startOfDay(at)).getDay();
  return addDays(at, -((weekday + 6) % 7));
}

export function startOfMonth(at: Timestamp): Timestamp {
  const date = new Date(startOfDay(at));
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function nextBucket(start: Timestamp, granularity: Granularity): Timestamp {
  if (granularity === 'day') return addDays(start, 1);
  if (granularity === 'week') return addDays(start, 7);
  const date = new Date(start);
  return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
}

/** Daily up to three months, weekly up to two years, monthly beyond. */
export function granularityFor(range: DateRange): Granularity {
  if (range.days <= 92) return 'day';
  if (range.days <= 731) return 'week';
  return 'month';
}

/** One point per day, week or month of the range, including the empty ones. */
export function activitySeries(
  base: AnalyticsBase,
  range: DateRange,
  granularity: Granularity = granularityFor(range),
): SeriesPoint[] {
  const first =
    granularity === 'day'
      ? range.start
      : granularity === 'week'
        ? startOfWeek(range.start)
        : startOfMonth(range.start);
  const points: SeriesPoint[] = [];
  let index = 0;
  const entries = base.activeDays;
  // Skip what lies before the range.
  while (index < entries.length && (entries[index] as DayActivity).at < range.start) index += 1;

  for (let start = first; start <= range.end; start = nextBucket(start, granularity)) {
    const following = nextBucket(start, granularity);
    const bucket: DayActivity[] = [];
    while (index < entries.length) {
      const entry = entries[index] as DayActivity;
      if (entry.at >= following || entry.at > range.end) break;
      bucket.push(entry);
      index += 1;
    }
    const totals = totalsOf(bucket);
    points.push({
      key: dayKey(start),
      start,
      end: Math.min(addDays(following, -1), range.end),
      answered: totals.answered,
      correct: totals.correct,
      incorrect: totals.incorrect,
      accuracy: totals.accuracy,
      sessions: totals.sessions,
      studyMs: totals.studyMs,
      activeDays: totals.activeDays,
      untrackedAnswers: totals.untrackedAnswers,
    });
  }
  return points;
}

export interface ModeTotals {
  mode: StudyMode;
  sessions: number;
  answered: number;
  correct: number;
  accuracy: number | null;
  studyMs: number;
}

/** Answers, accuracy and time in each mode over a range. */
export function modeBreakdown(base: AnalyticsBase, range: DateRange): ModeTotals[] {
  const totals = new Map<StudyMode, ModeTotals>(
    STUDY_MODES.map((mode) => [
      mode,
      { mode, sessions: 0, answered: 0, correct: 0, accuracy: null, studyMs: 0 },
    ]),
  );
  for (const entry of base.activeDays) {
    if (!inRange(entry.at, range)) continue;
    for (const mode of STUDY_MODES) {
      const target = totals.get(mode) as ModeTotals;
      target.answered += entry.byMode[mode].answered;
      target.correct += entry.byMode[mode].correct;
    }
  }
  for (const session of base.sessions) {
    const at = timestampFromDayKey(session.day);
    if (at === null || !inRange(at, range)) continue;
    const target = totals.get(session.mode) as ModeTotals;
    target.sessions += 1;
    target.studyMs += clampCount(session.durationMs);
  }
  return [...totals.values()].map((t) => ({ ...t, accuracy: ratio(t.correct, t.answered) }));
}

// ---------------------------------------------------------------------------
// The activity calendar and weekly summaries
// ---------------------------------------------------------------------------

export interface HeatmapCell {
  day: string;
  at: Timestamp;
  answered: number;
  /** 0 for nothing, then 1 to 4 by how busy the day was compared with the busiest. */
  level: 0 | 1 | 2 | 3 | 4;
  /** After today: drawn empty and never counted. */
  future: boolean;
}

/** Weeks, oldest first, each Monday to Sunday, ending with the current week. */
export function activityHeatmap(base: AnalyticsBase, now: Timestamp, weeks = 53): HeatmapCell[][] {
  const today = startOfDay(now);
  const first = addDays(startOfWeek(today), -7 * (weeks - 1));
  const columns: HeatmapCell[][] = [];
  let busiest = 0;
  for (let w = 0; w < weeks; w += 1) {
    const column: HeatmapCell[] = [];
    for (let d = 0; d < 7; d += 1) {
      const at = addDays(first, w * 7 + d);
      const day = dayKey(at);
      const future = at > today;
      const answered = future ? 0 : (base.days.get(day)?.answered ?? 0);
      busiest = Math.max(busiest, answered);
      column.push({ day, at, answered, level: 0, future });
    }
    columns.push(column);
  }
  for (const column of columns) {
    for (const cell of column) {
      if (cell.answered === 0 || busiest === 0) continue;
      const share = cell.answered / busiest;
      cell.level = share > 0.75 ? 4 : share > 0.5 ? 3 : share > 0.25 ? 2 : 1;
    }
  }
  return columns;
}

export interface WeekSummary {
  start: Timestamp;
  end: Timestamp;
  totals: Totals;
}

/** The last `weeks` weeks, newest first, the current week included. */
export function weeklySummaries(base: AnalyticsBase, now: Timestamp, weeks = 8): WeekSummary[] {
  const thisWeek = startOfWeek(now);
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(thisWeek, -7 * i);
    const range: DateRange = { start, end: addDays(start, 6), days: 7 };
    return { start, end: range.end, totals: totalsFor(base, range) };
  });
}

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

/** The deck an answer in `session` on `cardId` counts towards, or null when it cannot be told. */
function deckOfAnswer(base: AnalyticsBase, session: StudySession, cardId: string): string | null {
  // Answers follow their card, as learning progress does: a card moved to
  // another deck takes its history with it.
  const card = base.cards.get(cardId);
  if (card) return card.deckId;
  // A deleted card's answers count towards the deck the session was started on.
  return session.deckId;
}

interface DeckTally {
  answered: number;
  correct: number;
  sessions: Set<string>;
  days: Map<string, number>;
  lastAt: Timestamp | null;
}

function tallyFor(map: Map<string, DeckTally>, deckId: string): DeckTally {
  let tally = map.get(deckId);
  if (!tally) {
    tally = { answered: 0, correct: 0, sessions: new Set(), days: new Map(), lastAt: null };
    map.set(deckId, tally);
  }
  return tally;
}

/**
 * Adds every answer in `sessions` to the deck it belongs to. A session that no
 * longer keeps its per-card detail counts as a whole towards the deck it was
 * started on, or nowhere when it covered every deck.
 */
function tallyDecks(
  base: AnalyticsBase,
  sessions: readonly StudySession[],
): Map<string, DeckTally> {
  const tallies = new Map<string, DeckTally>();
  const add = (deckId: string, session: StudySession, answered: number, correct: number) => {
    if (answered <= 0) return;
    const tally = tallyFor(tallies, deckId);
    tally.answered += answered;
    tally.correct += correct;
    tally.sessions.add(session.id);
    tally.days.set(session.day, (tally.days.get(session.day) ?? 0) + answered);
    tally.lastAt = Math.max(tally.lastAt ?? 0, session.endedAt);
  };
  for (const session of sessions) {
    if (session.results.length === 0) {
      if (session.deckId !== null) {
        add(session.deckId, session, session.answered, Math.min(session.correct, session.answered));
      }
      continue;
    }
    for (const result of session.results) {
      const deckId = deckOfAnswer(base, session, result.cardId);
      if (deckId === null) continue;
      add(
        deckId,
        session,
        clampCount(result.correct) + clampCount(result.incorrect),
        clampCount(result.correct),
      );
    }
  }
  return tallies;
}

function sessionsIn(base: AnalyticsBase, range: DateRange): StudySession[] {
  return base.sessions.filter((session) => {
    const at = timestampFromDayKey(session.day);
    return at !== null && inRange(at, range);
  });
}

export interface DeckPerformance {
  deck: Deck;
  /** Every card in the deck, and those that can be reviewed. */
  cards: number;
  counts: ProgressCounts;
  /** Cards that have ever been answered, in any mode. */
  cardsStudied: number;
  /** Answers in the period. */
  answered: number;
  correct: number;
  incorrect: number;
  accuracy: number | null;
  sessions: number;
  activeDays: number;
  /** The last time any card in the deck was answered, or null. */
  lastStudiedAt: Timestamp | null;
  /** Answers on each of the last {@link TREND_WINDOW_DAYS} days, oldest first. */
  recentActivity: number[];
  /** The last {@link TREND_WINDOW_DAYS} days compared with the same stretch before. */
  trend: Trend;
}

/**
 * How every deck is doing, including decks with no cards or no history.
 *
 * Answers come from sessions in the period. For "all time", Review answers
 * are taken from each card's lifetime record instead, which also covers
 * reviews made before sessions were recorded; answers from the other modes
 * still come from sessions. Either way an answer is counted once.
 */
export function deckPerformance(
  base: AnalyticsBase,
  period: AnalyticsPeriod,
  now: Timestamp,
): DeckPerformance[] {
  const range = periodRange(period, now, base.earliest);
  const lifetimeReviews = period === 'all';
  const periodSessions = sessionsIn(base, range).filter(
    (session) => !lifetimeReviews || session.mode !== 'review',
  );
  const inPeriod = tallyDecks(base, periodSessions);
  const ever = tallyDecks(base, base.sessions);

  const today = startOfDay(now);
  const recentRange: DateRange = {
    start: addDays(today, -(TREND_WINDOW_DAYS - 1)),
    end: today,
    days: TREND_WINDOW_DAYS,
  };
  const recent = tallyDecks(base, sessionsIn(base, recentRange));
  const before = tallyDecks(base, sessionsIn(base, previousRange(recentRange)));
  const recentDays = daysIn(recentRange);

  const cardsByDeck = new Map<string, Card[]>();
  for (const deck of base.input.data.decks) cardsByDeck.set(deck.id, []);
  for (const card of base.input.data.cards) cardsByDeck.get(card.deckId)?.push(card);

  const studiedCards = new Set<string>(base.input.records.keys());
  for (const session of base.sessions) {
    for (const result of session.results) studiedCards.add(result.cardId);
  }

  return base.input.data.decks.map((deck) => {
    const cards = cardsByDeck.get(deck.id) ?? [];
    const tally = inPeriod.get(deck.id);
    let answered = tally?.answered ?? 0;
    let correct = tally?.correct ?? 0;
    let lastStudiedAt = ever.get(deck.id)?.lastAt ?? null;
    for (const card of cards) {
      const record = base.input.records.get(card.id);
      if (!record) continue;
      if (lifetimeReviews) {
        answered += record.reviews;
        correct += Math.min(record.correct, record.reviews);
      }
      lastStudiedAt = Math.max(lastStudiedAt ?? 0, record.lastReviewedAt);
    }
    const recentTally = recent.get(deck.id);
    return {
      deck,
      cards: cards.length,
      counts: countProgress(cards, base.input.records, now),
      cardsStudied: cards.filter((card) => studiedCards.has(card.id)).length,
      answered,
      correct,
      incorrect: answered - correct,
      accuracy: ratio(correct, answered),
      sessions: tally?.sessions.size ?? 0,
      activeDays: tally?.days.size ?? 0,
      lastStudiedAt,
      recentActivity: recentDays.map(({ day }) => recentTally?.days.get(day) ?? 0),
      trend: compareAccuracy(
        before.get(deck.id) ?? { answered: 0, correct: 0 },
        recentTally ?? { answered: 0, correct: 0 },
      ),
    };
  });
}

export type DeckSort = 'accuracy' | 'reviewed' | 'name' | 'recent';

/**
 * Decks in the chosen order. Decks with no answers always come last, so
 * "highest accuracy" never puts an unstudied deck at the top.
 */
export function sortDecks(
  decks: readonly DeckPerformance[],
  sort: DeckSort,
  direction: 'asc' | 'desc' = 'desc',
): DeckPerformance[] {
  const sign = direction === 'desc' ? -1 : 1;
  const byName = (a: DeckPerformance, b: DeckPerformance) =>
    a.deck.name.localeCompare(b.deck.name) || (a.deck.id < b.deck.id ? -1 : 1);
  return [...decks].sort((a, b) => {
    if (sort === 'name') return direction === 'asc' ? byName(a, b) : byName(b, a);
    if (sort === 'accuracy') {
      if (a.accuracy === null || b.accuracy === null) {
        if (a.accuracy === b.accuracy) return byName(a, b);
        return a.accuracy === null ? 1 : -1;
      }
      return sign * (a.accuracy - b.accuracy) || sign * (a.answered - b.answered) || byName(a, b);
    }
    if (sort === 'recent') {
      if (a.lastStudiedAt === null || b.lastStudiedAt === null) {
        if (a.lastStudiedAt === b.lastStudiedAt) return byName(a, b);
        return a.lastStudiedAt === null ? 1 : -1;
      }
      return sign * (a.lastStudiedAt - b.lastStudiedAt) || byName(a, b);
    }
    return sign * (a.answered - b.answered) || byName(a, b);
  });
}

/**
 * The decks with the highest and lowest accuracy, among decks with enough
 * answers to say. Both are null when fewer than two decks qualify.
 */
export function strongestAndWeakest(decks: readonly DeckPerformance[]): {
  strongest: DeckPerformance | null;
  weakest: DeckPerformance | null;
} {
  const ranked = sortDecks(
    decks.filter((d) => d.answered >= MIN_RANKED_DECK_ANSWERS && d.accuracy !== null),
    'accuracy',
  );
  if (ranked.length < 2) return { strongest: null, weakest: null };
  const strongest = ranked[0] as DeckPerformance;
  const weakest = ranked[ranked.length - 1] as DeckPerformance;
  if (strongest.accuracy === weakest.accuracy) return { strongest: null, weakest: null };
  return { strongest, weakest };
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** How one card went in one session: every answer right, every answer wrong, or both. */
export type SessionOutcome = 'correct' | 'missed' | 'mixed';

export interface CardPerformance {
  card: Card;
  /** Answers on this card: lifetime Review answers, plus answers in the other modes. */
  attempts: number;
  correct: number;
  incorrect: number;
  accuracy: number | null;
  lastAnsweredAt: Timestamp | null;
  /** Its most recent sessions, oldest first, at most {@link WEAK_RECENT_SESSIONS}. */
  recent: SessionOutcome[];
  /** Times it was forgotten in Review ("Again"). */
  reviewLapses: number;
  /** Correct Review answers in a row right now, or null when never reviewed. */
  reviewStreak: number | null;
}

/**
 * Every card's answer history, for cards that still exist. Review answers are
 * the card's lifetime record; Quiz, Learn and Match answers come from the
 * sessions that keep per-card detail.
 */
export function cardPerformance(base: AnalyticsBase): Map<string, CardPerformance> {
  const result = new Map<string, CardPerformance>();
  const recentByCard = new Map<string, { at: Timestamp; outcome: SessionOutcome }[]>();

  for (const card of base.input.data.cards) {
    const record = base.input.records.get(card.id);
    result.set(card.id, {
      card,
      attempts: record?.reviews ?? 0,
      correct: Math.min(record?.correct ?? 0, record?.reviews ?? 0),
      incorrect: 0,
      accuracy: null,
      lastAnsweredAt: record?.lastReviewedAt ?? null,
      recent: [],
      reviewLapses: record?.incorrect ?? 0,
      reviewStreak: record ? record.streak : null,
    });
  }

  for (const session of base.sessions) {
    for (const r of session.results) {
      const entry = result.get(r.cardId);
      if (!entry) continue;
      const correct = clampCount(r.correct);
      const incorrect = clampCount(r.incorrect);
      if (correct + incorrect === 0) continue;
      if (session.mode !== 'review') {
        entry.attempts += correct + incorrect;
        entry.correct += correct;
      }
      entry.lastAnsweredAt = Math.max(entry.lastAnsweredAt ?? 0, session.endedAt);
      const outcome: SessionOutcome =
        incorrect === 0 ? 'correct' : correct === 0 ? 'missed' : 'mixed';
      const list = recentByCard.get(r.cardId) ?? [];
      list.push({ at: session.endedAt, outcome });
      recentByCard.set(r.cardId, list);
    }
  }

  for (const entry of result.values()) {
    entry.incorrect = entry.attempts - entry.correct;
    entry.accuracy = ratio(entry.correct, entry.attempts);
    const list = recentByCard.get(entry.card.id) ?? [];
    list.sort((a, b) => a.at - b.at);
    entry.recent = list.slice(-WEAK_RECENT_SESSIONS).map((item) => item.outcome);
  }
  return result;
}

export type WeakReason =
  | { kind: 'low-accuracy'; correct: number; attempts: number }
  | { kind: 'recent-misses'; missed: number; sessions: number }
  | { kind: 'review-lapses'; lapses: number };

export interface WeakCard extends CardPerformance {
  /** Higher is weaker. Used only to order the list. */
  score: number;
  /** Why the card is on the list, in plain terms the page can show. */
  reasons: WeakReason[];
}

/**
 * Cards the user keeps getting wrong, judged on their actual answers.
 *
 * A card qualifies only with at least {@link WEAK_MIN_ATTEMPTS} answers and
 * {@link WEAK_MIN_MISSES} wrong ones, so a single slip never puts a card here.
 * It is then weak when either:
 *
 * - fewer than {@link WEAK_ACCURACY} of its answers were right, or
 * - it was missed in at least two of its last {@link WEAK_RECENT_SESSIONS} sessions.
 *
 * A card answered correctly in each of its last three sessions is left off:
 * it has been learned since, whatever its older answers say.
 */
export function findWeakCards(
  performance: ReadonlyMap<string, CardPerformance>,
  deckId: string | null = null,
): WeakCard[] {
  const weak: WeakCard[] = [];
  for (const entry of performance.values()) {
    if (deckId !== null && entry.card.deckId !== deckId) continue;
    if (entry.attempts < WEAK_MIN_ATTEMPTS || entry.incorrect < WEAK_MIN_MISSES) continue;
    const recentMisses = entry.recent.filter((outcome) => outcome !== 'correct').length;
    const recovered = entry.recent.length >= WEAK_RECENT_SESSIONS && recentMisses === 0;
    if (recovered) continue;

    const accuracy = entry.accuracy ?? 0;
    const reasons: WeakReason[] = [];
    if (accuracy < WEAK_ACCURACY) {
      reasons.push({ kind: 'low-accuracy', correct: entry.correct, attempts: entry.attempts });
    }
    if (recentMisses >= 2) {
      reasons.push({ kind: 'recent-misses', missed: recentMisses, sessions: entry.recent.length });
    }
    if (reasons.length === 0) continue;
    if (entry.reviewLapses >= 2)
      reasons.push({ kind: 'review-lapses', lapses: entry.reviewLapses });

    weak.push({
      ...entry,
      score: (1 - accuracy) * Math.log2(1 + entry.attempts) + 0.5 * recentMisses,
      reasons,
    });
  }
  return weak.sort(
    (a, b) =>
      b.score - a.score ||
      (b.lastAnsweredAt ?? 0) - (a.lastAnsweredAt ?? 0) ||
      (a.card.id < b.card.id ? -1 : 1),
  );
}

// ---------------------------------------------------------------------------
// Retention: what the spaced repetition schedule says, kept apart from accuracy
// ---------------------------------------------------------------------------

export interface RetentionEstimate {
  counts: ProgressCounts;
  /** The mean interval of reviewed cards, in days, or null when none is scheduled. */
  averageIntervalDays: number | null;
  /** Review answers in the period, and how many were remembered. Observed, not estimated. */
  reviewAnswered: number;
  reviewCorrect: number;
  reviewAccuracy: number | null;
}

/**
 * Two different things, kept apart:
 *
 * - **Observed recall**: the share of Review answers in the period that were
 *   remembered. A measurement of past answers.
 * - **Estimated memory strength**: where the scheduler has placed each card.
 *   An estimate of how long each card will be remembered, not a measurement:
 *   the scheduler only knows what the user answered.
 */
export function retentionEstimate(
  base: AnalyticsBase,
  range: DateRange,
  now: Timestamp,
): RetentionEstimate {
  const counts = countProgress(base.input.data.cards, base.input.records, now);
  let intervalSum = 0;
  let scheduled = 0;
  for (const card of base.input.data.cards) {
    if (!isReviewable(card)) continue;
    const record = base.input.records.get(card.id);
    if (!record) continue;
    intervalSum += record.intervalDays;
    scheduled += 1;
  }
  let reviewAnswered = 0;
  let reviewCorrect = 0;
  for (const entry of base.activeDays) {
    if (!inRange(entry.at, range)) continue;
    reviewAnswered += entry.byMode.review.answered;
    reviewCorrect += entry.byMode.review.correct;
  }
  return {
    counts,
    averageIntervalDays: scheduled > 0 ? intervalSum / scheduled : null,
    reviewAnswered,
    reviewCorrect,
    reviewAccuracy: ratio(reviewCorrect, reviewAnswered),
  };
}

// ---------------------------------------------------------------------------
// Study history
// ---------------------------------------------------------------------------

export type PerformanceBand = 'all' | 'strong' | 'fair' | 'weak';

export interface HistoryFilter {
  /** First and last day to include, as `YYYY-MM-DD`, or null for no limit. */
  from: string | null;
  to: string | null;
  /** A deck ID, or null for every deck. */
  deckId: string | null;
  performance: PerformanceBand;
}

export const NO_HISTORY_FILTER: HistoryFilter = {
  from: null,
  to: null,
  deckId: null,
  performance: 'all',
};

export interface HistoryEntry {
  session: StudySession;
  incorrect: number;
  accuracy: number | null;
  /** The decks the session touched, as far as can be told (decks that still exist). */
  deckIds: string[];
  /** The session was started on a deck that has since been deleted. */
  deckDeleted: boolean;
}

export function performanceBand(accuracy: number | null): Exclude<PerformanceBand, 'all'> | null {
  if (accuracy === null) return null;
  if (accuracy >= STRONG_ACCURACY) return 'strong';
  if (accuracy >= FAIR_ACCURACY) return 'fair';
  return 'weak';
}

/** Recorded sessions, newest first, narrowed by the filter. */
export function studyHistory(base: AnalyticsBase, filter: HistoryFilter): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (let i = base.sessions.length - 1; i >= 0; i -= 1) {
    const session = base.sessions[i] as StudySession;
    if (filter.from !== null && session.day < filter.from) continue;
    if (filter.to !== null && session.day > filter.to) continue;
    const accuracy = ratio(Math.min(session.correct, session.answered), session.answered);
    if (filter.performance !== 'all' && performanceBand(accuracy) !== filter.performance) continue;

    const deckIds = new Set<string>();
    if (session.deckId !== null && base.decks.has(session.deckId)) deckIds.add(session.deckId);
    for (const result of session.results) {
      const deckId = deckOfAnswer(base, session, result.cardId);
      if (deckId !== null && base.decks.has(deckId)) deckIds.add(deckId);
    }
    if (filter.deckId !== null && !deckIds.has(filter.deckId)) continue;

    entries.push({
      session,
      incorrect: Math.max(0, session.answered - session.correct),
      accuracy,
      deckIds: [...deckIds],
      deckDeleted: session.deckId !== null && !base.decks.has(session.deckId),
    });
  }
  return entries;
}

export interface Page<T> {
  items: T[];
  /** From 1. */
  page: number;
  pages: number;
  total: number;
}

export function paginate<T>(items: readonly T[], page: number, size: number): Page<T> {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return {
    items: items.slice((current - 1) * size, current * size),
    page: current,
    pages,
    total: items.length,
  };
}

/** Days whose Review answers have no session behind them, so are not in the history list. */
export function untrackedDays(base: AnalyticsBase): number {
  return base.activeDays.filter((entry) => entry.untrackedAnswers > 0).length;
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface GoalPeriodResult {
  start: Timestamp;
  end: Timestamp;
  /** The target that applied then, or null when the goal was off. */
  target: number | null;
  value: number;
  /** Null when there was no target to meet. */
  met: boolean | null;
  /** The period still running. */
  current: boolean;
}

export interface GoalProgress {
  kind: GoalKind;
  target: number;
  value: number;
  /** value / target, from 0 (can pass 1). */
  fraction: number;
  met: boolean;
  remaining: number;
  /** Recent periods, oldest first, the current one last. */
  history: GoalPeriodResult[];
}

function goalValue(base: AnalyticsBase, kind: GoalKind, range: DateRange): number {
  const totals = totalsFor(base, range);
  switch (kind) {
    case 'cards-per-day':
      return totals.answered;
    case 'minutes-per-day':
      return Math.floor(totals.studyMs / 60_000);
    case 'sessions-per-week':
      return totals.sessions;
    case 'days-per-week':
      return totals.activeDays;
  }
}

/** How many past days and weeks each goal's history shows, the current one included. */
export const GOAL_HISTORY_DAYS = 14;
export const GOAL_HISTORY_WEEKS = 8;

/** Progress on every goal that is switched on, with how recent periods went. */
export function goalProgress(base: AnalyticsBase, now: Timestamp): GoalProgress[] {
  const result: GoalProgress[] = [];
  for (const kind of GOAL_KINDS) {
    const goal = base.input.goals.find((g) => g.id === kind);
    if (!goal || goal.target === null) continue;
    const daily = GOAL_DEFINITIONS[kind].period === 'day';
    const count = daily ? GOAL_HISTORY_DAYS : GOAL_HISTORY_WEEKS;
    const currentStart = daily ? startOfDay(now) : startOfWeek(now);

    const history: GoalPeriodResult[] = [];
    for (let i = count - 1; i >= 0; i -= 1) {
      const start = addDays(currentStart, -(daily ? 1 : 7) * i);
      const days = daily ? 1 : 7;
      const end = addDays(start, days - 1);
      const current = i === 0;
      const range: DateRange = { start, end: current ? startOfDay(now) : end, days };
      // A past period is judged by the target at its end; the current one by today's.
      const target = current ? goal.target : targetAt(goal, addDays(end, 1) - 1);
      const value = goalValue(base, kind, range);
      history.push({
        start,
        end,
        target,
        value,
        met: target === null ? null : value >= target,
        current,
      });
    }
    const latest = history[history.length - 1] as GoalPeriodResult;
    result.push({
      kind,
      target: goal.target,
      value: latest.value,
      fraction: goal.target > 0 ? latest.value / goal.target : 0,
      met: latest.value >= goal.target,
      remaining: Math.max(0, goal.target - latest.value),
      history,
    });
  }
  return result;
}
