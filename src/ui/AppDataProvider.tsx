import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createDefaultDeck, createEmptyAppData, DEFAULT_DECK_ID } from '../domain/appData';
import * as deckOps from '../domain/deckOps';
import { createId } from '../domain/ids';
import type { AppData, Card } from '../domain/types';
import {
  mergeImportedData,
  parseImportFile,
  serializeExport,
  withoutKnownCards,
  type ImportErrorCode,
} from '../storage/importExport';
import {
  LEGACY_STORAGE_KEY,
  loadAppData,
  resolveStorage,
  saveAppData,
  STORAGE_KEY,
  type SaveError,
} from '../storage/localStore';
import {
  createMigrationRecord,
  dismissMigrationRecord,
  loadMigrationRecord,
  saveMigrationRecord,
  type MigrationRecord,
} from '../storage/migrationRecord';
import {
  AppDataContext,
  type AppDataValue,
  type CardInput,
  type ImportOutcome,
  type WriteResult,
} from './appData';
import LegacyRecoveryScreen from './LegacyRecoveryScreen';
import StorageErrorScreen from './StorageErrorScreen';

interface AppDataProviderProps {
  /** Defaults to the browser's localStorage. Tests pass an in-memory fake. */
  storage?: Storage | null;
  children: ReactNode;
}

/** The original app's key is read here and nowhere else in the UI; it is never written. */
function readLegacyRaw(storage: Storage | null): string | null {
  try {
    return storage?.getItem(LEGACY_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Whether the original app's stored value holds at least one entry. */
function hasLegacyEntries(raw: string | null): boolean {
  if (raw === null) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

/** Whether v2 data has appeared in storage, for example written by another tab. */
function hasStoredData(storage: Storage | null): boolean {
  try {
    return storage !== null && storage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

const CHANGED_ELSEWHERE =
  'Your cards were saved from another tab or window. Reload this page to continue.';

function unsavedMigrationWarning(count: number, error: SaveError | undefined): string {
  const cards = `${count} ${count === 1 ? 'card' : 'cards'}`;
  const reason =
    error?.error === 'quota-exceeded' ? 'browser storage is full' : 'the browser refused to save';
  return `Your ${cards} from the previous version of Snap Notes were loaded, but could not be saved in the new format because ${reason}. They are still safe in their original place, and the app will try again next time you open it. Until then, new changes may not save either.`;
}

/** The import messages talk about "the file"; here the source is the original app's storage. */
function describeLegacyImportError(error: ImportErrorCode): string {
  switch (error) {
    case 'empty':
      return 'The original app has no cards saved in this browser.';
    case 'invalid-data':
      return 'None of the entries saved by the original app could be read as cards.';
    default:
      return 'The data saved by the original app could not be read.';
  }
}

/**
 * Loads app data once and owns it afterwards. Every write is validated and
 * saved before it reaches React state, so what the user sees is what is
 * stored. On the first visit after the cutover, the storage layer migrates the
 * original app's cards; this provider surfaces the outcome and, when the
 * original data cannot be read, hands the decision to the user.
 */
export default function AppDataProvider({ storage, children }: AppDataProviderProps) {
  // Resolved once, so every read and write here talks to the same storage.
  const [resolved] = useState(() => resolveStorage(storage));
  const [loaded, setLoaded] = useState(() => loadAppData({ storage: resolved }));
  const [data, setData] = useState<AppData>(() =>
    loaded.ok ? loaded.data : createEmptyAppData(Date.now()),
  );
  // The latest data, updated the moment a write lands. Every operation reads
  // it at call time, so a change saved between renders (by sync, for
  // example) is built upon rather than overwritten by an older copy.
  const dataRef = useRef(data);
  const replaceState = useCallback((next: AppData) => {
    dataRef.current = next;
    setData(next);
  }, []);
  // Read back from storage rather than taken from `loaded`, so the notice
  // survives a refresh and React's development-mode double call of initializers.
  // When the record could not be written, or the migrated cards are not saved
  // yet, the report from this load is shown instead, so it is never lost.
  const [migrationRecord, setMigrationRecord] = useState<MigrationRecord | null>(() => {
    const record = loadMigrationRecord(resolved);
    if (record) return record.dismissed ? null : record;
    return loaded.ok && loaded.source === 'migrated-v1' && loaded.migration
      ? createMigrationRecord(loaded.migration, Date.now())
      : null;
  });
  const [legacyDataAvailable, setLegacyDataAvailable] = useState(() =>
    hasLegacyEntries(readLegacyRaw(resolved)),
  );

  // The original app may be used in another tab while this one stays open.
  useEffect(() => {
    const refresh = () => setLegacyDataAvailable(hasLegacyEntries(readLegacyRaw(resolved)));
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [resolved]);

  // Data in storage is unreadable: run nothing that could overwrite it.
  const fatal = !loaded.ok && loaded.error !== 'unavailable' ? loaded : null;
  const canPersist = loaded.ok;
  // Migrated cards that exist only in memory. The first write that succeeds saves them too.
  const unsavedMigration =
    loaded.ok && loaded.source === 'migrated-v1' && !loaded.persisted ? loaded : null;

  const commit = useCallback(
    (next: AppData): WriteResult => {
      if (canPersist) {
        // This tab's cards were never saved. If another tab has saved cards
        // since, those must not be replaced by this tab's copy.
        if (unsavedMigration && hasStoredData(resolved)) {
          return { ok: false, message: CHANGED_ELSEWHERE };
        }
        const saved = saveAppData(next, { storage: resolved });
        if (!saved.ok) return { ok: false, message: saved.message };
        if (unsavedMigration?.migration) {
          // The migrated cards have now landed along with this change.
          saveMigrationRecord(resolved, {
            ...createMigrationRecord(unsavedMigration.migration, Date.now()),
            dismissed: migrationRecord === null,
          });
          setLoaded({ ok: true, data: next, source: 'stored', persisted: true });
        }
      }
      replaceState(next);
      return { ok: true };
    },
    [canPersist, migrationRecord, replaceState, resolved, unsavedMigration],
  );

  // Another tab saved cards: show them here too, so this tab never writes an
  // older copy over them.
  useEffect(() => {
    if (!canPersist || unsavedMigration) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || event.storageArea !== resolved) return;
      const reloaded = loadAppData({ storage: resolved });
      if (reloaded.ok && reloaded.source === 'stored') replaceState(reloaded.data);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [canPersist, replaceState, resolved, unsavedMigration]);

  const getData = useCallback(() => dataRef.current, []);

  const addCard = useCallback(
    (input: CardInput): WriteResult => {
      const data = dataRef.current;
      const now = Date.now();
      let decks = data.decks;
      let deck =
        input.deckId === undefined
          ? (decks.find((d) => d.id === DEFAULT_DECK_ID) ?? decks[0])
          : decks.find((d) => d.id === input.deckId);
      if (!deck && input.deckId !== undefined) {
        return { ok: false, message: 'That deck no longer exists.' };
      }
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
    [commit],
  );

  const updateCard = useCallback(
    (id: string, input: CardInput): WriteResult => {
      const data = dataRef.current;
      const existing = data.cards.find((card) => card.id === id);
      if (!existing) return { ok: false, message: 'This card no longer exists.' };
      const deckId = input.deckId ?? existing.deckId;
      if (!data.decks.some((deck) => deck.id === deckId)) {
        return { ok: false, message: 'That deck no longer exists.' };
      }
      if (
        existing.term === input.term &&
        existing.definition === input.definition &&
        existing.deckId === deckId
      ) {
        return { ok: true };
      }
      const updatedAt = Math.max(Date.now(), existing.createdAt);
      const cards = data.cards.map((card) =>
        card.id === id
          ? { ...card, term: input.term, definition: input.definition, deckId, updatedAt }
          : card,
      );
      return commit({ ...data, cards });
    },
    [commit],
  );

  const deleteCard = useCallback(
    (id: string): WriteResult => {
      const data = dataRef.current;
      const cards = data.cards.filter((card) => card.id !== id);
      if (cards.length === data.cards.length) {
        return { ok: false, message: 'This card no longer exists.' };
      }
      return commit({ ...data, cards });
    },
    [commit],
  );

  // Deck operations are pure functions over the whole collection; a refusal is
  // already shaped like a failed write, so it passes straight through.
  const applyDeckOp = useCallback(
    (result: deckOps.DeckOpResult): WriteResult => (result.ok ? commit(result.data) : result),
    [commit],
  );

  const createDeck = useCallback(
    (name: string): WriteResult => applyDeckOp(deckOps.createDeck(dataRef.current, name)),
    [applyDeckOp],
  );

  const renameDeck = useCallback(
    (deckId: string, name: string): WriteResult =>
      applyDeckOp(deckOps.renameDeck(dataRef.current, deckId, name)),
    [applyDeckOp],
  );

  const deleteDeck = useCallback(
    (deckId: string, moveCardsTo: string): WriteResult =>
      applyDeckOp(deckOps.deleteDeck(dataRef.current, deckId, moveCardsTo)),
    [applyDeckOp],
  );

  const moveCards = useCallback(
    (cardIds: readonly string[], toDeckId: string): WriteResult =>
      applyDeckOp(deckOps.moveCards(dataRef.current, cardIds, toDeckId)),
    [applyDeckOp],
  );

  const importCards = useCallback(
    (text: string): ImportOutcome => {
      const data = dataRef.current;
      const parsed = parseImportFile(text);
      if (!parsed.ok) return { ok: false, message: parsed.message };
      // A file from the original app has no stable IDs, so it is matched by content first.
      const incoming =
        parsed.format === 'v1-array'
          ? withoutKnownCards(data, parsed.data)
          : { data: parsed.data, skipped: 0 };
      const merged = mergeImportedData(data, incoming.data);
      const committed = commit(merged.data);
      if (!committed.ok) return committed;
      merged.report.duplicatesSkipped += incoming.skipped;
      return { ok: true, report: merged.report };
    },
    [commit],
  );

  const legacyRawData = useCallback(() => readLegacyRaw(resolved), [resolved]);

  const importFromLegacy = useCallback((): ImportOutcome => {
    const data = dataRef.current;
    const raw = readLegacyRaw(resolved);
    if (raw === null) {
      return { ok: false, message: 'No data from the original app was found in this browser.' };
    }
    const parsed = parseImportFile(raw);
    if (!parsed.ok) return { ok: false, message: describeLegacyImportError(parsed.error) };
    // Only cards this collection has never seen come in: a card already here
    // under the same ID, even if edited since, is the one to keep.
    const incoming = withoutKnownCards(data, parsed.data, { matchIds: true });
    const merged = mergeImportedData(data, incoming.data);
    const committed = commit(merged.data);
    if (!committed.ok) return committed;
    merged.report.duplicatesSkipped += incoming.skipped;
    return { ok: true, report: merged.report };
  }, [commit, resolved]);

  const exportText = useCallback(() => serializeExport(data), [data]);

  const dismissMigrationNotice = useCallback(() => {
    dismissMigrationRecord(resolved);
    setMigrationRecord(null);
  }, [resolved]);

  // Recovery from the screen shown when the original app's data is unreadable.
  // Each path writes v2 data explicitly, then reloads from storage so the app
  // starts exactly as it will on the next visit.
  const recoverWith = useCallback(
    (next: AppData): WriteResult => {
      // Cards saved since this screen appeared (from another tab) always win:
      // they are loaded as they are, and nothing is written over them.
      if (!hasStoredData(resolved)) {
        const saved = saveAppData(next, { storage: resolved });
        if (!saved.ok) return { ok: false, message: saved.message };
      }
      const reloaded = loadAppData({ storage: resolved });
      if (!reloaded.ok) return { ok: false, message: reloaded.message };
      replaceState(reloaded.data);
      setLoaded(reloaded);
      return { ok: true };
    },
    [replaceState, resolved],
  );

  const restoreFromFile = useCallback(
    (text: string): ImportOutcome => {
      const parsed = parseImportFile(text);
      if (!parsed.ok) return { ok: false, message: parsed.message };
      const merged = mergeImportedData(createEmptyAppData(Date.now()), parsed.data);
      const result = recoverWith(merged.data);
      return result.ok ? { ok: true, report: merged.report } : result;
    },
    [recoverWith],
  );

  const startEmpty = useCallback(() => recoverWith(createEmptyAppData(Date.now())), [recoverWith]);

  let persistenceWarning: string | null = null;
  if (!canPersist) {
    persistenceWarning =
      'Browser storage is unavailable, so changes will be lost when you close this page.';
  } else if (unsavedMigration) {
    persistenceWarning = unsavedMigrationWarning(
      unsavedMigration.data.cards.length,
      unsavedMigration.saveError,
    );
  }

  const value = useMemo<AppDataValue>(
    () => ({
      data,
      persistenceWarning,
      migrationRecord,
      dismissMigrationNotice,
      legacyDataAvailable,
      legacyRawData,
      importFromLegacy,
      addCard,
      updateCard,
      deleteCard,
      createDeck,
      renameDeck,
      deleteDeck,
      moveCards,
      importCards,
      exportText,
      getData,
      replaceData: commit,
    }),
    [
      data,
      persistenceWarning,
      migrationRecord,
      dismissMigrationNotice,
      legacyDataAvailable,
      legacyRawData,
      importFromLegacy,
      addCard,
      updateCard,
      deleteCard,
      createDeck,
      renameDeck,
      deleteDeck,
      moveCards,
      importCards,
      exportText,
      getData,
      commit,
    ],
  );

  if (fatal) {
    if (fatal.error === 'legacy-unreadable') {
      return (
        <LegacyRecoveryScreen
          problem={fatal.problem}
          message={fatal.message}
          raw={fatal.raw}
          onRestoreFile={restoreFromFile}
          onStartEmpty={startEmpty}
        />
      );
    }
    return <StorageErrorScreen error={fatal.error} message={fatal.message} raw={fatal.raw} />;
  }

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}
