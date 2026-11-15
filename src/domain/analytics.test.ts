import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activityHeatmap,
  activitySeries,
  buildAnalyticsBase,
  cardPerformance,
  compareAccuracy,
  deckPerformance,
  findWeakCards,
  goalProgress,
  granularityFor,
  modeBreakdown,
  overview,
  paginate,
  performanceBand,
  periodRange,
  previousRange,
  retentionEstimate,
  sortDecks,
  startOfWeek,
  streakSummary,
  strongestAndWeakest,
  studyHistory,
  totalsFor,
  untrackedDays,
  weeklySummaries,
  NO_HISTORY_FILTER,
  type AnalyticsInput,
} from './analytics';
import type { DailyActivity } from './progressStats';
import { addDays, dayKey, START_EASE, startOfDay, type CardProgress } from './srs';
import type { StudyMode, StudySession } from './studySessions';
import type { StudyGoal } from './studyGoals';
import type { Card, Deck } from './types';

// Saturday 14 November 2026, mid-afternoon, local time.
const NOW = new Date(2026, 10, 14, 15, 0, 0).getTime();
const DAY = 86_400_000;

function at(daysAgo: number, hour = 10): number {
  const date = new Date(addDays(NOW, -daysAgo));
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

const deck = (id: string, name = id): Deck => ({ id, name, createdAt: 1, updatedAt: 1 });
const card = (id: string, deckId: string, term = `Term ${id}`): Card => ({
  id,
  deckId,
  term,
  definition: `Definition ${id}`,
  createdAt: 1,
  updatedAt: 1,
});

let sessionCount = 0;
function session(
  daysAgo: number,
  results: [cardId: string, correct: number, incorrect: number][],
  overrides: Partial<StudySession> & { mode?: StudyMode } = {},
): StudySession {
  sessionCount += 1;
  const start = at(daysAgo, overrides.startedAt ? new Date(overrides.startedAt).getHours() : 10);
  const answered = results.reduce((sum, [, c, i]) => sum + c + i, 0);
  const correct = results.reduce((sum, [, c]) => sum + c, 0);
  return {
    id: `s${sessionCount}`,
    mode: 'quiz',
    deckId: null,
    day: dayKey(start),
    startedAt: start,
    endedAt: start + 60_000,
    durationMs: 60_000,
    answered,
    correct,
    responseMs: answered * 3_000,
    timedAnswers: answered,
    results: results.map(([cardId, c, i]) => ({ cardId, correct: c, incorrect: i })),
    ...overrides,
  };
}

function progress(
  cardId: string,
  deckId: string,
  overrides: Partial<CardProgress> = {},
): CardProgress {
  return {
    cardId,
    deckId,
    reviews: 0,
    correct: 0,
    incorrect: 0,
    stage: 'review',
    intervalDays: 3,
    ease: START_EASE,
    lastReviewedAt: at(1),
    dueAt: NOW + DAY,
    streak: 0,
    ...overrides,
  };
}

function input(overrides: Partial<AnalyticsInput> = {}): AnalyticsInput {
  return {
    data: { schemaVersion: 2, decks: [deck('bio', 'Biology'), deck('spa', 'Spanish')], cards: [] },
    records: new Map(),
    history: [],
    sessions: [],
    goals: [],
    ...overrides,
  };
}

const base = (overrides: Partial<AnalyticsInput> = {}) => buildAnalyticsBase(input(overrides));

describe('with no study history', () => {
  it('reports zeroes and nulls, never invented figures', () => {
    const b = base();
    const summary = overview(b, '30d', NOW);
    expect(summary.totals).toEqual({
      sessions: 0,
      answered: 0,
      correct: 0,
      incorrect: 0,
      accuracy: null,
      studyMs: 0,
      averageResponseMs: null,
      timedAnswers: 0,
      activeDays: 0,
      untrackedAnswers: 0,
    });
    expect(summary.streaks).toMatchObject({ current: 0, longest: 0, totalActiveDays: 0 });
    expect(summary.accuracyTrend.direction).toBe('insufficient');
    expect(b.earliest).toBeNull();
    expect(periodRange('all', NOW, null)).toEqual({
      start: startOfDay(NOW),
      end: startOfDay(NOW),
      days: 1,
    });
    expect(activitySeries(b, summary.range)).toHaveLength(30);
    expect(
      activitySeries(b, summary.range).every((p) => p.answered === 0 && p.accuracy === null),
    ).toBe(true);
    expect(findWeakCards(cardPerformance(b))).toEqual([]);
    expect(studyHistory(b, NO_HISTORY_FILTER)).toEqual([]);
  });
});

describe('counting answers once', () => {
  it('adds sessions in every mode, and takes Review answers from their sessions rather than the review log', () => {
    const review = session(0, [['c1', 3, 1]], { mode: 'review' });
    const quiz = session(0, [['c2', 2, 2]], { mode: 'quiz' });
    // The review log holds the same four Review answers: they must not count twice.
    const history: DailyActivity[] = [{ day: dayKey(NOW), reviews: 4, correct: 3 }];
    const b = base({ sessions: [review, quiz], history });
    const totals = totalsFor(b, periodRange('7d', NOW, b.earliest));
    expect(totals).toMatchObject({
      sessions: 2,
      answered: 8,
      correct: 5,
      incorrect: 3,
      untrackedAnswers: 0,
    });
    expect(totals.accuracy).toBeCloseTo(5 / 8);
    expect(totals.averageResponseMs).toBe(3_000);
    expect(totals.studyMs).toBe(120_000);
  });

  it('counts Review answers from before sessions were recorded, from the review log', () => {
    const history: DailyActivity[] = [
      { day: dayKey(at(40)), reviews: 10, correct: 7 },
      // Partly covered by a session: only the rest is added.
      { day: dayKey(at(2)), reviews: 6, correct: 5 },
    ];
    const b = base({ history, sessions: [session(2, [['c1', 3, 1]], { mode: 'review' })] });
    const all = totalsFor(b, periodRange('all', NOW, b.earliest));
    expect(all).toMatchObject({ answered: 16, correct: 12, untrackedAnswers: 12, sessions: 1 });
    expect(untrackedDays(b)).toBe(2);
    // Time is known only for the session.
    expect(all.studyMs).toBe(60_000);
  });

  it('never lets the review log lower a day below its sessions', () => {
    // After linking two devices, the log can hold fewer reviews than the sessions.
    const b = base({
      history: [{ day: dayKey(NOW), reviews: 2, correct: 2 }],
      sessions: [session(0, [['c1', 1, 3]], { mode: 'review' })],
    });
    expect(totalsFor(b, periodRange('7d', NOW, b.earliest))).toMatchObject({
      answered: 4,
      correct: 1,
    });
  });

  it('ignores a repeated session and anything on an impossible day', () => {
    const one = session(0, [['c1', 1, 0]]);
    const b = base({
      sessions: [one, { ...one }, session(0, [['c2', 5, 0]], { day: '2026-02-31' })],
      history: [{ day: '2026-13-01', reviews: 9, correct: 9 }],
    });
    expect(totalsFor(b, periodRange('all', NOW, b.earliest))).toMatchObject({
      sessions: 1,
      answered: 1,
    });
  });

  it('guards against damaged counts', () => {
    const odd = session(0, [['c1', 1, 0]], { correct: 5, timedAnswers: 9, durationMs: -10 });
    const b = base({ sessions: [odd] });
    expect(totalsFor(b, periodRange('7d', NOW, b.earliest))).toMatchObject({
      answered: 1,
      correct: 1,
      studyMs: 0,
      timedAnswers: 1,
    });
  });
});

describe('periods', () => {
  it('ends today and covers whole local days', () => {
    const range = periodRange('7d', NOW, null);
    expect(range.days).toBe(7);
    expect(range.end).toBe(startOfDay(NOW));
    expect(range.start).toBe(addDays(NOW, -6));
    expect(previousRange(range)).toEqual({
      start: addDays(NOW, -13),
      end: addDays(NOW, -7),
      days: 7,
    });
  });

  it('runs "all time" from the first recorded day', () => {
    const b = base({ sessions: [session(100, [['c1', 1, 0]])] });
    const range = periodRange('all', NOW, b.earliest);
    expect(range.days).toBe(101);
    expect(granularityFor(range)).toBe('week');
    expect(granularityFor({ ...range, days: 30 })).toBe('day');
    expect(granularityFor({ ...range, days: 800 })).toBe('month');
  });

  it('filters the overview by period and compares with the period before', () => {
    const sessions = [
      session(2, [['c1', 9, 1]]), // this week: 90%
      session(10, [['c1', 6, 4]]), // the week before: 60%
      session(50, [['c1', 1, 0]]),
    ];
    const b = base({ sessions });
    const week = overview(b, '7d', NOW);
    expect(week.totals.answered).toBe(10);
    expect(week.previous?.answered).toBe(10);
    expect(week.accuracyTrend).toMatchObject({ direction: 'improving' });
    expect(week.accuracyTrend.change).toBeCloseTo(0.3);
    expect(overview(b, '30d', NOW).totals.answered).toBe(20);
    expect(overview(b, '90d', NOW).totals.answered).toBe(21);
    const all = overview(b, 'all', NOW);
    expect(all.totals.answered).toBe(21);
    expect(all.previous).toBeNull();
  });
});

describe('accuracy trends', () => {
  it('needs enough answers on both sides', () => {
    expect(
      compareAccuracy({ answered: 9, correct: 9 }, { answered: 20, correct: 2 }).direction,
    ).toBe('insufficient');
  });

  it('calls a small change steady, and a change at the threshold a change', () => {
    expect(
      compareAccuracy({ answered: 100, correct: 80 }, { answered: 100, correct: 84 }).direction,
    ).toBe('steady');
    expect(
      compareAccuracy({ answered: 100, correct: 80 }, { answered: 100, correct: 85 }).direction,
    ).toBe('improving');
    expect(
      compareAccuracy({ answered: 100, correct: 80 }, { answered: 100, correct: 75 }).direction,
    ).toBe('declining');
  });
});

describe('streaks and activity', () => {
  it('counts consecutive days in any mode, and today does not break a streak yet', () => {
    const b = base({
      sessions: [session(1, [['c1', 1, 0]]), session(2, [['c1', 0, 1]], { mode: 'match' })],
      history: [{ day: dayKey(at(3)), reviews: 2, correct: 1 }],
    });
    expect(streakSummary(b, NOW)).toMatchObject({
      current: 3,
      longest: 3,
      totalActiveDays: 3,
      studiedToday: false,
    });
  });

  it('resets when a day is missed, keeping the longest', () => {
    const b = base({
      sessions: [0, 1, 5, 6, 7, 8].map((d) => session(d, [['c1', 1, 0]])),
    });
    expect(streakSummary(b, NOW)).toMatchObject({ current: 2, longest: 4, studiedToday: true });
    // Two days later, nothing in between: the streak is gone.
    expect(streakSummary(b, addDays(NOW, 2)).current).toBe(0);
  });

  it('counts a session late at night on the day it happened', () => {
    const late = session(1, [['c1', 1, 0]], {
      startedAt: at(1, 23),
      endedAt: at(1, 23) + 59 * 60_000,
      day: dayKey(at(1, 23)),
    });
    const b = base({ sessions: [late, session(0, [['c1', 1, 0]])] });
    expect(streakSummary(b, NOW).current).toBe(2);
  });

  it('lays the last year out in Monday-to-Sunday weeks, ending this week', () => {
    const b = base({ sessions: [session(0, [['c1', 8, 0]]), session(1, [['c1', 2, 0]])] });
    const weeks = activityHeatmap(b, NOW);
    expect(weeks).toHaveLength(53);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(new Date(weeks[0]![0]!.at).getDay()).toBe(1);
    const cells = weeks.flat();
    const today = cells.find((cell) => cell.day === dayKey(NOW));
    expect(today).toMatchObject({ answered: 8, level: 4, future: false });
    expect(cells.find((cell) => cell.day === dayKey(at(1)))).toMatchObject({ level: 1 });
    // NOW is a Saturday: Sunday is still to come.
    expect(cells[cells.length - 1]).toMatchObject({ future: true, answered: 0 });
  });

  it('sums each week', () => {
    const b = base({ sessions: [session(0, [['c1', 3, 1]]), session(9, [['c1', 1, 0]])] });
    const weeks = weeklySummaries(b, NOW, 3);
    expect(weeks[0]?.start).toBe(startOfWeek(NOW));
    expect(weeks.map((w) => w.totals.answered)).toEqual([4, 1, 0]);
    expect(weeks[0]?.totals.activeDays).toBe(1);
  });
});

describe('chart series', () => {
  it('has a point for every day, the empty ones included', () => {
    const b = base({ sessions: [session(0, [['c1', 2, 1]]), session(3, [['c1', 1, 0]])] });
    const points = activitySeries(b, periodRange('7d', NOW, b.earliest));
    expect(points.map((p) => p.answered)).toEqual([0, 0, 0, 1, 0, 0, 3]);
    expect(points[6]).toMatchObject({ correct: 2, incorrect: 1, sessions: 1, studyMs: 60_000 });
    expect(points[6]?.accuracy).toBeCloseTo(2 / 3);
    expect(points[0]?.accuracy).toBeNull();
  });

  it('groups by week and by month without losing or repeating an answer', () => {
    const sessions = [0, 3, 8, 40, 75, 300].map((d) => session(d, [['c1', 1, 1]]));
    const b = base({ sessions });
    const range = periodRange('all', NOW, b.earliest);
    for (const granularity of ['day', 'week', 'month'] as const) {
      const points = activitySeries(b, range, granularity);
      expect(points.reduce((sum, p) => sum + p.answered, 0)).toBe(12);
    }
    const months = activitySeries(b, range, 'month');
    expect(new Date(months[0]!.start).getDate()).toBe(1);
  });

  it('breaks answers down by mode', () => {
    const b = base({
      sessions: [
        session(0, [['c1', 2, 0]], { mode: 'learn' }),
        session(0, [['c1', 0, 2]], { mode: 'match' }),
      ],
      history: [{ day: dayKey(at(1)), reviews: 4, correct: 3 }],
    });
    const modes = modeBreakdown(b, periodRange('7d', NOW, b.earliest));
    expect(modes.find((m) => m.mode === 'review')).toMatchObject({
      answered: 4,
      correct: 3,
      sessions: 0,
    });
    expect(modes.find((m) => m.mode === 'learn')).toMatchObject({
      answered: 2,
      accuracy: 1,
      sessions: 1,
    });
    expect(modes.find((m) => m.mode === 'match')).toMatchObject({ answered: 2, accuracy: 0 });
    expect(modes.find((m) => m.mode === 'quiz')?.accuracy).toBeNull();
  });
});

describe('time zones and clock changes', () => {
  // Node reads TZ afresh when it changes, so each test runs in that zone.
  beforeEach(() => {
    vi.stubEnv('TZ', 'America/New_York');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps a streak across the autumn clock change, a 25-hour day', () => {
    // US clocks went back on Sunday 1 November 2026.
    expect(new Date(2026, 9, 31, 12).getTimezoneOffset()).toBe(240);
    expect(new Date(2026, 10, 2, 12).getTimezoneOffset()).toBe(300);
    const days = ['2026-10-31', '2026-11-01', '2026-11-02'];
    const sessions = days.map((day, i) => ({
      ...session(0, [['c1', 1, 0]]),
      id: `dst-${i}`,
      day,
      startedAt: new Date(`${day}T12:00:00`).getTime(),
      endedAt: new Date(`${day}T12:01:00`).getTime(),
    }));
    const b = base({ sessions });
    const now = new Date('2026-11-02T20:00:00').getTime();
    expect(streakSummary(b, now)).toMatchObject({ current: 3, longest: 3 });
    const points = activitySeries(b, periodRange('7d', now, b.earliest));
    expect(points.map((p) => p.key)).toEqual([
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(points.slice(-3).map((p) => p.answered)).toEqual([1, 1, 1]);
  });

  it('keeps a streak across the spring clock change, a 23-hour day', () => {
    const days = ['2026-03-07', '2026-03-08', '2026-03-09'];
    const b = base({ history: days.map((day) => ({ day, reviews: 1, correct: 1 })) });
    const now = new Date('2026-03-09T09:00:00').getTime();
    expect(addDays(new Date(2026, 2, 8).getTime(), 1) - new Date(2026, 2, 8).getTime()).toBe(
      23 * 3_600_000,
    );
    expect(streakSummary(b, now).current).toBe(3);
    expect(periodRange('7d', now, null).days).toBe(7);
  });

  it('keeps a session on the day it was recorded, wherever the device is now', () => {
    // Recorded at 23:30 in New York; read in a time zone where that instant is the next day.
    const late = {
      ...session(0, [['c1', 1, 0]]),
      day: '2026-11-10',
      startedAt: new Date('2026-11-10T23:30:00').getTime(),
      endedAt: new Date('2026-11-10T23:31:00').getTime(),
    };
    vi.stubEnv('TZ', 'Asia/Tokyo');
    expect(dayKey(late.startedAt)).toBe('2026-11-11');
    const b = base({ sessions: [late] });
    expect([...b.days.keys()]).toEqual(['2026-11-10']);
  });
});

describe('deck performance', () => {
  const cards = [card('b1', 'bio'), card('b2', 'bio'), card('s1', 'spa'), card('s2', 'spa')];
  const data = {
    schemaVersion: 2 as const,
    decks: [deck('bio', 'Biology'), deck('spa', 'Spanish'), deck('empty', 'Empty')],
    cards,
  };

  it('counts each deck’s answers in the period, empty decks included', () => {
    const b = base({
      data,
      sessions: [
        session(1, [
          ['b1', 4, 0],
          ['s1', 1, 3],
        ]),
        session(60, [['b2', 5, 5]]),
      ],
    });
    const decks = deckPerformance(b, '30d', NOW);
    expect(decks.map((d) => d.deck.id)).toEqual(['bio', 'spa', 'empty']);
    const [bio, spa, empty] = decks;
    expect(bio).toMatchObject({
      cards: 2,
      answered: 4,
      correct: 4,
      incorrect: 0,
      sessions: 1,
      activeDays: 1,
      cardsStudied: 2,
    });
    expect(spa).toMatchObject({ answered: 4, correct: 1, accuracy: 0.25 });
    expect(empty).toMatchObject({ cards: 0, answered: 0, accuracy: null, lastStudiedAt: null });
    expect(bio?.recentActivity).toHaveLength(14);
    expect(bio?.recentActivity[12]).toBe(4);
    expect(bio?.lastStudiedAt).toBe(at(1) + 60_000);
  });

  it('follows a card that moved deck, and gives a deleted card’s answers to the session’s deck', () => {
    const b = base({
      data,
      sessions: [
        // b1 now lives in Spanish; "gone" was deleted.
        session(
          0,
          [
            ['b1', 2, 0],
            ['gone', 0, 3],
          ],
          { deckId: 'bio' },
        ),
      ],
    });
    const moved = { ...data, cards: [card('b1', 'spa'), card('s1', 'spa')] };
    const after = buildAnalyticsBase({ ...b.input, data: moved });
    const decks = deckPerformance(after, '7d', NOW);
    expect(decks.find((d) => d.deck.id === 'spa')).toMatchObject({ answered: 2 });
    expect(decks.find((d) => d.deck.id === 'bio')).toMatchObject({ answered: 3, correct: 0 });
  });

  it('counts a session that kept only its totals towards the deck it was started on', () => {
    const compacted = { ...session(0, [['b1', 3, 1]], { deckId: 'bio' }), results: [] };
    const everything = { ...session(0, [['b1', 3, 1]]), results: [] };
    const b = base({ data, sessions: [compacted, everything] });
    const decks = deckPerformance(b, '7d', NOW);
    expect(decks.find((d) => d.deck.id === 'bio')).toMatchObject({ answered: 4, correct: 3 });
    expect(decks.find((d) => d.deck.id === 'spa')?.answered).toBe(0);
  });

  it('for all time, counts lifetime Review answers once and practice answers from sessions', () => {
    const records = new Map([
      [
        'b1',
        progress('b1', 'bio', { reviews: 10, correct: 7, incorrect: 3, lastReviewedAt: at(40) }),
      ],
    ]);
    const b = base({
      data,
      records,
      sessions: [
        // Already in the record's lifetime count: must not be added again.
        session(1, [['b1', 2, 0]], { mode: 'review' }),
        session(1, [['b1', 1, 1]], { mode: 'quiz' }),
      ],
    });
    const bio = deckPerformance(b, 'all', NOW).find((d) => d.deck.id === 'bio');
    expect(bio).toMatchObject({ answered: 12, correct: 8 });
    const bioMonth = deckPerformance(b, '30d', NOW).find((d) => d.deck.id === 'bio');
    expect(bioMonth).toMatchObject({ answered: 4, correct: 3 });
    expect(bio?.lastStudiedAt).toBe(at(1) + 60_000);
  });

  it('finds a declining deck over the last two weeks, and the strongest and weakest', () => {
    const b = base({
      data,
      sessions: [
        session(20, [['s1', 10, 0]]),
        session(3, [['s1', 4, 6]]),
        session(3, [['b1', 18, 2]]),
      ],
    });
    const decks = deckPerformance(b, '30d', NOW);
    const spa = decks.find((d) => d.deck.id === 'spa');
    expect(spa?.trend.direction).toBe('declining');
    expect(spa?.trend.change).toBeCloseTo(-0.6);
    expect(decks.find((d) => d.deck.id === 'bio')?.trend.direction).toBe('insufficient');
    const { strongest, weakest } = strongestAndWeakest(decks);
    expect(strongest?.deck.id).toBe('bio');
    expect(weakest?.deck.id).toBe('spa');
  });

  it('names no strongest or weakest deck without two decks to compare', () => {
    const b = base({ data, sessions: [session(1, [['b1', 18, 2]])] });
    expect(strongestAndWeakest(deckPerformance(b, '30d', NOW))).toEqual({
      strongest: null,
      weakest: null,
    });
  });

  it('sorts by accuracy or by answers, unstudied decks last', () => {
    const b = base({
      data,
      sessions: [
        session(1, [
          ['b1', 1, 1],
          ['s1', 9, 1],
          ['s2', 5, 0],
        ]),
      ],
    });
    const decks = deckPerformance(b, '30d', NOW);
    expect(sortDecks(decks, 'accuracy').map((d) => d.deck.id)).toEqual(['spa', 'bio', 'empty']);
    expect(sortDecks(decks, 'accuracy', 'asc').map((d) => d.deck.id)).toEqual([
      'bio',
      'spa',
      'empty',
    ]);
    expect(sortDecks(decks, 'reviewed').map((d) => d.deck.id)).toEqual(['spa', 'bio', 'empty']);
    expect(sortDecks(decks, 'reviewed', 'asc').map((d) => d.deck.id)).toEqual([
      'empty',
      'bio',
      'spa',
    ]);
    expect(sortDecks(decks, 'name', 'asc').map((d) => d.deck.name)).toEqual([
      'Biology',
      'Empty',
      'Spanish',
    ]);
    expect(sortDecks(decks, 'recent').at(-1)?.deck.id).toBe('empty');
  });
});

describe('weak cards', () => {
  const cards = [
    card('a', 'bio'),
    card('b', 'bio'),
    card('c', 'spa'),
    card('d', 'spa'),
    card('e', 'spa'),
  ];
  const data = { schemaVersion: 2 as const, decks: [deck('bio'), deck('spa')], cards };

  it('never lists a card for a single miss', () => {
    const b = base({ data, sessions: [session(0, [['a', 0, 1]])] });
    expect(findWeakCards(cardPerformance(b))).toEqual([]);
    const two = base({ data, sessions: [session(1, [['a', 1, 0]]), session(0, [['a', 0, 1]])] });
    expect(findWeakCards(cardPerformance(two))).toEqual([]);
  });

  it('lists a card answered wrongly most of the time, saying why', () => {
    const records = new Map([
      ['a', progress('a', 'bio', { reviews: 5, correct: 1, incorrect: 4 })],
    ]);
    const b = base({ data, records });
    const [weak] = findWeakCards(cardPerformance(b));
    expect(weak?.card.id).toBe('a');
    expect(weak?.attempts).toBe(5);
    expect(weak?.accuracy).toBeCloseTo(0.2);
    expect(weak?.reasons).toEqual([
      { kind: 'low-accuracy', correct: 1, attempts: 5 },
      { kind: 'review-lapses', lapses: 4 },
    ]);
  });

  it('lists a card missed in recent sessions even with a decent overall record', () => {
    const records = new Map([
      ['c', progress('c', 'spa', { reviews: 20, correct: 16, incorrect: 4 })],
    ]);
    const b = base({
      data,
      records,
      sessions: [
        session(3, [['c', 1, 0]], { mode: 'review' }),
        session(2, [['c', 0, 1]], { mode: 'review' }),
        session(1, [['c', 1, 1]], { mode: 'learn' }),
      ],
    });
    const [weak] = findWeakCards(cardPerformance(b));
    expect(weak?.recent).toEqual(['correct', 'missed', 'mixed']);
    // Review sessions are already in the record; only the Learn answers are added.
    expect(weak?.attempts).toBe(22);
    expect(weak?.reasons[0]).toEqual({ kind: 'recent-misses', missed: 2, sessions: 3 });
  });

  it('leaves off a card answered right in each of its last three sessions', () => {
    const records = new Map([
      ['d', progress('d', 'spa', { reviews: 10, correct: 2, incorrect: 8 })],
    ]);
    const sessions = [3, 2, 1].map((d) => session(d, [['d', 1, 0]], { mode: 'review' }));
    expect(findWeakCards(cardPerformance(base({ data, records, sessions })))).toEqual([]);
  });

  it('leaves out deleted cards, can be narrowed to a deck, and puts the weakest first', () => {
    const sessions = [
      session(2, [
        ['a', 1, 3],
        ['c', 1, 2],
        ['gone', 0, 9],
      ]),
      session(1, [
        ['a', 0, 2],
        ['c', 2, 1],
      ]),
    ];
    const performance = cardPerformance(base({ data, sessions }));
    expect(performance.has('gone')).toBe(false);
    expect(findWeakCards(performance).map((w) => w.card.id)).toEqual(['a', 'c']);
    expect(findWeakCards(performance, 'spa').map((w) => w.card.id)).toEqual(['c']);
  });
});

describe('retention, kept apart from accuracy', () => {
  it('reports observed Review recall and the schedule’s estimate separately', () => {
    const data = {
      schemaVersion: 2 as const,
      decks: [deck('bio')],
      cards: [card('a', 'bio'), card('b', 'bio'), card('c', 'bio')],
    };
    const records = new Map([
      ['a', progress('a', 'bio', { intervalDays: 30, stage: 'mastered', reviews: 5, correct: 5 })],
      [
        'b',
        progress('b', 'bio', {
          intervalDays: 0,
          stage: 'learning',
          dueAt: at(3),
          reviews: 3,
          correct: 1,
          incorrect: 2,
        }),
      ],
    ]);
    const b = base({ data, records, history: [{ day: dayKey(NOW), reviews: 8, correct: 6 }] });
    const estimate = retentionEstimate(b, periodRange('7d', NOW, b.earliest), NOW);
    expect(estimate.counts).toMatchObject({
      reviewable: 3,
      newCards: 1,
      mastered: 1,
      learning: 1,
      overdue: 1,
    });
    expect(estimate.averageIntervalDays).toBe(15);
    expect(estimate).toMatchObject({ reviewAnswered: 8, reviewCorrect: 6, reviewAccuracy: 0.75 });
  });
});

describe('study history', () => {
  const data = {
    schemaVersion: 2 as const,
    decks: [deck('bio', 'Biology'), deck('spa', 'Spanish')],
    cards: [card('b1', 'bio'), card('s1', 'spa')],
  };
  const sessions = [
    session(10, [['b1', 9, 1]], { deckId: 'bio' }),
    session(5, [['s1', 1, 4]], { deckId: 'spa' }),
    session(1, [
      ['b1', 3, 2],
      ['s1', 1, 0],
    ]),
    session(0, [['x', 1, 0]], { deckId: 'deleted' }),
  ];
  const b = base({ data, sessions });

  it('lists every session, newest first', () => {
    const entries = studyHistory(b, NO_HISTORY_FILTER);
    expect(entries.map((e) => e.session.id)).toEqual(sessions.map((s) => s.id).reverse());
    expect(entries[0]).toMatchObject({ deckDeleted: true, deckIds: [] });
    expect(entries[1]?.deckIds.sort()).toEqual(['bio', 'spa']);
    expect(entries[2]).toMatchObject({ incorrect: 4, accuracy: 0.2 });
  });

  it('filters by date range, deck and performance', () => {
    const ids = (filter: Partial<typeof NO_HISTORY_FILTER>) =>
      studyHistory(b, { ...NO_HISTORY_FILTER, ...filter }).map((e) => e.session.id);
    expect(ids({ from: dayKey(at(5)), to: dayKey(at(1)) })).toEqual([
      sessions[2]!.id,
      sessions[1]!.id,
    ]);
    expect(ids({ deckId: 'bio' })).toEqual([sessions[2]!.id, sessions[0]!.id]);
    expect(ids({ performance: 'strong' })).toEqual([sessions[3]!.id, sessions[0]!.id]);
    expect(ids({ performance: 'fair' })).toEqual([sessions[2]!.id]);
    expect(ids({ performance: 'weak' })).toEqual([sessions[1]!.id]);
  });

  it('sorts accuracy into bands', () => {
    expect(performanceBand(0.8)).toBe('strong');
    expect(performanceBand(0.5)).toBe('fair');
    expect(performanceBand(0.49)).toBe('weak');
    expect(performanceBand(null)).toBeNull();
  });

  it('pages through long lists', () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    expect(paginate(items, 1, 10)).toMatchObject({
      page: 1,
      pages: 3,
      total: 23,
      items: items.slice(0, 10),
    });
    expect(paginate(items, 3, 10).items).toEqual([20, 21, 22]);
    expect(paginate(items, 99, 10).page).toBe(3);
    expect(paginate(items, 0, 10).page).toBe(1);
    expect(paginate([], 1, 10)).toEqual({ items: [], page: 1, pages: 1, total: 0 });
  });
});

describe('goal progress', () => {
  const goal = (id: StudyGoal['id'], target: number, setDaysAgo = 30): StudyGoal => ({
    id,
    target,
    updatedAt: at(setDaysAgo),
    changes: [{ at: at(setDaysAgo), target }],
  });

  it('measures today’s cards and minutes against their targets', () => {
    const b = base({
      sessions: [session(0, [['c1', 8, 4]], { durationMs: 7 * 60_000 })],
      goals: [goal('cards-per-day', 20), goal('minutes-per-day', 5)],
    });
    const [cards, minutes] = goalProgress(b, NOW);
    expect(cards).toMatchObject({
      kind: 'cards-per-day',
      value: 12,
      target: 20,
      met: false,
      remaining: 8,
    });
    expect(cards?.fraction).toBeCloseTo(0.6);
    expect(cards?.history).toHaveLength(14);
    expect(cards?.history.at(-1)).toMatchObject({ current: true, value: 12, met: false });
    expect(minutes).toMatchObject({ value: 7, met: true, remaining: 0 });
  });

  it('measures this week’s sessions and study days', () => {
    const b = base({
      sessions: [
        session(0, [['c1', 1, 0]]),
        session(0, [['c1', 1, 0]]),
        session(1, [['c1', 1, 0]]),
      ],
      goals: [goal('sessions-per-week', 3), goal('days-per-week', 4)],
    });
    const [sessions, days] = goalProgress(b, NOW);
    expect(sessions).toMatchObject({ value: 3, met: true });
    expect(days).toMatchObject({ value: 2, met: false, remaining: 2 });
    expect(days?.history).toHaveLength(8);
  });

  it('judges past periods by the target that applied then, and leaves out goals that are off', () => {
    const changing: StudyGoal = {
      id: 'cards-per-day',
      target: 10,
      updatedAt: at(1, 9),
      changes: [
        { at: at(5), target: 2 },
        { at: at(1, 9), target: 10 },
      ],
    };
    const b = base({
      sessions: [session(3, [['c1', 3, 0]]), session(1, [['c1', 3, 0]])],
      goals: [changing, { ...goal('days-per-week', 3), target: null }],
    });
    const progress = goalProgress(b, NOW);
    expect(progress.map((p) => p.kind)).toEqual(['cards-per-day']);
    const history = progress[0]!.history;
    const byDay = new Map(history.map((h) => [dayKey(h.start), h]));
    expect(byDay.get(dayKey(at(3)))).toMatchObject({ target: 2, value: 3, met: true });
    expect(byDay.get(dayKey(at(1)))).toMatchObject({ target: 10, value: 3, met: false });
    expect(byDay.get(dayKey(at(10)))).toMatchObject({ target: null, met: null });
  });
});

describe('a large study history', () => {
  it('is indexed and summarised quickly', () => {
    const cards = Array.from({ length: 2000 }, (_, i) => card(`c${i}`, i % 2 ? 'bio' : 'spa'));
    const sessions = Array.from({ length: 3000 }, (_, i) =>
      session(
        i % 365,
        Array.from(
          { length: i < 400 ? 20 : 0 },
          (_, j) => [`c${(i * 7 + j) % 2000}`, 1, j % 3 === 0 ? 1 : 0] as [string, number, number],
        ),
        {
          answered: 25,
          correct: 18,
        },
      ),
    );
    const history = Array.from({ length: 3650 }, (_, i) => ({
      day: dayKey(addDays(NOW, -i)),
      reviews: 30,
      correct: 25,
    }));
    const records = new Map(
      cards.map((c) => [c.id, progress(c.id, c.deckId, { reviews: 12, correct: 9, incorrect: 3 })]),
    );
    const started = performance.now();
    const b = buildAnalyticsBase({
      data: { schemaVersion: 2, decks: [deck('bio'), deck('spa')], cards },
      records,
      history,
      sessions,
      goals: [],
    });
    for (const period of ['7d', '30d', '90d', 'all'] as const) {
      const summary = overview(b, period, NOW);
      activitySeries(b, summary.range);
      deckPerformance(b, period, NOW);
    }
    findWeakCards(cardPerformance(b));
    activityHeatmap(b, NOW);
    studyHistory(b, NO_HISTORY_FILTER);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(overview(b, 'all', NOW).totals.sessions).toBe(3000);
  });
});
