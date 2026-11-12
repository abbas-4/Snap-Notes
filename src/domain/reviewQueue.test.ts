import { describe, expect, it } from 'vitest';
import { makeCard } from '../test/renderApp';
import {
  buildReviewQueue,
  isReviewMode,
  isReviewable,
  queueSizes,
  reviewPriority,
  sortByPriority,
  toEntries,
  NEW_CARDS_PER_SESSION,
} from './reviewQueue';
import { START_EASE, type CardProgress } from './srs';
import type { Card } from './types';

const NOW = new Date(2025, 5, 10, 9, 0).getTime();
const DAY = 86_400_000;

function record(cardId: string, overrides: Partial<CardProgress> = {}): CardProgress {
  return {
    cardId,
    deckId: 'default',
    reviews: 1,
    correct: 1,
    incorrect: 0,
    stage: 'review',
    intervalDays: 3,
    ease: START_EASE,
    lastReviewedAt: NOW - DAY,
    dueAt: NOW + DAY,
    streak: 1,
    ...overrides,
  };
}

function records(...entries: CardProgress[]): Map<string, CardProgress> {
  return new Map(entries.map((entry) => [entry.cardId, entry]));
}

const overdue = makeCard({ id: 'overdue', createdAt: 1, updatedAt: 1 });
const dueToday = makeCard({ id: 'due', createdAt: 2, updatedAt: 2 });
const hardDue = makeCard({ id: 'hard', createdAt: 3, updatedAt: 3 });
const fresh = makeCard({ id: 'fresh', createdAt: 4, updatedAt: 4 });
const later = makeCard({ id: 'later', createdAt: 5, updatedAt: 5 });

const cards: Card[] = [later, fresh, hardDue, dueToday, overdue];
const saved = records(
  record('overdue', { dueAt: NOW - 3 * DAY }),
  record('due', { dueAt: NOW - 3_600_000 }),
  record('hard', { dueAt: NOW - 7_200_000, ease: 1.5, incorrect: 3, reviews: 5, correct: 2 }),
  record('later', { dueAt: NOW + 5 * DAY }),
);

describe('priority', () => {
  it('puts overdue first, then difficult, then due, then new, then scheduled', () => {
    const order = sortByPriority(toEntries(cards, saved, NOW)).map((entry) => entry.card.id);
    expect(order).toEqual(['overdue', 'hard', 'due', 'fresh', 'later']);
  });

  it('shows the card waiting longest first', () => {
    const twoOverdue = records(
      record('due', { dueAt: NOW - 2 * DAY }),
      record('overdue', { dueAt: NOW - 9 * DAY }),
    );
    const order = sortByPriority(toEntries([dueToday, overdue], twoOverdue, NOW));
    expect(order.map((entry) => entry.card.id)).toEqual(['overdue', 'due']);
  });

  it('introduces new cards oldest first', () => {
    const order = sortByPriority(toEntries([later, fresh], new Map(), NOW));
    expect(order.map((entry) => entry.card.id)).toEqual(['fresh', 'later']);
  });

  it('ranks each state', () => {
    const [entry] = toEntries([overdue], saved, NOW);
    expect(reviewPriority(entry!)).toBe(0);
    expect(reviewPriority({ card: fresh, progress: undefined, state: 'new' })).toBe(3);
    expect(reviewPriority({ card: later, progress: saved.get('later'), state: 'scheduled' })).toBe(
      4,
    );
  });
});

describe('building a queue', () => {
  it('takes only the cards that are due', () => {
    const queue = buildReviewQueue(cards, saved, { now: NOW, mode: 'due' });
    expect(queue.map((card) => card.id)).toEqual(['overdue', 'hard', 'due']);
  });

  it('takes only cards that have never been reviewed', () => {
    const queue = buildReviewQueue(cards, saved, { now: NOW, mode: 'new' });
    expect(queue.map((card) => card.id)).toEqual(['fresh']);
  });

  it('takes difficult cards whether or not they are due', () => {
    const notDue = records(
      record('later', { dueAt: NOW + 5 * DAY, ease: 1.4, incorrect: 4, reviews: 6, correct: 2 }),
    );
    const queue = buildReviewQueue(cards, notDue, { now: NOW, mode: 'difficult' });
    expect(queue.map((card) => card.id)).toEqual(['later']);
  });

  it('takes everything in order for an "all" session', () => {
    const queue = buildReviewQueue(cards, saved, { now: NOW, mode: 'all' });
    expect(queue.map((card) => card.id)).toEqual(['overdue', 'hard', 'due', 'fresh', 'later']);
  });

  it('limits how many new cards one session introduces', () => {
    const many = Array.from({ length: NEW_CARDS_PER_SESSION + 5 }, (_, index) =>
      makeCard({ id: `new-${index}`, createdAt: index + 1, updatedAt: index + 1 }),
    );
    const queue = buildReviewQueue(many, new Map(), { now: NOW, mode: 'new' });
    expect(queue).toHaveLength(NEW_CARDS_PER_SESSION);

    const smaller = buildReviewQueue(many, new Map(), { now: NOW, mode: 'new', newLimit: 3 });
    expect(smaller.map((card) => card.id)).toEqual(['new-0', 'new-1', 'new-2']);
  });

  it('leaves out cards that are missing a side', () => {
    const halfCards = [
      makeCard({ id: 'no-definition', definition: '  ' }),
      makeCard({ id: 'no-term', term: '' }),
      fresh,
    ];
    const queue = buildReviewQueue(halfCards, new Map(), { now: NOW, mode: 'all' });
    expect(queue.map((card) => card.id)).toEqual(['fresh']);
    expect(isReviewable(halfCards[0]!)).toBe(false);
  });

  it('is empty when nothing matches', () => {
    expect(buildReviewQueue([], saved, { now: NOW, mode: 'due' })).toEqual([]);
    expect(buildReviewQueue(cards, saved, { now: NOW, mode: 'due', newLimit: 0 })).toHaveLength(3);
  });

  it('counts what each session would hold', () => {
    expect(queueSizes(cards, saved, { now: NOW })).toEqual({
      due: 3,
      new: 1,
      difficult: 1,
      all: 5,
    });
  });

  it('recognises the modes a URL may name', () => {
    expect(isReviewMode('due')).toBe(true);
    expect(isReviewMode('everything')).toBe(false);
    expect(isReviewMode(null)).toBe(false);
  });
});
