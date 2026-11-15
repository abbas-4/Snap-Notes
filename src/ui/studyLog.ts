import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { GoalKind, StudyGoal } from '../domain/studyGoals';
import type { AnswerInput, SessionScope, StudyMode, StudySession } from '../domain/studySessions';
import type { Timestamp } from '../domain/types';
import type { AnalyticsData } from '../storage/analyticsStore';
import type { WriteResult } from './appData';

export type LogResult = { ok: true; sessionId: string } | { ok: false; message: string };

/**
 * What the UI can do with the study log and goals.
 *
 * Study modes only ever add answers; nothing here edits a recorded session.
 * Forgetting the study history is part of resetting all progress, and never
 * touches a card, a deck or a goal.
 */
export interface StudyLogValue {
  /** Every recorded session, oldest first. */
  sessions: readonly StudySession[];
  goals: readonly StudyGoal[];
  /** Set when the study log could not be read, or cannot be saved. */
  analyticsWarning: string | null;
  /**
   * Adds one answer to the session named by `sessionId` (or to a new one, when
   * the answer does not carry that session on). Returns the session it went into.
   */
  logAnswer(sessionId: string | null, scope: SessionScope, answer: AnswerInput): LogResult;
  /** Sets a goal's target, or switches it off with null. */
  setGoal(kind: GoalKind, target: number | null, now?: Timestamp): WriteResult;
  /** Forgets every recorded session. Goals are kept. */
  clearSessions(): WriteResult;
  /** Everything above as it is saved, for sync. */
  snapshot: AnalyticsData;
  /** The latest data, including writes not yet rendered. For sync, not for display. */
  getAnalytics(): AnalyticsData;
  /** Replaces everything, validated and saved. Used by sync. */
  replaceAnalytics(next: AnalyticsData): WriteResult;
}

export const StudyLogContext = createContext<StudyLogValue | null>(null);

export function useStudyLog(): StudyLogValue {
  const value = useContext(StudyLogContext);
  if (!value) throw new Error('useStudyLog must be used inside <StudyLogProvider>');
  return value;
}

export interface RecordedAnswer {
  cardId: string;
  correct: boolean;
  /** When the card was shown, or null when the mode cannot tell. */
  shownAt: Timestamp | null;
}

/**
 * Records a study mode's answers into sessions. Each recorder writes to one
 * session at a time; `restart()` makes the next answer begin a new one (for a
 * new round). Recording never interrupts studying: if an answer cannot be
 * saved, the study log's warning says so and the mode carries on.
 */
export function useSessionRecorder(mode: StudyMode, deckId: string | null) {
  const { logAnswer } = useStudyLog();
  const sessionRef = useRef<string | null>(null);

  const record = useCallback(
    (answer: RecordedAnswer, at: Timestamp = Date.now()) => {
      const result = logAnswer(sessionRef.current, { mode, deckId }, { ...answer, at });
      if (result.ok) sessionRef.current = result.sessionId;
      return result;
    },
    [deckId, logAnswer, mode],
  );

  const restart = useCallback(() => {
    sessionRef.current = null;
  }, []);

  return useMemo(() => ({ record, restart }), [record, restart]);
}

/**
 * Remembers when each screen of a study mode (a question, a card, a turn)
 * first appeared, keyed by `key`. Ask `shownAt(key)` for one of the recent
 * keys when its answer comes in, to time the response; the current key is
 * the one passed in, and earlier keys stay readable for a few turns, so an
 * answer that moves the mode on can still be timed from its own card.
 */
export function useShownAt(key: string): (key: string) => Timestamp | null {
  const times = useRef(new Map<string, Timestamp>());
  useEffect(() => {
    const map = times.current;
    if (map.has(key)) return;
    map.set(key, Date.now());
    while (map.size > 8) map.delete(map.keys().next().value as string);
  }, [key]);
  return useCallback((asked: string) => times.current.get(asked) ?? null, []);
}
