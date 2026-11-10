import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyAppData } from '../domain/appData';
import { MemoryStorage } from '../test/memoryStorage';
import legacyExport from './__fixtures__/legacy-v1-export.json';
import {
  getBrowserStorage,
  LEGACY_STORAGE_KEY,
  loadAppData,
  saveAppData,
  STORAGE_KEY,
} from './localStore';
import { loadMigrationRecord, MIGRATION_RECORD_KEY } from './migrationRecord';

const NOW = 1_800_000_000_000;
const LEGACY_RAW = JSON.stringify(legacyExport);

let storage: MemoryStorage;

function setup(initial: Record<string, string> = {}) {
  storage = new MemoryStorage(initial);
  return storage;
}

afterEach(() => {
  // Whatever a test did, the legacy key must never be written, removed, or cleared.
  expect(
    storage.writes.filter((w) => w.key === LEGACY_STORAGE_KEY || w.method !== 'setItem'),
  ).toEqual([]);
  vi.restoreAllMocks();
});

describe('loadAppData', () => {
  it('starts with empty data and writes nothing when storage is empty', () => {
    setup();

    const result = loadAppData({ storage, now: NOW });

    expect(result).toEqual({
      ok: true,
      data: createEmptyAppData(NOW),
      source: 'new',
      persisted: false,
    });
    expect(storage.writes).toEqual([]);
  });

  describe('migration from the original app', () => {
    it('migrates legacy cards into the v2 key, records it, and leaves the legacy key untouched', () => {
      setup({ [LEGACY_STORAGE_KEY]: LEGACY_RAW });

      const result = loadAppData({ storage, now: NOW });

      expect(result).toMatchObject({ ok: true, source: 'migrated-v1', persisted: true });
      expect(result.ok && result.data.cards.map((c) => c.term)).toEqual(
        legacyExport.map((c) => c.term),
      );
      expect(result.ok && result.data.cards.map((c) => c.definition)).toEqual(
        legacyExport.map((c) => c.definition),
      );
      expect(result.ok && result.data.cards.every((c) => c.deckId === 'default')).toBe(true);
      expect(result.ok && result.migration).toMatchObject({ recordsFound: 5, cardsMigrated: 5 });
      expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(LEGACY_RAW);
      expect(storage.writes).toEqual([
        { method: 'setItem', key: STORAGE_KEY },
        { method: 'setItem', key: MIGRATION_RECORD_KEY },
      ]);
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(result.ok && result.data);
      expect(loadMigrationRecord(storage)).toMatchObject({
        version: 1,
        migratedAt: NOW,
        recordsFound: 5,
        cardsMigrated: 5,
        dismissed: false,
      });
    });

    it('migrates only once, then reads the v2 key without looking at the legacy key', () => {
      setup({ [LEGACY_STORAGE_KEY]: LEGACY_RAW });
      const first = loadAppData({ storage, now: NOW });
      const getItem = vi.spyOn(storage, 'getItem');

      const second = loadAppData({ storage, now: NOW + 1000 });

      expect(second).toEqual({
        ok: true,
        data: first.ok && first.data,
        source: 'stored',
        persisted: true,
      });
      expect(getItem).not.toHaveBeenCalledWith(LEGACY_STORAGE_KEY);
      expect(storage.writes).toHaveLength(2);
    });

    it('lets existing v2 data win over legacy data, even an empty collection', () => {
      setup({
        [STORAGE_KEY]: JSON.stringify(createEmptyAppData(NOW)),
        [LEGACY_STORAGE_KEY]: LEGACY_RAW,
      });
      const getItem = vi.spyOn(storage, 'getItem');

      const result = loadAppData({ storage, now: NOW });

      expect(result).toEqual({
        ok: true,
        data: createEmptyAppData(NOW),
        source: 'stored',
        persisted: true,
      });
      expect(getItem).not.toHaveBeenCalledWith(LEGACY_STORAGE_KEY);
      expect(storage.writes).toEqual([]);
    });

    it('treats a legacy value of null or an empty list as no cards, and writes nothing', () => {
      for (const raw of ['[]', 'null']) {
        setup({ [LEGACY_STORAGE_KEY]: raw });

        expect(loadAppData({ storage, now: NOW })).toEqual({
          ok: true,
          data: createEmptyAppData(NOW),
          source: 'new',
          persisted: false,
        });
        expect(storage.writes).toEqual([]);
      }
    });

    it('refuses to migrate legacy data that is not valid JSON, and writes nothing', () => {
      setup({ [LEGACY_STORAGE_KEY]: '{not json' });

      const result = loadAppData({ storage, now: NOW });

      expect(result).toEqual({
        ok: false,
        error: 'legacy-unreadable',
        problem: 'invalid-json',
        message: 'The data saved by the original app is not valid JSON.',
        raw: '{not json',
      });
      expect(storage.writes).toEqual([]);
      expect(storage.getItem(STORAGE_KEY)).toBeNull();
      // Nothing changed, so the next visit asks again instead of starting empty.
      expect(loadAppData({ storage, now: NOW + 1 })).toMatchObject({
        ok: false,
        error: 'legacy-unreadable',
      });
    });

    it('refuses to migrate legacy data that is not a list of cards', () => {
      for (const raw of ['{"cards":[]}', '"text"', '42', 'true']) {
        setup({ [LEGACY_STORAGE_KEY]: raw });

        expect(loadAppData({ storage, now: NOW })).toMatchObject({
          ok: false,
          error: 'legacy-unreadable',
          problem: 'not-an-array',
          raw,
        });
        expect(storage.writes).toEqual([]);
      }
    });

    it('refuses to migrate a list in which nothing can be read as a card', () => {
      const raw = JSON.stringify([null, { id: 'a' }, { term: '  ', definition: '\n' }]);
      setup({ [LEGACY_STORAGE_KEY]: raw });

      const result = loadAppData({ storage, now: NOW });

      expect(result).toMatchObject({
        ok: false,
        error: 'legacy-unreadable',
        problem: 'no-usable-cards',
        message: 'None of the 3 saved entries could be read as a card.',
        raw,
      });
      expect(!result.ok && result.error === 'legacy-unreadable' && result.migration).toMatchObject({
        recordsFound: 3,
        cardsMigrated: 0,
      });
      expect(storage.writes).toEqual([]);
    });

    it('migrates what it can from a damaged list and keeps the details in the record', () => {
      setup({
        [LEGACY_STORAGE_KEY]: JSON.stringify([
          { id: 'ok', term: 'Kept', definition: 'Yes', created: 1 },
          null,
          { id: 'n', term: 7, definition: 'Seven', created: 1 },
        ]),
      });

      const result = loadAppData({ storage, now: NOW });

      expect(result).toMatchObject({ ok: true, source: 'migrated-v1', persisted: true });
      expect(result.ok && result.data.cards.map((c) => [c.term, c.definition])).toEqual([
        ['Kept', 'Yes'],
        ['7', 'Seven'],
      ]);
      expect(loadMigrationRecord(storage)).toMatchObject({
        recordsFound: 3,
        cardsMigrated: 2,
        issuesTotal: 2,
        issues: [
          { kind: 'skipped-record', index: 1, reason: 'not-an-object' },
          { kind: 'converted-field', index: 2, field: 'term' },
        ],
      });
    });

    it('keeps migrated cards in memory, leaves storage clean, and retries next time when they cannot be saved', () => {
      setup({ [LEGACY_STORAGE_KEY]: LEGACY_RAW });
      storage.failWrites = new DOMException('Full', 'QuotaExceededError');

      const result = loadAppData({ storage, now: NOW });

      expect(result).toMatchObject({
        ok: true,
        source: 'migrated-v1',
        persisted: false,
        saveError: { error: 'quota-exceeded' },
      });
      expect(result.ok && result.data.cards).toHaveLength(5);
      expect(storage.getItem(STORAGE_KEY)).toBeNull();
      expect(storage.getItem(MIGRATION_RECORD_KEY)).toBeNull();
      expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(LEGACY_RAW);

      // Space was freed: the next load migrates again, from the untouched original.
      storage.failWrites = null;
      expect(loadAppData({ storage, now: NOW + 1 })).toMatchObject({
        ok: true,
        source: 'migrated-v1',
        persisted: true,
      });
      expect(loadMigrationRecord(storage)?.cardsMigrated).toBe(5);
    });

    it('notices a write that the browser accepted but dropped', () => {
      setup({ [LEGACY_STORAGE_KEY]: LEGACY_RAW });
      storage.dropWrites = true;

      const result = loadAppData({ storage, now: NOW });

      expect(result).toMatchObject({
        ok: true,
        source: 'migrated-v1',
        persisted: false,
        saveError: { error: 'write-failed' },
      });
      expect(storage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('keeps the migration when only the record cannot be written', () => {
      setup({ [LEGACY_STORAGE_KEY]: LEGACY_RAW });
      storage.failWritesFor = (key) => (key === MIGRATION_RECORD_KEY ? new Error('no room') : null);

      const result = loadAppData({ storage, now: NOW });

      expect(result).toMatchObject({ ok: true, source: 'migrated-v1', persisted: true });
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!).cards).toHaveLength(5);
      expect(loadMigrationRecord(storage)).toBeNull();
    });
  });

  it('refuses to load, and never overwrites, v2 data that is not valid JSON', () => {
    setup({ [STORAGE_KEY]: '{"schemaVersion": 2, "cards": [', [LEGACY_STORAGE_KEY]: LEGACY_RAW });

    const result = loadAppData({ storage, now: NOW });

    expect(result).toMatchObject({
      ok: false,
      error: 'corrupt',
      raw: '{"schemaVersion": 2, "cards": [',
    });
    expect(storage.writes).toEqual([]);
  });

  it('refuses to load v2 data with the wrong shape and says where the problem is', () => {
    const bad = { schemaVersion: 2, decks: [], cards: [{ id: 'a', term: 5 }] };
    setup({ [STORAGE_KEY]: JSON.stringify(bad) });

    const result = loadAppData({ storage, now: NOW });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe('corrupt');
    expect(!result.ok && result.message).toContain('cards.0.');
    expect(storage.writes).toEqual([]);
  });

  it('refuses to load data written by a newer version', () => {
    setup({ [STORAGE_KEY]: JSON.stringify({ schemaVersion: 3, decks: [], cards: [] }) });

    expect(loadAppData({ storage, now: NOW })).toMatchObject({ ok: false, error: 'newer-version' });
  });

  it('reports unavailable storage instead of throwing', () => {
    setup();
    storage.failReads = new DOMException('Access denied', 'SecurityError');

    expect(loadAppData({ storage, now: NOW })).toMatchObject({ ok: false, error: 'unavailable' });
    expect(loadAppData({ storage: null, now: NOW })).toMatchObject({
      ok: false,
      error: 'unavailable',
    });
  });
});

describe('getBrowserStorage', () => {
  it('treats a browser that refuses access to localStorage as having none', () => {
    setup();
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError');
    });

    expect(getBrowserStorage()).toBeNull();
    expect(loadAppData({ now: NOW })).toMatchObject({ ok: false, error: 'unavailable' });
  });
});

describe('saveAppData', () => {
  const data = {
    ...createEmptyAppData(NOW),
    cards: [
      {
        id: 'a',
        deckId: 'default',
        term: '<i>x</i>',
        definition: 'y',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  };

  it('saves data that loads back unchanged', () => {
    setup();

    expect(saveAppData(data, { storage })).toEqual({ ok: true });
    expect(loadAppData({ storage })).toEqual({ ok: true, data, source: 'stored', persisted: true });
  });

  it('refuses to save invalid data', () => {
    setup();
    const invalid = { ...data, cards: [...data.cards, { ...data.cards[0]! }] };

    const result = saveAppData(invalid, { storage });

    expect(result).toMatchObject({ ok: false, error: 'invalid-data' });
    expect(!result.ok && result.message).toContain('duplicate card id');
    expect(storage.writes).toEqual([]);
  });

  it('recognises a full storage quota however the browser reports it', () => {
    const errors = [
      new DOMException('Full', 'QuotaExceededError'),
      Object.assign(new Error('Full'), { name: 'NS_ERROR_DOM_QUOTA_REACHED' }),
      Object.assign(new Error('Full'), { code: 22 }),
      Object.assign(new Error('Full'), { code: 1014 }),
    ];
    for (const error of errors) {
      setup();
      storage.failWrites = error;

      expect(saveAppData(data, { storage })).toMatchObject({ ok: false, error: 'quota-exceeded' });
    }
  });

  it('reports other write failures and missing storage', () => {
    setup();
    storage.failWrites = new Error('disk error');

    expect(saveAppData(data, { storage })).toMatchObject({ ok: false, error: 'write-failed' });
    expect(saveAppData(data, { storage: null })).toMatchObject({ ok: false, error: 'unavailable' });
  });

  it('reports a write that did not land', () => {
    setup();
    storage.dropWrites = true;

    expect(saveAppData(data, { storage })).toMatchObject({ ok: false, error: 'write-failed' });
  });
});
