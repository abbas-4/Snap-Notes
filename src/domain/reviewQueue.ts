import { hasBothSides } from './cardText';
import { cardState, isDifficult, type CardProgress, type CardState, type ReviewGrade } from './srs';
import type { Card, Timestamp } from './types';

/**
 * Choosing what to review, and in what order.
 *
 * The scheduler in `srs.ts` decides when a card comes back; this module turns
 * a collection plus its records into the queue for one session. It is pure:
 * the same cards, records and time always give the same queue.
 */

/** What a session is made of. */
export type ReviewMode =
  /** Everything waiting: cards from earlier days first, then today's. */
  | 'due'
  /** Cards that have never been reviewed. */
  | 'new'
  /** Cards that keep being forgotten, whether or not they are due. */
  | 'difficult'
  /** Every card in scope, due ones first. */
  | 'all';

export const REVIEW_MODES = ['due', 'new', 'difficult', 'all'] as const;

/** How many unseen cards one session introduces by default. */
export const NEW_CARDS_PER_SESSION = 20;

/** A card can only be reviewed when it has something to recall and something to check against. */
export const isReviewable = hasBothSides;

export interface ReviewEntry {
  card: Card;
  /** The card's record, or undefined when it has never been reviewed. */
  progress: CardProgress | undefined;
  state: CardState;
}

export interface QueueOptions {
  now: Timestamp;
  mode: ReviewMode;
  /** How many new cards a session may introduce. Defaults to {@link NEW_CARDS_PER_SESSION}. */
  newLimit?: number;
}

/**
 * How soon a card should be seen, lowest first:
 * overdue, then difficult cards that are due, then the rest of today's, then
 * new cards, and finally cards that are not due at all.
 */
export function reviewPriority(entry: ReviewEntry): number {
  switch (entry.state) {
    case 'overdue':
      return 0;
    case 'due':
      return isDifficult(entry.progress) ? 1 : 2;
    case 'new':
      return 3;
    case 'scheduled':
      return 4;
  }
}

/** Pairs each card with its record and works out where it stands. */
export function toEntries(
  cards: readonly Card[],
  records: ReadonlyMap<string, CardProgress>,
  now: Timestamp,
): ReviewEntry[] {
  return cards.map((card) => {
    const progress = records.get(card.id);
    return { card, progress, state: cardState(progress, now) };
  });
}

/**
 * Orders entries by priority. Within one band the card waiting longest comes
 * first; new cards are introduced oldest first, so a deck is worked through in
 * the order it was written.
 */
export function sortByPriority(entries: readonly ReviewEntry[]): ReviewEntry[] {
  return [...entries].sort((a, b) => {
    const byPriority = reviewPriority(a) - reviewPriority(b);
    if (byPriority !== 0) return byPriority;
    if (a.progress && b.progress && a.progress.dueAt !== b.progress.dueAt) {
      return a.progress.dueAt - b.progress.dueAt;
    }
    if (a.card.createdAt !== b.card.createdAt) return a.card.createdAt - b.card.createdAt;
    // Last resort, so the order never depends on how the cards happened to be stored.
    return a.card.id.localeCompare(b.card.id);
  });
}

function matchesMode(entry: ReviewEntry, mode: ReviewMode): boolean {
  switch (mode) {
    case 'due':
      return entry.state === 'due' || entry.state === 'overdue';
    case 'new':
      return entry.state === 'new';
    case 'difficult':
      return isDifficult(entry.progress);
    case 'all':
      return true;
  }
}

/**
 * The cards for one session, in the order they should be shown.
 *
 * Only cards with both a term and a definition take part. A session that
 * includes new cards introduces at most `newLimit` of them, so a large
 * collection does not bury the cards that are actually due.
 */
export function buildReviewQueue(
  cards: readonly Card[],
  records: ReadonlyMap<string, CardProgress>,
  { now, mode, newLimit = NEW_CARDS_PER_SESSION }: QueueOptions,
): Card[] {
  const entries = toEntries(cards.filter(isReviewable), records, now);
  const chosen = sortByPriority(entries.filter((entry) => matchesMode(entry, mode)));

  const limit = Math.max(0, Math.trunc(newLimit));
  let newCards = 0;
  return chosen
    .filter((entry) => entry.state !== 'new' || ++newCards <= limit)
    .map((entry) => entry.card);
}

/** How many cards each mode would start with, for the buttons on the dashboard. */
export function queueSizes(
  cards: readonly Card[],
  records: ReadonlyMap<string, CardProgress>,
  options: Omit<QueueOptions, 'mode'>,
): Record<ReviewMode, number> {
  const sizes = {} as Record<ReviewMode, number>;
  for (const mode of REVIEW_MODES) {
    sizes[mode] = buildReviewQueue(cards, records, { ...options, mode }).length;
  }
  return sizes;
}

/** Whether a string from the URL names a review mode. */
export function isReviewMode(value: unknown): value is ReviewMode {
  return typeof value === 'string' && (REVIEW_MODES as readonly string[]).includes(value);
}

/** What each grade button says, and what it means. */
export const GRADE_LABELS: Record<ReviewGrade, { label: string; hint: string }> = {
  again: { label: 'Again', hint: 'I did not remember' },
  hard: { label: 'Hard', hint: 'I remembered with difficulty' },
  good: { label: 'Good', hint: 'I remembered correctly' },
  easy: { label: 'Easy', hint: 'I remembered immediately' },
};
