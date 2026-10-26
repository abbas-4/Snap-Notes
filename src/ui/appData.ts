import { createContext, useContext } from 'react';
import type { AppData } from '../domain/types';
import type { MergeReport } from '../storage/importExport';

export type WriteResult = { ok: true } | { ok: false; message: string };

export type ImportOutcome = { ok: true; report: MergeReport } | { ok: false; message: string };

export interface CardInput {
  term: string;
  definition: string;
}

/**
 * What the UI can do with the app's data. All writes go through the storage
 * layer's validation; a failed write leaves both state and storage unchanged.
 */
export interface AppDataValue {
  data: AppData;
  /** Set when changes cannot be persisted (browser storage is unavailable). */
  persistenceWarning: string | null;
  addCard(input: CardInput): WriteResult;
  updateCard(id: string, input: CardInput): WriteResult;
  deleteCard(id: string): WriteResult;
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
