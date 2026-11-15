import { useMemo } from 'react';
import {
  buildAnalyticsBase,
  cardPerformance,
  findWeakCards,
  type AnalyticsBase,
  type CardPerformance,
  type WeakCard,
} from '../domain/analytics';
import { useAppData } from './appData';
import { useProgress } from './progress';
import { useStudyLog } from './studyLog';

/**
 * The analytics input, indexed once per change to the data behind it.
 *
 * Rebuilt only when cards, progress, the review log, sessions or goals
 * change, never on an unrelated render, so a large study history is indexed
 * once and every chart and table reads from the same index.
 */
export function useAnalyticsBase(): AnalyticsBase {
  const { data } = useAppData();
  const { records, history } = useProgress();
  const { sessions, goals } = useStudyLog();
  return useMemo(
    () => buildAnalyticsBase({ data, records, history, sessions, goals }),
    [data, records, history, sessions, goals],
  );
}

/** Every card's answer history, from the same index. */
export function useCardPerformance(base: AnalyticsBase): Map<string, CardPerformance> {
  return useMemo(() => cardPerformance(base), [base]);
}

/** The cards the user keeps getting wrong, optionally in one deck. */
export function useWeakCards(deckId: string | null = null): WeakCard[] {
  const base = useAnalyticsBase();
  const performance = useCardPerformance(base);
  return useMemo(() => findWeakCards(performance, deckId), [performance, deckId]);
}
