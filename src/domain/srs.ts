import type { Timestamp } from './types';

/**
 * The spaced repetition engine: everything that decides when a card comes back.
 *
 * It is a simplified, SM-2-inspired scheduler. Every function here is pure and
 * takes the current time as an argument, so scheduling can be tested to the
 * day without waiting or mocking the clock. Nothing in this module reads
 * storage or knows about React.
 *
 * Intervals are whole days, and a card scheduled days ahead falls due at the
 * *start* of that local day. A card answered at 23:50 with a one-day interval
 * is therefore due ten minutes later, at midnight, rather than at 23:50 the
 * next night: "tomorrow" means the calendar day, which is what a learner
 * expects and what keeps "due today" stable across time zones and DST.
 */

/** How well the user remembered a card, from worst to best. */
export const REVIEW_GRADES = ['again', 'hard', 'good', 'easy'] as const;

export type ReviewGrade = (typeof REVIEW_GRADES)[number];

/**
 * How far a card has come.
 * - `learning`: answered wrongly, or not yet past the first scheduled days.
 * - `review`: on a multi-day schedule.
 * - `mastered`: scheduled {@link MASTERED_INTERVAL_DAYS} days or more ahead.
 *
 * A card with no record at all is "new"; see {@link cardState}.
 */
export type LearningStage = 'learning' | 'review' | 'mastered';

/** What the app remembers about how well one card is known. */
export interface CardProgress {
  cardId: string;
  /** The deck the card was in when it was last reviewed; kept in step with the card. */
  deckId: string;
  /** How many times the card has been graded. */
  reviews: number;
  /** Grades of "hard", "good" or "easy". */
  correct: number;
  /** Grades of "again". */
  incorrect: number;
  stage: LearningStage;
  /** Days between the last review and the next one. 0 while a card is being relearned. */
  intervalDays: number;
  /** How easily the card is remembered; the multiplier used to grow the interval. */
  ease: number;
  lastReviewedAt: Timestamp;
  /** When the card next falls due. */
  dueAt: Timestamp;
  /** Correct answers in a row. Reset to 0 by "again". */
  streak: number;
}

/** Where a card stands right now. "new" means it has never been reviewed. */
export type CardState = 'new' | 'overdue' | 'due' | 'scheduled';

export const START_EASE = 2.5;
export const MIN_EASE = 1.3;
export const MAX_EASE = 2.8;

/** How the ease moves with each grade. */
export const EASE_DELTA: Record<ReviewGrade, number> = {
  again: -0.2,
  hard: -0.15,
  good: 0,
  easy: 0.15,
};

/** The first three successful intervals, in days. Later ones are grown by the ease. */
export const INTERVAL_LADDER = [1, 3, 7] as const;

/** A "hard" answer grows the interval by this much instead of by the ease. */
export const HARD_FACTOR = 1.2;

/** An "easy" answer stretches whatever the interval would have been. */
export const EASY_BONUS = 1.3;

export const MIN_INTERVAL_DAYS = 1;

/** No card is ever scheduled further out than a year. */
export const MAX_INTERVAL_DAYS = 365;

/** From this interval on, a card counts as mastered. */
export const MASTERED_INTERVAL_DAYS = 21;

/** How long a card forgotten in this session waits before coming back. */
export const RELEARN_MINUTES = 10;

/** At or below this ease, a card is treated as difficult. */
export const DIFFICULT_EASE = 2.0;

/** A card is difficult once it has been forgotten this many times. */
export const DIFFICULT_LAPSES = 2;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function isUsableTimestamp(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** Midnight at the start of the local day holding `at`. */
export function startOfDay(at: Timestamp): Timestamp {
  const date = new Date(isUsableTimestamp(at) ? at : Date.now());
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Midnight at the start of the local day `days` after the one holding `at`.
 * Calendar arithmetic, so a day that is 23 or 25 hours long still counts once.
 */
export function addDays(at: Timestamp, days: number): Timestamp {
  const whole = Number.isFinite(days) ? Math.trunc(days) : 0;
  const date = new Date(startOfDay(at));
  date.setDate(date.getDate() + whole);
  // A jump across a DST boundary can land at 23:00 the day before, so the time
  // of day is set again rather than assumed.
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** The local calendar day of `at`, as `YYYY-MM-DD`. Days are compared as strings. */
export function dayKey(at: Timestamp): string {
  const date = new Date(isUsableTimestamp(at) ? at : Date.now());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Whole local days from the day of `from` to the day of `to`; negative when `to` is earlier. */
export function daysBetween(from: Timestamp, to: Timestamp): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampEase(ease: number): number {
  return Number.isFinite(ease) ? clamp(ease, MIN_EASE, MAX_EASE) : START_EASE;
}

export function clampInterval(days: number): number {
  if (!Number.isFinite(days)) return MIN_INTERVAL_DAYS;
  return clamp(Math.round(days), MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS);
}

/**
 * What "good" would schedule: the first three successes follow a fixed ladder
 * (1, 3, then 7 days), and after that the interval is multiplied by the card's
 * ease, so a card answered well keeps moving further out.
 */
function goodInterval(previous: number, streak: number, ease: number): number {
  const ladder = INTERVAL_LADDER[streak - 1];
  const base = ladder ?? previous * clampEase(ease);
  return clampInterval(Math.max(base, previous));
}

/**
 * The next interval after a correct answer, in whole days.
 *
 * The three correct grades are kept in order by construction: "hard" never
 * reaches past what "good" would have scheduled, and "easy" always reaches
 * past it. The result is never shorter than the previous interval either, so
 * remembering a card can only ever push it further away.
 */
export function nextInterval(
  previousDays: number,
  streak: number,
  ease: number,
  grade: Exclude<ReviewGrade, 'again'>,
): number {
  const previous = Number.isFinite(previousDays) ? Math.max(0, previousDays) : 0;
  const step = Math.max(1, Math.trunc(streak));
  const good = goodInterval(previous, step, ease);

  if (grade === 'hard') {
    const hard = previous < MIN_INTERVAL_DAYS ? MIN_INTERVAL_DAYS : previous * HARD_FACTOR;
    return Math.min(clampInterval(hard), good);
  }
  if (grade === 'easy') {
    // Rounded up, so "easy" always reaches further than "good" would have.
    return clampInterval(Math.max(Math.ceil(good * EASY_BONUS), previous));
  }
  return good;
}

/** The stage an interval puts a card in. */
export function stageForInterval(intervalDays: number): LearningStage {
  if (intervalDays >= MASTERED_INTERVAL_DAYS) return 'mastered';
  return intervalDays >= MIN_INTERVAL_DAYS ? 'review' : 'learning';
}

export interface GradeContext {
  cardId: string;
  deckId: string;
  now: Timestamp;
}

/** A card that has never been reviewed, as the scheduler sees it before its first grade. */
function blankProgress({ cardId, deckId, now }: GradeContext): CardProgress {
  return {
    cardId,
    deckId,
    reviews: 0,
    correct: 0,
    incorrect: 0,
    stage: 'learning',
    intervalDays: 0,
    ease: START_EASE,
    lastReviewedAt: now,
    dueAt: now,
    streak: 0,
  };
}

/**
 * Applies one answer to a card's record and returns the new one.
 *
 * `previous` is left untouched; pass `undefined` for a card being reviewed for
 * the first time. "Again" clears the streak, lowers the ease and brings the
 * card back in a few minutes; the other grades schedule it days ahead.
 */
export function gradeProgress(
  previous: CardProgress | undefined,
  grade: ReviewGrade,
  context: GradeContext,
): CardProgress {
  const { cardId, deckId, now } = context;
  const at = isUsableTimestamp(now) ? now : Date.now();
  const base = previous ?? blankProgress(context);
  const ease = clampEase(base.ease + EASE_DELTA[grade]);

  const counted = {
    ...base,
    cardId,
    deckId,
    ease,
    reviews: base.reviews + 1,
    lastReviewedAt: at,
  };

  if (grade === 'again') {
    return {
      ...counted,
      incorrect: base.incorrect + 1,
      streak: 0,
      // Back to the start of the schedule: the next success begins the ladder again.
      intervalDays: 0,
      stage: 'learning',
      dueAt: at + RELEARN_MINUTES * MINUTE_MS,
    };
  }

  const streak = base.streak + 1;
  const intervalDays = nextInterval(base.intervalDays, streak, ease, grade);
  return {
    ...counted,
    correct: base.correct + 1,
    streak,
    intervalDays,
    stage: stageForInterval(intervalDays),
    dueAt: addDays(at, intervalDays),
  };
}

/** Whether a card is waiting to be reviewed. A card with no record never is: it is new. */
export function isDue(progress: CardProgress | undefined, now: Timestamp): boolean {
  return progress !== undefined && progress.dueAt <= now;
}

/** Where a card stands: never reviewed, waiting from an earlier day, waiting now, or scheduled. */
export function cardState(progress: CardProgress | undefined, now: Timestamp): CardState {
  if (!progress) return 'new';
  if (progress.dueAt < startOfDay(now)) return 'overdue';
  return progress.dueAt <= now ? 'due' : 'scheduled';
}

/** How many days late a card is, or 0 when it is not overdue. */
export function daysOverdue(progress: CardProgress | undefined, now: Timestamp): number {
  if (!progress) return 0;
  return Math.max(0, daysBetween(progress.dueAt, now));
}

/** The share of answers that were correct, from 0 to 1. 0 for a card never reviewed. */
export function retention(progress: CardProgress | undefined): number {
  if (!progress || progress.reviews === 0) return 0;
  return progress.correct / progress.reviews;
}

/**
 * How far a card has come through its schedule, from 0 (new) to 1 (mastered).
 *
 * Derived from the interval rather than stored, so it can never drift out of
 * step with the record it describes.
 */
export function mastery(progress: CardProgress | undefined): number {
  if (!progress) return 0;
  return clamp(progress.intervalDays / MASTERED_INTERVAL_DAYS, 0, 1);
}

/** Whether a card keeps being forgotten, by its ease or by how often it has been missed. */
export function isDifficult(progress: CardProgress | undefined): boolean {
  if (!progress || progress.reviews === 0) return false;
  return progress.ease <= DIFFICULT_EASE || progress.incorrect >= DIFFICULT_LAPSES;
}

/** A short description of when a card is next due, such as "in 3 days". */
export function describeDue(progress: CardProgress | undefined, now: Timestamp): string {
  if (!progress) return 'New card';
  if (progress.dueAt <= now) {
    const late = daysOverdue(progress, now);
    if (late <= 0) return 'Due now';
    return late === 1 ? 'Due since yesterday' : `Due for ${late} days`;
  }
  const days = daysBetween(now, progress.dueAt);
  if (days <= 0) return 'Due later today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}
