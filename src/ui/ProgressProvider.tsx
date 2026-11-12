import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { gradeProgress, type ReviewGrade } from '../domain/srs';
import type { Card, Timestamp } from '../domain/types';
import { resolveStorage } from '../storage/localStore';
import {
  loadProgress,
  PROGRESS_STORAGE_KEY,
  recordActivity,
  recordsById,
  reconcileProgress,
  saveProgress,
  type ProgressData,
} from '../storage/progressStore';
import { useAppData } from './appData';
import type { WriteResult } from './appData';
import { ProgressContext, type ProgressValue } from './progress';

interface ProgressProviderProps {
  /** Defaults to the browser's localStorage. Tests pass an in-memory fake. */
  storage?: Storage | null;
  children: ReactNode;
}

/**
 * Loads learning progress once and owns it afterwards.
 *
 * It sits inside `AppDataProvider`, so the cards are already loaded and valid
 * by the time any of this runs. Records are kept in step with those cards:
 * when a card is deleted its record goes with it, and when a card changes deck
 * its record follows. Progress is saved under its own key, so a problem here
 * can never put cards or decks at risk.
 */
export default function ProgressProvider({ storage, children }: ProgressProviderProps) {
  const { data, getData } = useAppData();
  const [resolved] = useState(() => resolveStorage(storage));
  const [loaded] = useState(() => loadProgress(resolved));
  const [progress, setProgress] = useState<ProgressData>(() => loaded.data);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The latest progress, updated the moment a write lands, so operations made
  // between renders (a sync, a quick second answer) build on each other.
  const progressRef = useRef(progress);
  const replaceState = useCallback((next: ProgressData) => {
    progressRef.current = next;
    setProgress(next);
  }, []);

  // Saved progress written by a newer version is left exactly as it is: this
  // version cannot read it, so it must not write over it either.
  const blocked = !loaded.ok && loaded.error === 'newer-version';
  // No storage at all: the session still works, but nothing is kept.
  const inMemoryOnly = !loaded.ok && loaded.error === 'unavailable';
  const canSave = !blocked && !inMemoryOnly;

  const commit = useCallback(
    (next: ProgressData): WriteResult => {
      if (blocked) {
        return { ok: false, message: 'Saved progress is from a newer version of Snap Notes.' };
      }
      if (canSave) {
        const saved = saveProgress(resolved, next);
        if (!saved.ok) {
          setSaveError(saved.message);
          return { ok: false, message: saved.message };
        }
        setSaveError(null);
      }
      replaceState(next);
      return { ok: true };
    },
    [blocked, canSave, replaceState, resolved],
  );

  /** The latest progress, kept in step with the latest cards. */
  const getProgress = useCallback((): ProgressData => {
    const latest = progressRef.current;
    const reconciledNow = reconcileProgress(latest.records, getData());
    return reconciledNow.changed ? { ...latest, records: reconciledNow.records } : latest;
  }, [getData]);

  // Another tab saved progress: take it, so this tab never writes over it.
  useEffect(() => {
    if (!canSave) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== PROGRESS_STORAGE_KEY || event.storageArea !== resolved) return;
      const reloaded = loadProgress(resolved);
      if (reloaded.ok) replaceState(reloaded.data);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [canSave, replaceState, resolved]);

  // Cards can be deleted, moved between decks or replaced by an import at any
  // time. Records follow them, and a record left without a card is dropped.
  // This is worked out while rendering rather than afterwards, so the rest of
  // the app never sees a record for a card that is not there.
  const reconciled = useMemo(
    () => reconcileProgress(progress.records, data),
    [progress.records, data],
  );
  const current = useMemo(
    () => (reconciled.changed ? { ...progress, records: reconciled.records } : progress),
    [progress, reconciled],
  );

  // Storage catches up with what the render already uses.
  useEffect(() => {
    if (!reconciled.changed || !canSave) return;
    saveProgress(resolved, current);
  }, [canSave, current, reconciled.changed, resolved]);

  const records = useMemo(() => recordsById(current.records), [current.records]);

  const gradeCard = useCallback(
    (card: Card, grade: ReviewGrade, now: Timestamp = Date.now()): WriteResult => {
      const latest = getProgress();
      const previous = latest.records.find((record) => record.cardId === card.id);
      const updated = gradeProgress(previous, grade, {
        cardId: card.id,
        deckId: card.deckId,
        now,
      });
      const others = latest.records.filter((record) => record.cardId !== card.id);
      return commit({
        ...latest,
        records: [...others, updated],
        history: recordActivity(latest.history, now, grade !== 'again'),
      });
    },
    [commit, getProgress],
  );

  const resetCard = useCallback(
    (cardId: string): WriteResult => {
      const latest = getProgress();
      if (!latest.records.some((record) => record.cardId === cardId)) return { ok: true };
      const kept = latest.records.filter((record) => record.cardId !== cardId);
      return commit({ ...latest, records: kept });
    },
    [commit, getProgress],
  );

  const resetDeck = useCallback(
    (deckId: string): WriteResult => {
      const latest = getProgress();
      // The cards decide which records belong to the deck; a record only
      // remembers a deck so it can be read on its own.
      const inDeck = new Set(
        getData()
          .cards.filter((card) => card.deckId === deckId)
          .map((card) => card.id),
      );
      const kept = latest.records.filter((record) => !inDeck.has(record.cardId));
      if (kept.length === latest.records.length) return { ok: true };
      return commit({ ...latest, records: kept });
    },
    [commit, getData, getProgress],
  );

  const resetAll = useCallback((): WriteResult => {
    const latest = getProgress();
    if (latest.records.length === 0 && latest.history.length === 0) return { ok: true };
    return commit({ ...latest, records: [], history: [] });
  }, [commit, getProgress]);

  let progressWarning: string | null = null;
  if (blocked) {
    progressWarning = `${loaded.message} Your saved progress is safe, but reviews will not be recorded until Snap Notes is updated.`;
  } else if (saveError) {
    progressWarning = `Your review progress could not be saved: ${saveError}`;
  } else if (loaded.ok && loaded.reset) {
    progressWarning =
      'Saved review progress could not be read, so it has been started again. Your cards and decks are unchanged.';
  } else if (loaded.ok && loaded.dropped > 0) {
    const records = loaded.dropped === 1 ? 'record was' : 'records were';
    progressWarning = `${loaded.dropped} damaged review ${records} left out of your saved progress. Everything else was kept.`;
  }

  const value = useMemo<ProgressValue>(
    () => ({
      records,
      history: current.history,
      progressWarning,
      gradeCard,
      resetCard,
      resetDeck,
      resetAll,
      snapshot: current,
      getProgress,
      replaceProgress: commit,
    }),
    [
      records,
      current,
      progressWarning,
      gradeCard,
      resetCard,
      resetDeck,
      resetAll,
      getProgress,
      commit,
    ],
  );

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}
