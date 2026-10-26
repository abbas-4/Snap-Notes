import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { createDefaultDeck, createEmptyAppData, DEFAULT_DECK_ID } from '../domain/appData';
import { createId } from '../domain/ids';
import type { AppData, Card } from '../domain/types';
import { mergeImportedData, parseImportFile, serializeExport } from '../storage/importExport';
import { loadAppData, saveAppData } from '../storage/localStore';
import {
  AppDataContext,
  type AppDataValue,
  type CardInput,
  type ImportOutcome,
  type WriteResult,
} from './appData';
import StorageErrorScreen from './StorageErrorScreen';

interface AppDataProviderProps {
  /** Defaults to the browser's localStorage. Tests pass an in-memory fake. */
  storage?: Storage | null;
  children: ReactNode;
}

/**
 * Loads app data once and owns it afterwards. Every write is validated and
 * saved before it reaches React state, so what the user sees is what is
 * stored. Until cutover (Milestone 5) the legacy key is never read or written.
 */
export default function AppDataProvider({ storage, children }: AppDataProviderProps) {
  const [loaded] = useState(() => loadAppData({ storage, migrateLegacy: false }));
  const [data, setData] = useState<AppData>(() =>
    loaded.ok ? loaded.data : createEmptyAppData(Date.now()),
  );

  // Data in storage is unreadable: run nothing that could overwrite it.
  const fatal = !loaded.ok && loaded.error !== 'unavailable' ? loaded : null;
  const canPersist = loaded.ok;

  const commit = useCallback(
    (next: AppData): WriteResult => {
      if (canPersist) {
        const saved = saveAppData(next, { storage });
        if (!saved.ok) return { ok: false, message: saved.message };
      }
      setData(next);
      return { ok: true };
    },
    [canPersist, storage],
  );

  const addCard = useCallback(
    (input: CardInput): WriteResult => {
      const now = Date.now();
      let decks = data.decks;
      let deck = decks.find((d) => d.id === DEFAULT_DECK_ID) ?? decks[0];
      if (!deck) {
        deck = createDefaultDeck(now);
        decks = [...decks, deck];
      }
      const card: Card = {
        id: createId(),
        deckId: deck.id,
        term: input.term,
        definition: input.definition,
        createdAt: now,
        updatedAt: now,
      };
      return commit({ ...data, decks, cards: [...data.cards, card] });
    },
    [commit, data],
  );

  const updateCard = useCallback(
    (id: string, input: CardInput): WriteResult => {
      const existing = data.cards.find((card) => card.id === id);
      if (!existing) return { ok: false, message: 'This card no longer exists.' };
      if (existing.term === input.term && existing.definition === input.definition) {
        return { ok: true };
      }
      const updatedAt = Math.max(Date.now(), existing.createdAt);
      const cards = data.cards.map((card) =>
        card.id === id
          ? { ...card, term: input.term, definition: input.definition, updatedAt }
          : card,
      );
      return commit({ ...data, cards });
    },
    [commit, data],
  );

  const deleteCard = useCallback(
    (id: string): WriteResult => {
      const cards = data.cards.filter((card) => card.id !== id);
      if (cards.length === data.cards.length) {
        return { ok: false, message: 'This card no longer exists.' };
      }
      return commit({ ...data, cards });
    },
    [commit, data],
  );

  const importCards = useCallback(
    (text: string): ImportOutcome => {
      const parsed = parseImportFile(text);
      if (!parsed.ok) return { ok: false, message: parsed.message };
      const merged = mergeImportedData(data, parsed.data);
      const committed = commit(merged.data);
      if (!committed.ok) return committed;
      return { ok: true, report: merged.report };
    },
    [commit, data],
  );

  const exportText = useCallback(() => serializeExport(data), [data]);

  const value = useMemo<AppDataValue>(
    () => ({
      data,
      persistenceWarning: canPersist
        ? null
        : 'Browser storage is unavailable, so changes will be lost when you close this page.',
      addCard,
      updateCard,
      deleteCard,
      importCards,
      exportText,
    }),
    [data, canPersist, addCard, updateCard, deleteCard, importCards, exportText],
  );

  if (fatal) {
    return <StorageErrorScreen error={fatal.error} message={fatal.message} raw={fatal.raw} />;
  }

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}
