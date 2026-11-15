import { describe, expect, it } from 'vitest';
import type { StudySession } from '../domain/studySessions';
import { MemoryStorage } from '../test/memoryStorage';
import {
  ANALYTICS_STORAGE_KEY,
  ANALYTICS_VERSION,
  emptyAnalytics,
  loadAnalytics,
  saveAnalytics,
  studyGoalSchema,
  studySessionSchema,
  type AnalyticsData,
} from './analyticsStore';

const T = 1_800_000_000_000;

function session(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: 'session-1',
    mode: 'quiz',
    deckId: null,
    day: '2027-01-15',
    startedAt: T,
    endedAt: T + 1000,
    durationMs: 1000,
    answered: 2,
    correct: 1,
    responseMs: 900,
    timedAnswers: 1,
    results: [{ cardId: 'card-1', correct: 1, incorrect: 1 }],
    ...overrides,
  };
}

function stored(value: unknown): MemoryStorage {
  return new MemoryStorage({ [ANALYTICS_STORAGE_KEY]: JSON.stringify(value) });
}

describe('loading the study log', () => {
  it('starts empty when nothing has been saved', () => {
    expect(loadAnalytics(new MemoryStorage())).toEqual({
      ok: true,
      data: emptyAnalytics(),
      reset: false,
      dropped: 0,
    });
  });

  it('reads what was saved', () => {
    const data: AnalyticsData = {
      version: ANALYTICS_VERSION,
      sessions: [session()],
      goals: [{ id: 'cards-per-day', target: 20, updatedAt: T, changes: [{ at: T, target: 20 }] }],
    };
    const storage = new MemoryStorage();
    expect(saveAnalytics(storage, data)).toEqual({ ok: true });
    expect(loadAnalytics(storage)).toEqual({ ok: true, data, reset: false, dropped: 0 });
  });

  it('leaves out damaged entries one at a time, and keeps the rest', () => {
    const load = loadAnalytics(
      stored({
        version: 1,
        sessions: [
          session(),
          session({ id: 'bad', correct: 5 }),
          session({ id: 'bad-2', endedAt: T - 1 }),
          { nonsense: true },
          session({ id: 'session-1', answered: 3, correct: 2 }),
        ],
        goals: [{ id: 'not-a-goal', target: 1, updatedAt: T, changes: [] }],
      }),
    );
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    // Three bad sessions, one bad goal, one repeated session.
    expect(load.dropped).toBe(5);
    expect(load.data.sessions).toHaveLength(1);
    expect(load.data.sessions[0]?.answered).toBe(3);
    expect(load.data.goals).toEqual([]);
  });

  it('starts again from empty when nothing can be read, and says so', () => {
    const storage = new MemoryStorage({ [ANALYTICS_STORAGE_KEY]: '{not json' });
    expect(loadAnalytics(storage)).toMatchObject({ ok: true, reset: true, data: emptyAnalytics() });
    expect(loadAnalytics(stored(['an', 'array']))).toMatchObject({ ok: true, reset: true });
  });

  it('refuses a log written by a newer version, without touching it', () => {
    const storage = stored({ version: 2, sessions: [] });
    const before = storage.getItem(ANALYTICS_STORAGE_KEY);
    expect(loadAnalytics(storage)).toMatchObject({ ok: false, error: 'newer-version' });
    expect(storage.getItem(ANALYTICS_STORAGE_KEY)).toBe(before);
  });

  it('reports missing storage', () => {
    expect(loadAnalytics(null)).toMatchObject({ ok: false, error: 'unavailable' });
    expect(saveAnalytics(null, emptyAnalytics())).toMatchObject({
      ok: false,
      error: 'unavailable',
    });
  });
});

describe('saving the study log', () => {
  it('refuses invalid data instead of saving it', () => {
    const storage = new MemoryStorage();
    const result = saveAnalytics(storage, {
      ...emptyAnalytics(),
      sessions: [session({ timedAnswers: 9 })],
    });
    expect(result).toMatchObject({ ok: false, error: 'invalid-data' });
    expect(storage.getItem(ANALYTICS_STORAGE_KEY)).toBeNull();
  });

  it('reports a full storage', () => {
    const storage = new MemoryStorage();
    storage.failWrites = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    expect(saveAnalytics(storage, emptyAnalytics())).toMatchObject({
      ok: false,
      error: 'quota-exceeded',
    });
  });
});

describe('the record rules shared with the server', () => {
  it('accepts sessions for every deck or one, and no more than the per-session card limit', () => {
    expect(studySessionSchema.safeParse(session({ deckId: 'deck-1' })).success).toBe(true);
    expect(studySessionSchema.safeParse(session({ deckId: 'bad id' })).success).toBe(false);
    expect(studySessionSchema.safeParse(session({ day: '15/01/2027' })).success).toBe(false);
    expect(studySessionSchema.safeParse(session({ mode: 'study' as never })).success).toBe(false);
    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      cardId: `c${i}`,
      correct: 1,
      incorrect: 0,
    }));
    expect(studySessionSchema.safeParse(session({ results: tooMany })).success).toBe(false);
  });

  it('accepts goals switched off, and targets within range', () => {
    const goal = {
      id: 'days-per-week',
      target: null,
      updatedAt: T,
      changes: [{ at: T, target: null }],
    };
    expect(studyGoalSchema.safeParse(goal).success).toBe(true);
    expect(studyGoalSchema.safeParse({ ...goal, target: 0 }).success).toBe(false);
    expect(studyGoalSchema.safeParse({ ...goal, target: 100_001 }).success).toBe(false);
    expect(studyGoalSchema.safeParse({ ...goal, target: 2.5 }).success).toBe(false);
  });
});
