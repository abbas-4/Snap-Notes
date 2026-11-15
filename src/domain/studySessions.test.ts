import { describe, expect, it } from 'vitest';
import { addDays } from './srs';
import {
  addAnswer,
  betterSession,
  compactSessions,
  continuesSession,
  dedupeSessions,
  DETAILED_SESSIONS,
  logAnswer,
  MAX_GAP_MS,
  MAX_RESPONSE_MS,
  MAX_SESSION_CARDS,
  MAX_SESSIONS,
  responseTime,
  SESSION_BREAK_MS,
  sessionAccuracy,
  sessionIncorrect,
  startSession,
  type AnswerInput,
  type SessionScope,
  type StudySession,
} from './studySessions';

// Noon local time, so a few minutes either way never crosses midnight.
const NOON = new Date(2026, 10, 10, 12, 0, 0).getTime();
const scope: SessionScope = { mode: 'review', deckId: 'bio' };

function answer(overrides: Partial<AnswerInput> = {}): AnswerInput {
  return { cardId: 'c1', correct: true, at: NOON, shownAt: NOON - 4_000, ...overrides };
}

function session(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: 's1',
    mode: 'review',
    deckId: 'bio',
    day: '2026-11-10',
    startedAt: NOON,
    endedAt: NOON,
    durationMs: 0,
    answered: 1,
    correct: 1,
    responseMs: 0,
    timedAnswers: 0,
    results: [{ cardId: 'c1', correct: 1, incorrect: 0 }],
    ...overrides,
  };
}

describe('response times', () => {
  it('times an answer from when its card was shown', () => {
    expect(responseTime(answer())).toBe(4_000);
  });

  it('does not time an answer when the mode cannot tell, the clock went back, or it took too long', () => {
    expect(responseTime(answer({ shownAt: null }))).toBeNull();
    expect(responseTime(answer({ shownAt: NOON + 1 }))).toBeNull();
    expect(responseTime(answer({ shownAt: NOON - MAX_RESPONSE_MS - 1 }))).toBeNull();
    expect(responseTime(answer({ shownAt: NOON - MAX_RESPONSE_MS }))).toBe(MAX_RESPONSE_MS);
  });
});

describe('starting and adding to a session', () => {
  it('starts when the first card was shown, on the day of the answer', () => {
    const started = startSession('s1', scope, answer());
    expect(started).toMatchObject({
      id: 's1',
      mode: 'review',
      deckId: 'bio',
      day: '2026-11-10',
      startedAt: NOON - 4_000,
      endedAt: NOON,
      durationMs: 4_000,
      answered: 1,
      correct: 1,
      responseMs: 4_000,
      timedAnswers: 1,
      results: [{ cardId: 'c1', correct: 1, incorrect: 0 }],
    });
  });

  it('never reaches back past midnight or a long pause for its start', () => {
    const justAfterMidnight = new Date(2026, 10, 10, 0, 0, 30).getTime();
    const started = startSession(
      's1',
      scope,
      answer({ at: justAfterMidnight, shownAt: justAfterMidnight - 60_000 }),
    );
    expect(started.startedAt).toBe(justAfterMidnight);
    expect(started.durationMs).toBe(0);
  });

  it('adds answers per card, counting time with long pauses capped', () => {
    let current = startSession('s1', scope, answer());
    current = addAnswer(
      current,
      answer({ cardId: 'c2', correct: false, at: NOON + 10_000, shownAt: NOON + 2_000 }),
    );
    current = addAnswer(
      current,
      answer({ cardId: 'c1', correct: false, at: NOON + 10_000 + 10 * 60_000, shownAt: null }),
    );
    expect(current.answered).toBe(3);
    expect(current.correct).toBe(1);
    expect(sessionIncorrect(current)).toBe(2);
    expect(sessionAccuracy(current)).toBeCloseTo(1 / 3);
    expect(current.results).toEqual([
      { cardId: 'c1', correct: 1, incorrect: 1 },
      { cardId: 'c2', correct: 0, incorrect: 1 },
    ]);
    // 4 s before the first answer, 10 s, then a 10-minute pause counted as 2 minutes.
    expect(current.durationMs).toBe(4_000 + 10_000 + MAX_GAP_MS);
    expect(current.timedAnswers).toBe(2);
    expect(current.responseMs).toBe(4_000 + 8_000);
  });

  it('never moves backwards when the clock does', () => {
    const current = addAnswer(session({ endedAt: NOON + 5_000 }), answer({ at: NOON }));
    expect(current.endedAt).toBe(NOON + 5_000);
    expect(current.durationMs).toBe(0);
  });

  it('has no accuracy without answers', () => {
    expect(sessionAccuracy(session({ answered: 0, correct: 0, results: [] }))).toBeNull();
  });
});

describe('when a session continues', () => {
  const current = session();

  it('carries on in the same mode, deck and day, after a short pause', () => {
    expect(continuesSession(current, scope, answer({ at: NOON + 60_000 }))).toBe(true);
  });

  it('ends at a change of mode or deck', () => {
    expect(continuesSession(current, { mode: 'quiz', deckId: 'bio' }, answer())).toBe(false);
    expect(continuesSession(current, { mode: 'review', deckId: null }, answer())).toBe(false);
  });

  it('ends after a long pause', () => {
    expect(continuesSession(current, scope, answer({ at: NOON + SESSION_BREAK_MS + 1 }))).toBe(
      false,
    );
  });

  it('ends at midnight, so a session belongs to one day', () => {
    const lateNight = new Date(2026, 10, 10, 23, 59, 0).getTime();
    const late = session({ startedAt: lateNight, endedAt: lateNight });
    expect(continuesSession(late, scope, answer({ at: lateNight + 2 * 60_000 }))).toBe(false);
  });

  it('ends when it holds as many cards as a session can, but not for a card it already has', () => {
    const full = session({
      results: Array.from({ length: MAX_SESSION_CARDS }, (_, i) => ({
        cardId: `c${i}`,
        correct: 1,
        incorrect: 0,
      })),
    });
    expect(continuesSession(full, scope, answer({ cardId: 'c3' }))).toBe(true);
    expect(continuesSession(full, scope, answer({ cardId: 'new' }))).toBe(false);
  });
});

describe('logging answers', () => {
  it('adds to the current session, or starts a new one', () => {
    let next = 0;
    const newId = () => `s${++next}`;
    const first = logAnswer([], null, scope, answer(), newId);
    expect(first.sessionId).toBe('s1');
    const second = logAnswer(first.sessions, 's1', scope, answer({ at: NOON + 5_000 }), newId);
    expect(second.sessionId).toBe('s1');
    expect(second.sessions).toHaveLength(1);
    expect(second.sessions[0]?.answered).toBe(2);
    const quiz = logAnswer(
      second.sessions,
      's1',
      { mode: 'quiz', deckId: 'bio' },
      answer({ at: NOON + 9_000 }),
      newId,
    );
    expect(quiz.sessionId).toBe('s2');
    expect(quiz.sessions).toHaveLength(2);
  });

  it('starts a new session when the named one no longer exists', () => {
    const result = logAnswer([], 'gone', scope, answer(), () => 'fresh');
    expect(result.sessionId).toBe('fresh');
  });
});

describe('copies of one session', () => {
  it('keeps the copy that got further, then the compacted one', () => {
    const short = session({ answered: 1 });
    const longer = session({ answered: 2, endedAt: NOON + 1 });
    expect(betterSession(short, longer)).toBe(longer);
    expect(betterSession(longer, short)).toBe(longer);
    const compacted = session({ results: [] });
    expect(betterSession(session(), compacted)).toBe(compacted);
    expect(betterSession(compacted, session())).toBe(compacted);
  });

  it('keeps one copy of each session, oldest first', () => {
    const { sessions, duplicates } = dedupeSessions([
      session({ id: 'b', startedAt: NOON + 10, endedAt: NOON + 10 }),
      session({ id: 'a' }),
      session({ id: 'b', startedAt: NOON + 10, endedAt: NOON + 20, answered: 3, correct: 2 }),
    ]);
    expect(duplicates).toBe(1);
    expect(sessions.map((s) => [s.id, s.answered])).toEqual([
      ['a', 1],
      ['b', 3],
    ]);
  });
});

describe('compacting the log', () => {
  function many(count: number): StudySession[] {
    return Array.from({ length: count }, (_, i) =>
      session({ id: `s${String(i).padStart(5, '0')}`, startedAt: NOON + i, endedAt: NOON + i }),
    );
  }

  it('leaves a small log alone', () => {
    const log = many(10);
    const result = compactSessions(log);
    expect(result.changed).toBe(false);
    expect(result.sessions).toEqual(log);
  });

  it('drops per-card detail from all but the newest sessions, keeping their totals', () => {
    const result = compactSessions(many(DETAILED_SESSIONS + 5));
    expect(result.changed).toBe(true);
    expect(result.sessions).toHaveLength(DETAILED_SESSIONS + 5);
    const stripped = result.sessions.filter((s) => s.results.length === 0);
    expect(stripped.map((s) => s.id)).toEqual(['s00000', 's00001', 's00002', 's00003', 's00004']);
    expect(stripped.every((s) => s.answered === 1 && s.correct === 1)).toBe(true);
  });

  it('drops the oldest sessions beyond the limit, the same way on every device', () => {
    const log = many(MAX_SESSIONS + 3);
    const one = compactSessions(log);
    const other = compactSessions([...log].reverse());
    expect(one.sessions).toHaveLength(MAX_SESSIONS);
    expect(one.sessions[0]?.id).toBe('s00003');
    expect(other.sessions).toEqual(one.sessions);
    // Compacting again changes nothing.
    expect(compactSessions(one.sessions).changed).toBe(false);
  });

  it('sorts sessions by start, whatever order they came in', () => {
    const later = session({ id: 'later', startedAt: addDays(NOON, 1) });
    const result = compactSessions([later, session()]);
    expect(result.sessions.map((s) => s.id)).toEqual(['s1', 'later']);
  });
});
