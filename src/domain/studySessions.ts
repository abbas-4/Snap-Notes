import { dayKey } from './srs';
import type { Timestamp } from './types';

/**
 * The study log: one record for every study session, written while the user
 * works.
 *
 * Learning progress (Milestone 7) keeps, per card, how many times it has been
 * reviewed, and per day, how many reviews were made. That is enough to
 * schedule cards, but not to say when the user studied, for how long, in which
 * mode, or how quickly they answered. A session record adds exactly that, and
 * nothing that can already be read elsewhere.
 *
 * Sessions are append-only. A session is created by the device it happens on,
 * under a random ID, and only that device ever adds answers to it. Two devices
 * can therefore never edit the same session, and syncing them is a union by
 * ID: a session can never be counted twice.
 *
 * Every function here is pure and takes the time as an argument.
 */

export const STUDY_MODES = ['review', 'quiz', 'learn', 'match'] as const;

/** The modes that record what the user answered. Study (flipping cards) has no answers. */
export type StudyMode = (typeof STUDY_MODES)[number];

/** How one card went in one session. */
export interface SessionCardResult {
  cardId: string;
  /** Answers judged correct. */
  correct: number;
  /** Answers judged wrong. */
  incorrect: number;
}

export interface StudySession {
  id: string;
  mode: StudyMode;
  /** The deck the session was started on, or null when it covered every deck. */
  deckId: string | null;
  /**
   * The local calendar day the session happened on, as `YYYY-MM-DD`, fixed
   * when it was recorded, exactly like the day-by-day review log. Travelling
   * to another time zone afterwards never moves a session to another day.
   */
  day: string;
  /** When the first card of the session was shown. */
  startedAt: Timestamp;
  /** When the last answer was given. */
  endedAt: Timestamp;
  /** Active study time in milliseconds. Pauses count for at most {@link MAX_GAP_MS}. */
  durationMs: number;
  /** Answers given, and how many of them were correct. */
  answered: number;
  correct: number;
  /** The total of every measured response time, in milliseconds. */
  responseMs: number;
  /** How many answers have a measured response time (see {@link MAX_RESPONSE_MS}). */
  timedAnswers: number;
  /**
   * One entry per card, in the order the cards were first answered. Kept for
   * the most recent sessions only; older sessions keep their totals and drop
   * this detail (see {@link compactSessions}).
   */
  results: SessionCardResult[];
}

/** An answer slower than this is not timed: the user was probably not looking. */
export const MAX_RESPONSE_MS = 60_000;

/** The longest pause that still counts, in full, as study time. Longer pauses count this much. */
export const MAX_GAP_MS = 2 * 60_000;

/** A pause longer than this ends the session; the next answer starts a new one. */
export const SESSION_BREAK_MS = 30 * 60_000;

/** A session holds at most this many different cards; the next card starts a new session. */
export const MAX_SESSION_CARDS = 500;

/** Sessions that keep their per-card detail. Older ones keep only their totals. */
export const DETAILED_SESSIONS = 400;

/** Sessions kept at all. The oldest are dropped beyond this. */
export const MAX_SESSIONS = 3000;

/** One answer, as a study mode reports it. */
export interface AnswerInput {
  cardId: string;
  correct: boolean;
  /** When the answer was given. */
  at: Timestamp;
  /** When the card was put in front of the user, or null when the mode cannot tell. */
  shownAt: Timestamp | null;
}

/** Which session an answer belongs to: the mode and deck it was given in. */
export interface SessionScope {
  mode: StudyMode;
  deckId: string | null;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** A measured response time, or null when there is none worth keeping. */
export function responseTime(answer: AnswerInput): number | null {
  if (answer.shownAt === null) return null;
  const elapsed = answer.at - answer.shownAt;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > MAX_RESPONSE_MS) return null;
  return Math.round(elapsed);
}

/**
 * Whether `answer` carries on `session` or starts a new one: a session ends
 * at midnight, after a long pause, when the mode or deck changes, or when it
 * already holds as many cards as a session can.
 */
export function continuesSession(
  session: StudySession,
  scope: SessionScope,
  answer: AnswerInput,
): boolean {
  if (session.mode !== scope.mode || session.deckId !== scope.deckId) return false;
  if (dayKey(answer.at) !== session.day) return false;
  if (answer.at - session.endedAt > SESSION_BREAK_MS) return false;
  if (answer.at < session.startedAt) return false;
  const known = session.results.some((result) => result.cardId === answer.cardId);
  return known || session.results.length < MAX_SESSION_CARDS;
}

/** A new session holding its first answer. */
export function startSession(id: string, scope: SessionScope, answer: AnswerInput): StudySession {
  // The session starts when its first card was shown, unless that was on an
  // earlier day or long ago: a session never reaches back past its own day.
  const shownAt = answer.shownAt;
  const startedAt =
    shownAt !== null &&
    shownAt <= answer.at &&
    answer.at - shownAt <= MAX_GAP_MS &&
    dayKey(shownAt) === dayKey(answer.at)
      ? shownAt
      : answer.at;
  const empty: StudySession = {
    id,
    mode: scope.mode,
    deckId: scope.deckId,
    day: dayKey(answer.at),
    startedAt,
    endedAt: startedAt,
    durationMs: 0,
    answered: 0,
    correct: 0,
    responseMs: 0,
    timedAnswers: 0,
    results: [],
  };
  return addAnswer(empty, answer);
}

/** Adds one answer to a session and returns the new session. `session` is left untouched. */
export function addAnswer(session: StudySession, answer: AnswerInput): StudySession {
  const at = Math.max(answer.at, session.endedAt);
  const gap = nonNegative(at - session.endedAt);
  const timed = responseTime(answer);

  const results = session.results.slice();
  const index = results.findIndex((result) => result.cardId === answer.cardId);
  const existing =
    index === -1 ? { cardId: answer.cardId, correct: 0, incorrect: 0 } : results[index]!;
  const updated: SessionCardResult = answer.correct
    ? { ...existing, correct: existing.correct + 1 }
    : { ...existing, incorrect: existing.incorrect + 1 };
  if (index === -1) results.push(updated);
  else results[index] = updated;

  return {
    ...session,
    endedAt: at,
    durationMs: session.durationMs + Math.min(gap, MAX_GAP_MS),
    answered: session.answered + 1,
    correct: session.correct + (answer.correct ? 1 : 0),
    responseMs: session.responseMs + (timed ?? 0),
    timedAnswers: session.timedAnswers + (timed === null ? 0 : 1),
    results,
  };
}

export interface LogAnswerResult {
  sessions: StudySession[];
  /** The session the answer went into, to pass back with the next answer. */
  sessionId: string;
}

/**
 * Records one answer in the log: into the session named by `currentId` when
 * the answer carries it on, or into a new session (with ID `newId`) when not.
 */
export function logAnswer(
  sessions: readonly StudySession[],
  currentId: string | null,
  scope: SessionScope,
  answer: AnswerInput,
  newId: () => string,
): LogAnswerResult {
  const current = currentId === null ? undefined : sessions.find((s) => s.id === currentId);
  if (current && continuesSession(current, scope, answer)) {
    const updated = addAnswer(current, answer);
    return {
      sessions: sessions.map((session) => (session.id === current.id ? updated : session)),
      sessionId: current.id,
    };
  }
  const created = startSession(newId(), scope, answer);
  return { sessions: [...sessions, created], sessionId: created.id };
}

/** Answers judged wrong in a session. */
export function sessionIncorrect(session: StudySession): number {
  return Math.max(0, session.answered - session.correct);
}

/** The share of a session's answers that were correct, or null when it has none. */
export function sessionAccuracy(session: StudySession): number | null {
  return session.answered === 0 ? null : session.correct / session.answered;
}

/** Of two copies of one session, the one to keep: more answers, then more detail. */
export function betterSession(a: StudySession, b: StudySession): StudySession {
  if (a.answered !== b.answered) return a.answered > b.answered ? a : b;
  if (a.endedAt !== b.endedAt) return a.endedAt > b.endedAt ? a : b;
  // The same session, compacted on one side: compaction is where every device
  // ends up, so the compacted copy is kept.
  if (a.results.length !== b.results.length) return a.results.length < b.results.length ? a : b;
  return a;
}

function newestFirst(a: StudySession, b: StudySession): number {
  if (a.startedAt !== b.startedAt) return b.startedAt - a.startedAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** One copy of each session, oldest first. */
export function dedupeSessions(sessions: readonly StudySession[]): {
  sessions: StudySession[];
  duplicates: number;
} {
  const byId = new Map<string, StudySession>();
  let duplicates = 0;
  for (const session of sessions) {
    const seen = byId.get(session.id);
    if (seen) duplicates += 1;
    byId.set(session.id, seen ? betterSession(seen, session) : session);
  }
  return { sessions: [...byId.values()].sort((a, b) => newestFirst(b, a)), duplicates };
}

/**
 * Keeps the log to a size browser storage can hold: the newest
 * {@link DETAILED_SESSIONS} sessions keep their per-card detail, older ones keep
 * their totals only, and beyond {@link MAX_SESSIONS} the oldest are dropped.
 *
 * The rule depends only on the sessions themselves, never on the clock, so
 * every device holding the same sessions compacts them in the same way.
 */
export function compactSessions(sessions: readonly StudySession[]): {
  sessions: StudySession[];
  changed: boolean;
} {
  const sorted = [...sessions].sort(newestFirst);
  let changed = sorted.length > MAX_SESSIONS;
  const kept = sorted.slice(0, MAX_SESSIONS).map((session, index) => {
    if (index < DETAILED_SESSIONS || session.results.length === 0) return session;
    changed = true;
    return { ...session, results: [] };
  });
  return { sessions: kept.reverse(), changed };
}
