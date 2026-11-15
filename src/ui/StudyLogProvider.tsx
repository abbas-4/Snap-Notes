import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createId } from '../domain/ids';
import { setGoal as applyGoal, type GoalKind } from '../domain/studyGoals';
import {
  compactSessions,
  logAnswer as addToLog,
  type AnswerInput,
  type SessionScope,
} from '../domain/studySessions';
import type { Timestamp } from '../domain/types';
import {
  ANALYTICS_STORAGE_KEY,
  loadAnalytics,
  saveAnalytics,
  type AnalyticsData,
} from '../storage/analyticsStore';
import { resolveStorage } from '../storage/localStore';
import type { WriteResult } from './appData';
import { StudyLogContext, type LogResult, type StudyLogValue } from './studyLog';

interface StudyLogProviderProps {
  /** Defaults to the browser's localStorage. Tests pass an in-memory fake. */
  storage?: Storage | null;
  children: ReactNode;
}

/**
 * Loads the study log and goals once and owns them afterwards, exactly as
 * `ProgressProvider` does for learning progress: validated on the way in and
 * out, saved under its own key, and taken from another tab when that tab
 * saves. A problem here never affects cards, decks or progress.
 */
export default function StudyLogProvider({ storage, children }: StudyLogProviderProps) {
  const [resolved] = useState(() => resolveStorage(storage));
  const [loaded] = useState(() => loadAnalytics(resolved));
  const [state, setState] = useState<AnalyticsData>(() => loaded.data);
  const [saveError, setSaveError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const replaceState = useCallback((next: AnalyticsData) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const blocked = !loaded.ok && loaded.error === 'newer-version';
  const inMemoryOnly = !loaded.ok && loaded.error === 'unavailable';
  const canSave = !blocked && !inMemoryOnly;

  const commit = useCallback(
    (next: AnalyticsData): WriteResult => {
      if (blocked) {
        return { ok: false, message: 'Saved study history is from a newer version of Snap Notes.' };
      }
      const compacted = compactSessions(next.sessions);
      const tidy = compacted.changed ? { ...next, sessions: compacted.sessions } : next;
      if (canSave) {
        const saved = saveAnalytics(resolved, tidy);
        if (!saved.ok) {
          setSaveError(saved.message);
          return { ok: false, message: saved.message };
        }
        setSaveError(null);
      }
      replaceState(tidy);
      return { ok: true };
    },
    [blocked, canSave, replaceState, resolved],
  );

  const getAnalytics = useCallback(() => stateRef.current, []);

  useEffect(() => {
    if (!canSave) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== ANALYTICS_STORAGE_KEY || event.storageArea !== resolved) return;
      const reloaded = loadAnalytics(resolved);
      if (reloaded.ok) replaceState(reloaded.data);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [canSave, replaceState, resolved]);

  const logAnswer = useCallback(
    (sessionId: string | null, scope: SessionScope, answer: AnswerInput): LogResult => {
      const latest = stateRef.current;
      const result = addToLog(latest.sessions, sessionId, scope, answer, createId);
      const saved = commit({ ...latest, sessions: result.sessions });
      return saved.ok ? { ok: true, sessionId: result.sessionId } : saved;
    },
    [commit],
  );

  const setGoal = useCallback(
    (kind: GoalKind, target: number | null, now: Timestamp = Date.now()): WriteResult => {
      const latest = stateRef.current;
      return commit({ ...latest, goals: applyGoal(latest.goals, kind, target, now) });
    },
    [commit],
  );

  const clearSessions = useCallback((): WriteResult => {
    const latest = stateRef.current;
    if (latest.sessions.length === 0) return { ok: true };
    return commit({ ...latest, sessions: [] });
  }, [commit]);

  let analyticsWarning: string | null = null;
  if (blocked) {
    analyticsWarning = `${loaded.message} Your study history is safe, but new sessions will not be recorded until Snap Notes is updated.`;
  } else if (saveError) {
    analyticsWarning = `Your study session could not be recorded: ${saveError} Your answers and progress are saved.`;
  } else if (loaded.ok && loaded.reset) {
    analyticsWarning =
      'Saved study history could not be read, so analytics start again from here. Your cards, decks and progress are unchanged.';
  } else if (loaded.ok && loaded.dropped > 0) {
    const entries = loaded.dropped === 1 ? 'entry was' : 'entries were';
    analyticsWarning = `${loaded.dropped} damaged study history ${entries} left out. Everything else was kept.`;
  }

  const value = useMemo<StudyLogValue>(
    () => ({
      sessions: state.sessions,
      goals: state.goals,
      analyticsWarning,
      logAnswer,
      setGoal,
      clearSessions,
      snapshot: state,
      getAnalytics,
      replaceAnalytics: commit,
    }),
    [state, analyticsWarning, logAnswer, setGoal, clearSessions, getAnalytics, commit],
  );

  return <StudyLogContext.Provider value={value}>{children}</StudyLogContext.Provider>;
}
