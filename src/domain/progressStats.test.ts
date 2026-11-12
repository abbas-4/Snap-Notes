import { describe, expect, it } from 'vitest';
import { makeAppData, makeCard, makeDeck } from '../test/renderApp';
import {
  countProgress,
  countProgressByDeck,
  currentStreak,
  emptyProgressCounts,
  longestStreak,
  nextDueAt,
  recentActivity,
  studyStats,
  timestampFromDayKey,
  upcomingReviews,
  type DailyActivity,
} from './progressStats';
import { dayKey, addDays, START_EASE, type CardProgress } from './srs';

const NOW = new Date(2025, 8, 15, 11, 0).getTime();
const DAY = 86_400_000;

function record(cardId: string, overrides: Partial<CardProgress> = {}): CardProgress {
  return {
    cardId,
    deckId: 'default',
    reviews: 2,
    correct: 2,
    incorrect: 0,
    stage: 'review',
    intervalDays: 3,
    ease: START_EASE,
    lastReviewedAt: NOW - DAY,
    dueAt: NOW + DAY,
    streak: 2,
    ...overrides,
  };
}

function records(...entries: CardProgress[]): Map<string, CardProgress> {
  return new Map(entries.map((entry) => [entry.cardId, entry]));
}

/** `offsets` are days back from today; each day gets one review. */
function history(offsets: number[]): DailyActivity[] {
  return offsets.map((offset) => ({
    day: dayKey(addDays(NOW, -offset)),
    reviews: 1,
    correct: 1,
  }));
}

describe('countProgress', () => {
  const cards = [
    makeCard({ id: 'new-1' }),
    makeCard({ id: 'learning-1' }),
    makeCard({ id: 'due-1' }),
    makeCard({ id: 'mastered-1' }),
    makeCard({ id: 'half', definition: '' }),
  ];
  const saved = records(
    record('learning-1', { stage: 'learning', intervalDays: 0, dueAt: NOW + 600_000 }),
    record('due-1', { dueAt: NOW - 2 * DAY }),
    record('mastered-1', { stage: 'mastered', intervalDays: 30, dueAt: NOW + 20 * DAY }),
  );

  it('counts every stage, and what is waiting', () => {
    expect(countProgress(cards, saved, NOW)).toMatchObject({
      total: 5,
      reviewable: 4,
      newCards: 1,
      learning: 1,
      review: 1,
      mastered: 1,
      due: 1,
      overdue: 1,
      reviewed: 3,
    });
  });

  it('measures how far the cards have come', () => {
    const counts = countProgress(cards, saved, NOW);
    // 0 for the new card, 0 while relearning, 3/21 due, and a full 1 for mastered.
    expect(counts.mastery).toBeCloseTo((0 + 0 + 3 / 21 + 1) / 4);
  });

  it('leaves cards that cannot be reviewed out of the breakdown', () => {
    const counts = countProgress([makeCard({ term: '' })], new Map(), NOW);
    expect(counts).toMatchObject({ total: 1, reviewable: 0, newCards: 0, mastery: 0 });
  });

  it('counts nothing for an empty collection', () => {
    expect(countProgress([], new Map(), NOW)).toEqual(emptyProgressCounts());
  });

  it('counts each deck on its own, including empty decks', () => {
    const biology = makeDeck({ id: 'biology', name: 'Biology' });
    const data = makeAppData(
      [makeCard({ id: 'a', deckId: 'default' }), makeCard({ id: 'b', deckId: 'biology' })],
      [makeDeck({ id: 'default', name: 'My Cards' }), biology, makeDeck({ id: 'empty' })],
    );
    const byDeck = countProgressByDeck(data, records(record('b', { dueAt: NOW - DAY })), NOW);
    expect(byDeck.get('default')).toMatchObject({ total: 1, newCards: 1, due: 0 });
    expect(byDeck.get('biology')).toMatchObject({ total: 1, newCards: 0, due: 1 });
    expect(byDeck.get('empty')).toEqual(emptyProgressCounts());
  });
});

describe('streaks', () => {
  it('counts days studied in a row up to today', () => {
    expect(currentStreak(history([0, 1, 2]), NOW)).toBe(3);
  });

  it('keeps yesterday’s streak alive until the day is over', () => {
    expect(currentStreak(history([1, 2]), NOW)).toBe(2);
  });

  it('is broken by a missed day', () => {
    expect(currentStreak(history([0, 1, 3, 4]), NOW)).toBe(2);
    expect(currentStreak(history([2, 3]), NOW)).toBe(0);
  });

  it('is zero without any reviewing', () => {
    expect(currentStreak([], NOW)).toBe(0);
    expect(currentStreak([{ day: dayKey(NOW), reviews: 0, correct: 0 }], NOW)).toBe(0);
  });

  it('remembers the longest run ever', () => {
    expect(longestStreak(history([0, 1, 5, 6, 7, 8]))).toBe(4);
    expect(longestStreak([])).toBe(0);
  });

  it('ignores entries that are not days', () => {
    const broken = [{ day: 'not-a-day', reviews: 3, correct: 1 }, ...history([0])];
    expect(currentStreak(broken, NOW)).toBe(1);
    expect(timestampFromDayKey('2025-02-31')).toBeNull();
    expect(timestampFromDayKey('2025-09-15')).toBe(new Date(2025, 8, 15).getTime());
  });
});

describe('what is coming', () => {
  it('groups the next week by day, counting what is already waiting as today', () => {
    const saved = records(
      record('a', { dueAt: NOW - 5 * DAY }),
      record('b', { dueAt: NOW + 2 * 3_600_000 }),
      record('c', { dueAt: addDays(NOW, 2) }),
      record('d', { dueAt: addDays(NOW, 30) }),
    );
    const upcoming = upcomingReviews(saved, NOW);
    expect(upcoming).toHaveLength(7);
    expect(upcoming[0]).toMatchObject({ day: dayKey(NOW), count: 2 });
    expect(upcoming[2]?.count).toBe(1);
    expect(upcoming.reduce((total, day) => total + day.count, 0)).toBe(3);
  });

  it('finds the soonest card still to come', () => {
    const saved = records(
      record('a', { dueAt: NOW - DAY }),
      record('b', { dueAt: NOW + 4 * DAY }),
      record('c', { dueAt: NOW + 2 * DAY }),
    );
    expect(nextDueAt(saved, NOW)).toBe(NOW + 2 * DAY);
    expect(nextDueAt(records(record('a', { dueAt: NOW - DAY })), NOW)).toBeNull();
  });
});

describe('studyStats', () => {
  it('adds up the records and the activity log', () => {
    const saved = records(
      record('a', { reviews: 4, correct: 3, incorrect: 1 }),
      record('b', { reviews: 2, correct: 1, incorrect: 1, stage: 'mastered', intervalDays: 40 }),
    );
    const log: DailyActivity[] = [
      { day: dayKey(addDays(NOW, -1)), reviews: 3, correct: 2 },
      { day: dayKey(NOW), reviews: 3, correct: 2 },
    ];

    expect(studyStats(saved, log, NOW)).toMatchObject({
      totalReviews: 6,
      correct: 4,
      incorrect: 2,
      reviewsToday: 3,
      currentStreak: 2,
      longestStreak: 2,
      cardsReviewed: 2,
      cardsMastered: 1,
    });
    expect(studyStats(saved, log, NOW).accuracy).toBeCloseTo(4 / 6);
  });

  it('reports zeroes, not guesses, before anything is reviewed', () => {
    expect(studyStats(new Map(), [], NOW)).toMatchObject({
      totalReviews: 0,
      accuracy: 0,
      reviewsToday: 0,
      currentStreak: 0,
      cardsMastered: 0,
      nextDueAt: null,
    });
  });
});

describe('recentActivity', () => {
  it('fills in the days nothing was studied, oldest first', () => {
    const days = recentActivity([{ day: dayKey(NOW), reviews: 5, correct: 4 }], NOW, 3);
    expect(days.map((day) => day.reviews)).toEqual([0, 0, 5]);
    expect(days[2]?.day).toBe(dayKey(NOW));
    expect(days[0]?.day).toBe(dayKey(addDays(NOW, -2)));
  });
});
