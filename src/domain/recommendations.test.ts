import { describe, expect, it } from 'vitest';
import type { DeckPerformance, GoalProgress, StreakSummary, WeakCard } from './analytics';
import { emptyProgressCounts, type ProgressCounts } from './progressStats';
import {
  MAX_RECOMMENDATIONS,
  MIN_HISTORY_ANSWERS,
  recommend,
  type RecommendationInput,
} from './recommendations';
import { addDays } from './srs';

const NOW = new Date(2026, 10, 14, 15, 0, 0).getTime();

function counts(overrides: Partial<ProgressCounts> = {}): ProgressCounts {
  return { ...emptyProgressCounts(), total: 10, reviewable: 10, ...overrides };
}

const streaks = (overrides: Partial<StreakSummary> = {}): StreakSummary => ({
  current: 0,
  longest: 0,
  totalActiveDays: 5,
  studiedToday: true,
  lastActiveAt: addDays(NOW, 0),
  ...overrides,
});

function deckPerf(id: string, overrides: Partial<DeckPerformance> = {}): DeckPerformance {
  return {
    deck: { id, name: id === 'bio' ? 'Biology' : 'Spanish', createdAt: 1, updatedAt: 1 },
    cards: 5,
    counts: counts({ reviewable: 5 }),
    cardsStudied: 5,
    answered: 20,
    correct: 15,
    incorrect: 5,
    accuracy: 0.75,
    sessions: 2,
    activeDays: 2,
    lastStudiedAt: NOW,
    recentActivity: [],
    trend: { direction: 'steady', earlier: 0.75, later: 0.75, change: 0 },
    ...overrides,
  };
}

function input(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    now: NOW,
    counts: counts(),
    streaks: streaks(),
    decks: [],
    weakCards: [],
    goals: [],
    totalAnswered: 100,
    ...overrides,
  };
}

const weak = (term: string): WeakCard =>
  ({
    card: { id: term, deckId: 'bio', term, definition: 'x', createdAt: 1, updatedAt: 1 },
    attempts: 9,
    correct: 2,
    incorrect: 7,
    accuracy: 2 / 9,
    lastAnsweredAt: NOW,
    recent: [],
    reviewLapses: 0,
    reviewStreak: null,
    score: 1,
    reasons: [],
  }) satisfies WeakCard;

describe('recommendations', () => {
  it('asks the user to get started instead of guessing from too little history', () => {
    expect(recommend(input({ totalAnswered: MIN_HISTORY_ANSWERS - 1 }))).toEqual({
      kind: 'getting-started',
      hasCards: true,
      answered: MIN_HISTORY_ANSWERS - 1,
    });
    expect(recommend(input({ totalAnswered: 0, counts: counts({ reviewable: 0 }) }))).toMatchObject(
      {
        hasCards: false,
      },
    );
  });

  it('says there is nothing to do when nothing calls for it', () => {
    expect(recommend(input())).toEqual({ kind: 'recommendations', items: [] });
  });

  it('puts overdue reviews first, with the count behind it and a link into the session', () => {
    const result = recommend(input({ counts: counts({ overdue: 3, due: 5 }) }));
    expect(result.kind).toBe('recommendations');
    if (result.kind !== 'recommendations') return;
    expect(result.items[0]).toMatchObject({
      kind: 'overdue',
      title: 'Catch up on overdue reviews',
      href: '/review?mode=due',
    });
    expect(result.items[0]?.reason).toContain('3 cards have been due since an earlier day');
  });

  it('suggests weak cards, naming the worst and its record', () => {
    const result = recommend(input({ weakCards: [weak('mariposa')] }));
    if (result.kind !== 'recommendations') throw new Error('expected recommendations');
    const item = result.items.find((i) => i.kind === 'weak-cards');
    expect(item?.href).toBe('/learn?focus=weak');
    expect(item?.reason).toContain('“mariposa” was right 2 of 9 times');
  });

  it('suggests the deck whose accuracy fell furthest', () => {
    const decks = [
      deckPerf('bio', {
        trend: { direction: 'declining', earlier: 0.9, later: 0.8, change: -0.1 },
      }),
      deckPerf('spa', {
        trend: { direction: 'declining', earlier: 0.8, later: 0.5, change: -0.3 },
      }),
    ];
    const result = recommend(input({ decks }));
    if (result.kind !== 'recommendations') throw new Error('expected recommendations');
    const item = result.items.find((i) => i.kind === 'declining-deck');
    expect(item).toMatchObject({ title: 'Revisit Spanish', href: '/learn?deck=spa' });
    expect(item?.reason).toContain('from 80% to 50%');
  });

  it('suggests a deck left alone for a week, reviewing it when cards are due', () => {
    const decks = [
      deckPerf('bio', {
        lastStudiedAt: addDays(NOW, -9),
        counts: counts({ reviewable: 5, due: 2 }),
      }),
    ];
    const result = recommend(input({ decks }));
    if (result.kind !== 'recommendations') throw new Error('expected recommendations');
    expect(result.items.find((i) => i.kind === 'neglected-deck')).toMatchObject({
      title: 'Return to Biology',
      href: '/review?mode=due&deck=bio',
    });
  });

  it('encourages getting back after missed days, or keeping a streak alive', () => {
    const lapsed = recommend(
      input({
        streaks: streaks({ current: 0, studiedToday: false, lastActiveAt: addDays(NOW, -4) }),
      }),
    );
    if (lapsed.kind !== 'recommendations') throw new Error('expected recommendations');
    expect(lapsed.items[0]).toMatchObject({ kind: 'get-back' });
    expect(lapsed.items[0]?.reason).toContain('4 days ago');

    const alive = recommend(
      input({
        streaks: streaks({ current: 6, studiedToday: false, lastActiveAt: addDays(NOW, -1) }),
      }),
    );
    if (alive.kind !== 'recommendations') throw new Error('expected recommendations');
    expect(alive.items[0]).toMatchObject({
      kind: 'keep-streak',
      title: 'Keep your 6-day streak going',
    });
  });

  it('points at a goal not yet met', () => {
    const goal: GoalProgress = {
      kind: 'cards-per-day',
      target: 20,
      value: 12,
      fraction: 0.6,
      met: false,
      remaining: 8,
      history: [],
    };
    const result = recommend(
      input({ goals: [goal, { ...goal, kind: 'minutes-per-day', met: true }] }),
    );
    if (result.kind !== 'recommendations') throw new Error('expected recommendations');
    const goals = result.items.filter((i) => i.kind === 'goal');
    expect(goals).toHaveLength(1);
    expect(goals[0]?.reason).toContain('12 of 20 cards today');
    expect(goals[0]?.reason).toContain('8 cards to go');
  });

  it('suggests new cards only when nothing is due', () => {
    const idle = recommend(input({ counts: counts({ newCards: 4 }) }));
    if (idle.kind !== 'recommendations') throw new Error('expected recommendations');
    expect(idle.items.map((i) => i.kind)).toEqual(['new-cards']);
    const busy = recommend(input({ counts: counts({ newCards: 4, due: 1 }) }));
    if (busy.kind !== 'recommendations') throw new Error('expected recommendations');
    expect(busy.items.map((i) => i.kind)).toEqual(['due']);
  });

  it('gives at most a few, in a fixed order, the same every time', () => {
    const everything = input({
      counts: counts({ overdue: 2, due: 3, newCards: 1 }),
      streaks: streaks({ current: 0, studiedToday: false, lastActiveAt: addDays(NOW, -3) }),
      weakCards: [weak('a'), weak('b'), weak('c'), weak('d'), weak('e')],
      decks: [
        deckPerf('bio', {
          trend: { direction: 'declining', earlier: 0.9, later: 0.6, change: -0.3 },
        }),
      ],
    });
    const first = recommend(everything);
    if (first.kind !== 'recommendations') throw new Error('expected recommendations');
    expect(first.items).toHaveLength(MAX_RECOMMENDATIONS);
    expect(first.items.map((i) => i.kind)).toEqual([
      'overdue',
      'get-back',
      'weak-cards',
      'declining-deck',
    ]);
    expect(recommend(everything)).toEqual(first);
  });
});
