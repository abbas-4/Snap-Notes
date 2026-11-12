import { createContext, useContext } from 'react';
import type { DailyActivity } from '../domain/progressStats';
import type { CardProgress, ReviewGrade } from '../domain/srs';
import type { Card, Timestamp } from '../domain/types';
import type { ProgressData } from '../storage/progressStore';
import type { WriteResult } from './appData';

/**
 * What the UI can do with learning progress.
 *
 * Grading a card is the only way progress is created or changed: every other
 * action here removes progress, and none of them touches a card, a deck, or
 * anything else the user has written.
 */
export interface ProgressValue {
  /** Every saved record, by card ID. A card with no entry has never been reviewed. */
  records: ReadonlyMap<string, CardProgress>;
  /** One entry per day studied, oldest first. */
  history: readonly DailyActivity[];
  /** Set when saved progress could not be read, or cannot be saved. */
  progressWarning: string | null;
  /** Applies one answer: updates the card's schedule and saves it. */
  gradeCard(card: Card, grade: ReviewGrade, now?: Timestamp): WriteResult;
  /** Forgets one card's learning history. The card itself is left alone. */
  resetCard(cardId: string): WriteResult;
  /** Forgets the learning history of every card in a deck. The deck and its cards stay. */
  resetDeck(deckId: string): WriteResult;
  /** Forgets all learning history, including the activity log behind the streaks. */
  resetAll(): WriteResult;
  /** Everything above as it is saved, for sync. */
  snapshot: ProgressData;
  /** The latest progress, including writes not yet rendered. For sync, not for display. */
  getProgress(): ProgressData;
  /** Replaces all progress, validated and saved. Used by sync to apply changes from other devices. */
  replaceProgress(next: ProgressData): WriteResult;
}

export const ProgressContext = createContext<ProgressValue | null>(null);

export function useProgress(): ProgressValue {
  const value = useContext(ProgressContext);
  if (!value) throw new Error('useProgress must be used inside <ProgressProvider>');
  return value;
}
