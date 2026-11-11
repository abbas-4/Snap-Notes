import { createContext, useContext } from 'react';
import type { AppData } from '../domain/types';
import type { MergeReport } from '../storage/importExport';
import type { MigrationRecord } from '../storage/migrationRecord';

export type WriteResult = { ok: true } | { ok: false; message: string };

export type ImportOutcome = { ok: true; report: MergeReport } | { ok: false; message: string };

export interface CardInput {
  term: string;
  definition: string;
  /** Which deck the card belongs in. Left out, a new card goes to the default deck. */
  deckId?: string;
}

/**
 * What the UI can do with the app's data. All writes go through the storage
 * layer's validation; a failed write leaves both state and storage unchanged.
 */
export interface AppDataValue {
  data: AppData;
  /** Set when changes cannot be persisted (browser storage is unavailable or refused a write). */
  persistenceWarning: string | null;
  /** The record of the move from the original app, until the user dismisses the notice about it. */
  migrationRecord: MigrationRecord | null;
  dismissMigrationNotice(): void;
  /** Whether the original app left data in this browser. */
  legacyDataAvailable: boolean;
  /** The original app's data exactly as stored, or null when there is none or it cannot be read. */
  legacyRawData(): string | null;
  /** Reads the original app's cards and merges them into the current data. */
  importFromLegacy(): ImportOutcome;
  addCard(input: CardInput): WriteResult;
  updateCard(id: string, input: CardInput): WriteResult;
  deleteCard(id: string): WriteResult;
  /** Adds a deck. The name is trimmed, and must be non-empty and not already in use. */
  createDeck(name: string): WriteResult;
  renameDeck(deckId: string, name: string): WriteResult;
  /**
   * Removes a deck after moving every card it holds into `moveCardsTo`.
   * Deleting a deck never deletes cards, and the last deck cannot be deleted.
   */
  deleteDeck(deckId: string, moveCardsTo: string): WriteResult;
  /** Moves cards into another deck, leaving everything else about them alone. */
  moveCards(cardIds: readonly string[], toDeckId: string): WriteResult;
  /** Parses and validates an export file, then merges it into the current data. */
  importCards(text: string): ImportOutcome;
  /** The current data serialized in the versioned export format. */
  exportText(): string;
}

export const AppDataContext = createContext<AppDataValue | null>(null);

export function useAppData(): AppDataValue {
  const value = useContext(AppDataContext);
  if (!value) throw new Error('useAppData must be used inside <AppDataProvider>');
  return value;
}
