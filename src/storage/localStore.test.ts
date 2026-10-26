import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyAppData } from '../domain/appData';
import { MemoryStorage } from '../test/memoryStorage';
import legacyExport from './__fixtures__/legacy-v1-export.json';
import { LEGACY_STORAGE_KEY, loadAppData, saveAppData, STORAGE_KEY } from './localStore';

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

  it('migrates legacy cards into the v2 key and leaves the legacy key untouched', () => {
    setup({ [LEGACY_STORAGE_KEY]: LEGACY_RAW });

    const result = loadAppData({ storage, now: NOW });

    expect(result.ok && result.source).toBe('migrated-v1');
    expect(result.ok && result.persisted).toBe(true);
    expect(result.ok && result.data.cards).toHaveLength(5);
    expect(result.ok && result.migration?.cardsMigrated).toBe(5);
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(LEGACY_RAW);
    expect(storage.writes).toEqual([{ method: 'setItem', key: STORAGE_KEY }]);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(result.ok && result.data);
  });

  it('never reads or migrates the legacy key when migrateLegacy is false', () => {
    setup({ [LEGACY_STORAGE_KEY]: LEGACY_RAW });
    const getItem = vi.spyOn(storage, 'getItem');

    const result = loadAppData({ storage, now: NOW, migrateLegacy: false });

    expect(result).toEqual({
      ok: true,
      data: createEmptyAppData(NOW),
      source: 'new',
      persisted: false,
    });
    expect(getItem).not.toHaveBeenCalledWith(LEGACY_STORAGE_KEY);
    expect(storage.writes).toEqual([]);
    vi.restoreAllMocks();
  });

  it('migrates only once, then reads the v2 key', () => {
    setup({ [LEGACY_STORAGE_KEY]: LEGACY_RAW });
    const first = loadAppData({ storage, now: NOW });

    const second = loadAppData({ storage, now: NOW + 1000 });

    expect(second).toEqual({
      ok: true,
      data: first.ok && first.data,
      source: 'stored',
      persisted: true,
    });
    expect(storage.writes).toHaveLength(1);
  });

  it('treats unreadable legacy JSON as no cards and reports it', () => {
    setup({ [LEGACY_STORAGE_KEY]: '{not json' });

    const result = loadAppData({ storage, now: NOW });

    expect(result.ok && result.data.cards).toEqual([]);
    expect(result.ok && result.migration?.issues.map((i) => i.kind)).toEqual(['unreadable-json']);
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe('{not json');
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

  it('still returns migrated data when it cannot be saved', () => {
    setup({ [LEGACY_STORAGE_KEY]: LEGACY_RAW });
    storage.failWrites = new DOMException('Full', 'QuotaExceededError');

    const result = loadAppData({ storage, now: NOW });

    expect(result).toMatchObject({ ok: true, source: 'migrated-v1', persisted: false });
    expect(result.ok && result.data.cards).toHaveLength(5);
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(LEGACY_RAW);
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

  it('reports a full storage quota', () => {
    setup();
    storage.failWrites = new DOMException('Full', 'QuotaExceededError');

    expect(saveAppData(data, { storage })).toMatchObject({ ok: false, error: 'quota-exceeded' });
  });

  it('reports other write failures and missing storage', () => {
    setup();
    storage.failWrites = new Error('disk error');

    expect(saveAppData(data, { storage })).toMatchObject({ ok: false, error: 'write-failed' });
    expect(saveAppData(data, { storage: null })).toMatchObject({ ok: false, error: 'unavailable' });
  });
});
