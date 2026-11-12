import { isReviewable } from './reviewQueue';
import {
  addDays,
  cardState,
  dayKey,
  daysBetween,
  isDifficult,
  mastery,
  type CardProgress,
} from './srs';
import type { AppData, Card, Timestamp } from './types';

/**
 * Learning statistics, worked out from the saved records themselves.
 *
 * Nothing here is kept as a separate running total, so a number on the deck
 * list can never disagree with the records behind it: delete a card, and every
 * figure that mentioned it changes on the next render.
 */

/** One day's reviewing, as recorded while the user worked. */
export interface DailyActivity {
  /** The local calendar day, as `YYYY-MM-DD`. */
  day: string;
  reviews: number;
  correct: number;
}

/** How a set of cards stands. All counts are over the cards in scope. */
export interface ProgressCounts {
  /** Every card, including any that cannot be reviewed. */
  total: number;
  /** Cards with both a term and a definition, which are the ones that can be reviewed. */
  reviewable: number;
  /** Reviewable cards that have never been reviewed. */
  newCards: number;
  /** Answered wrongly, or not yet on a multi-day schedule. */
  learning: number;
  /** On a schedule, but not far enough along to count as mastered. */
  review: number;
  mastered: number;
  /** Waiting now, including the overdue ones. */
  due: number;
  /** Waiting since an earlier day. */
  overdue: number;
  /** Cards with at least one review. */
  reviewed: number;
  difficult: number;
  /** How far the cards have come on average, from 0 to 1. */
  mastery: number;
}

/** All zeroes, for a deck that holds nothing. */
export function emptyProgressCounts(): ProgressCounts {
  return { ...EMPTY_COUNTS };
}

const EMPTY_COUNTS: ProgressCounts = {
  total: 0,
  reviewable: 0,
  newCards: 0,
  learning: 0,
  review: 0,
  mastered: 0,
  due: 0,
  overdue: 0,
  reviewed: 0,
  difficult: 0,
  mastery: 0,
};

export function countProgress(
  cards: readonly Card[],
  records: ReadonlyMap<string, CardProgress>,
  now: Timestamp,
): ProgressCounts {
  const counts: ProgressCounts = { ...EMPTY_COUNTS, total: cards.length };
  let masterySum = 0;

  for (const card of cards) {
    if (!isReviewable(card)) continue;
    counts.reviewable += 1;

    const progress = records.get(card.id);
    masterySum += mastery(progress);
    if (!progress) {
      counts.newCards += 1;
      continue;
    }

    counts.reviewed += 1;
    if (progress.stage === 'mastered') counts.mastered += 1;
    else if (progress.stage === 'review') counts.review += 1;
    else counts.learning += 1;

    if (isDifficult(progress)) counts.difficult += 1;

    const state = cardState(progress, now);
    if (state === 'overdue') {
      counts.overdue += 1;
      counts.due += 1;
    } else if (state === 'due') {
      counts.due += 1;
    }
  }

  counts.mastery = counts.reviewable === 0 ? 0 : masterySum / counts.reviewable;
  return counts;
}

/** The same counts for every deck, including decks that hold no cards. */
export function countProgressByDeck(
  data: AppData,
  records: ReadonlyMap<string, CardProgress>,
  now: Timestamp,
): Map<string, ProgressCounts> {
  const byDeck = new Map<string, Card[]>();
  for (const deck of data.decks) byDeck.set(deck.id, []);
  for (const card of data.cards) {
    const cards = byDeck.get(card.deckId);
    if (cards) cards.push(card);
  }

  const counts = new Map<string, ProgressCounts>();
  for (const [deckId, cards] of byDeck) counts.set(deckId, countProgress(cards, records, now));
  return counts;
}

/** `YYYY-MM-DD` as a local timestamp, or null when it is not a day. */
export function timestampFromDayKey(key: string): Timestamp | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [, year, month, day] = match as unknown as [string, string, string, string];
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return null;
  // Rejects days that rolled over, such as 2024-02-31.
  if (date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
  return date.getTime();
}

/** Days with at least one review, oldest first. Anything unparsable is left out. */
function studiedDays(history: readonly DailyActivity[]): Timestamp[] {
  return history
    .filter((entry) => entry.reviews > 0)
    .map((entry) => timestampFromDayKey(entry.day))
    .filter((day): day is Timestamp => day !== null)
    .sort((a, b) => a - b);
}

/**
 * Days studied in a row, counting back from today. A day missed ends the
 * streak, but today not being over does not: a streak that ran up to
 * yesterday still counts until midnight.
 */
export function currentStreak(history: readonly DailyActivity[], now: Timestamp): number {
  const days = studiedDays(history);
  if (days.length === 0) return 0;

  const last = days[days.length - 1] as Timestamp;
  const sinceLast = daysBetween(last, now);
  if (sinceLast > 1) return 0;

  let streak = 1;
  for (let i = days.length - 1; i > 0; i--) {
    const gap = daysBetween(days[i - 1] as Timestamp, days[i] as Timestamp);
    if (gap !== 1) break;
    streak += 1;
  }
  return streak;
}

/** The longest run of consecutive days studied, ever. */
export function longestStreak(history: readonly DailyActivity[]): number {
  const days = studiedDays(history);
  let longest = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    const previous = i === 0 ? null : (days[i - 1] as Timestamp);
    run = previous !== null && daysBetween(previous, days[i] as Timestamp) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  return longest;
}

/** How many cards fall due on each of the next `days` days, starting today. */
export function upcomingReviews(
  records: ReadonlyMap<string, CardProgress>,
  now: Timestamp,
  days = 7,
): { day: string; at: Timestamp; count: number }[] {
  const buckets = new Map<number, number>();
  for (const progress of records.values()) {
    // Everything already waiting belongs to today.
    const offset = Math.max(0, daysBetween(now, progress.dueAt));
    if (offset >= days) continue;
    buckets.set(offset, (buckets.get(offset) ?? 0) + 1);
  }

  return Array.from({ length: days }, (_, offset) => {
    const at = addDays(now, offset);
    return { day: dayKey(at), at, count: buckets.get(offset) ?? 0 };
  });
}

/** The soonest a card is next due, or null when nothing is scheduled. */
export function nextDueAt(
  records: ReadonlyMap<string, CardProgress>,
  now: Timestamp,
): Timestamp | null {
  let soonest: Timestamp | null = null;
  for (const progress of records.values()) {
    if (progress.dueAt <= now) continue;
    if (soonest === null || progress.dueAt < soonest) soonest = progress.dueAt;
  }
  return soonest;
}

/** Everything the statistics page shows, drawn from the records and the activity log. */
export interface StudyStats {
  totalReviews: number;
  correct: number;
  incorrect: number;
  /** Correct answers as a share of all answers, from 0 to 1. */
  accuracy: number;
  reviewsToday: number;
  currentStreak: number;
  longestStreak: number;
  cardsReviewed: number;
  cardsMastered: number;
  nextDueAt: Timestamp | null;
}

export function studyStats(
  records: ReadonlyMap<string, CardProgress>,
  history: readonly DailyActivity[],
  now: Timestamp,
): StudyStats {
  let totalReviews = 0;
  let correct = 0;
  let incorrect = 0;
  let cardsMastered = 0;

  for (const progress of records.values()) {
    totalReviews += progress.reviews;
    correct += progress.correct;
    incorrect += progress.incorrect;
    if (progress.stage === 'mastered') cardsMastered += 1;
  }

  const today = dayKey(now);
  return {
    totalReviews,
    correct,
    incorrect,
    accuracy: totalReviews === 0 ? 0 : correct / totalReviews,
    reviewsToday: history.find((entry) => entry.day === today)?.reviews ?? 0,
    currentStreak: currentStreak(history, now),
    longestStreak: longestStreak(history),
    cardsReviewed: records.size,
    cardsMastered,
    nextDueAt: nextDueAt(records, now),
  };
}

/** The last `days` days of activity, oldest first, including the days nothing was studied. */
export function recentActivity(
  history: readonly DailyActivity[],
  now: Timestamp,
  days = 14,
): DailyActivity[] {
  const byDay = new Map(history.map((entry) => [entry.day, entry]));
  return Array.from({ length: days }, (_, index) => {
    const day = dayKey(addDays(now, index - (days - 1)));
    return byDay.get(day) ?? { day, reviews: 0, correct: 0 };
  });
}
