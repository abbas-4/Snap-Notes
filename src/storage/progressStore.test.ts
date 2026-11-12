import { describe, expect, it } from 'vitest';
import { START_EASE, dayKey, type CardProgress } from '../domain/srs';
import { MemoryStorage } from '../test/memoryStorage';
import { makeAppData, makeCard, makeDeck } from '../test/renderApp';
import {
  MAX_HISTORY_DAYS,
  PROGRESS_STORAGE_KEY,
  PROGRESS_VERSION,
  dedupeRecords,
  emptyProgress,
  loadProgress,
  normalizeHistory,
  recordActivity,
  recordsById,
  reconcileProgress,
  saveProgress,
  type ProgressData,
} from './progressStore';

const NOW = new Date(2025, 3, 20, 14, 0).getTime();

function record(cardId: string, overrides: Partial<CardProgress> = {}): CardProgress {
  return {
    cardId,
    deckId: 'default',
    reviews: 1,
    correct: 1,
    incorrect: 0,
    stage: 'review',
    intervalDays: 1,
    ease: START_EASE,
    lastReviewedAt: NOW,
    dueAt: NOW + 86_400_000,
    streak: 1,
    ...overrides,
  };
}

/** A saved progress file, including deliberately damaged entries. */
function file(data: Record<string, unknown>): MemoryStorage {
  return new MemoryStorage({
    [PROGRESS_STORAGE_KEY]: JSON.stringify({ version: PROGRESS_VERSION, ...data }),
  });
}

describe('saving and loading', () => {
  it('saves progress and reads back exactly what was saved', () => {
    const storage = new MemoryStorage();
    const data: ProgressData = {
      version: PROGRESS_VERSION,
      records: [record('card-1'), record('card-2', { reviews: 3, correct: 2, incorrect: 1 })],
      history: [{ day: '2025-04-20', reviews: 4, correct: 3 }],
    };

    expect(saveProgress(storage, data)).toEqual({ ok: true });
    const loaded = loadProgress(storage);
    expect(loaded.ok).toBe(true);
    expect(loaded.data).toEqual(data);
  });

  it('starts empty when nothing has been saved', () => {
    const loaded = loadProgress(new MemoryStorage());
    expect(loaded).toMatchObject({ ok: true, reset: false, dropped: 0 });
    expect(loaded.data).toEqual(emptyProgress());
  });

  it('survives a reload: a second load sees the same records', () => {
    const storage = new MemoryStorage();
    saveProgress(storage, { ...emptyProgress(), records: [record('card-1', { reviews: 7 })] });

    const first = loadProgress(storage);
    const second = loadProgress(storage);
    expect(second.data.records).toEqual(first.data.records);
    expect(second.data.records[0]?.reviews).toBe(7);
  });

  it('never touches the cards and decks', () => {
    const storage = new MemoryStorage({ 'snapnotes.data.v2': 'cards' });
    saveProgress(storage, emptyProgress());
    expect(storage.getItem('snapnotes.data.v2')).toBe('cards');
    expect(storage.writes.map((write) => write.key)).toEqual([PROGRESS_STORAGE_KEY]);
  });

  it('reports a refused write instead of pretending it saved', () => {
    const full = new MemoryStorage();
    full.failWrites = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    expect(saveProgress(full, emptyProgress())).toMatchObject({
      ok: false,
      error: 'quota-exceeded',
    });

    const dropping = new MemoryStorage();
    dropping.dropWrites = true;
    expect(saveProgress(dropping, emptyProgress())).toMatchObject({
      ok: false,
      error: 'write-failed',
    });
  });

  it('refuses to save progress that does not fit the format', () => {
    const storage = new MemoryStorage();
    const broken = {
      ...emptyProgress(),
      records: [{ ...record('card-1'), reviews: -1 }],
    };
    expect(saveProgress(storage, broken)).toMatchObject({ ok: false, error: 'invalid-data' });
    expect(storage.getItem(PROGRESS_STORAGE_KEY)).toBeNull();
  });

  it('works without storage at all, in memory', () => {
    const loaded = loadProgress(null);
    expect(loaded).toMatchObject({ ok: false, error: 'unavailable' });
    expect(loaded.data).toEqual(emptyProgress());
    expect(saveProgress(null, emptyProgress())).toMatchObject({ ok: false, error: 'unavailable' });
  });

  it('survives storage that throws when read', () => {
    const storage = new MemoryStorage();
    storage.failReads = new Error('blocked');
    expect(loadProgress(storage)).toMatchObject({ ok: false, error: 'unavailable' });
  });
});

describe('invalid saved data', () => {
  it('starts again when the saved value is not JSON', () => {
    const storage = new MemoryStorage({ [PROGRESS_STORAGE_KEY]: '{not json' });
    const loaded = loadProgress(storage);
    expect(loaded).toMatchObject({ ok: true, reset: true });
    expect(loaded.data.records).toEqual([]);
  });

  it('starts again when the saved value is not a progress file', () => {
    expect(loadProgress(new MemoryStorage({ [PROGRESS_STORAGE_KEY]: '[1,2,3]' }))).toMatchObject({
      ok: true,
      reset: true,
    });
  });

  it('keeps the good records and leaves out the damaged ones', () => {
    const storage = file({
      records: [record('card-1'), { cardId: 'card-2' }, null, record('card-3')],
      history: [{ day: '2025-04-20', reviews: 2, correct: 1 }, { day: 'yesterday' }],
    });
    const loaded = loadProgress(storage);
    expect(loaded.data.records.map((r) => r.cardId)).toEqual(['card-1', 'card-3']);
    expect(loaded.data.history).toHaveLength(1);
    expect(loaded).toMatchObject({ ok: true, reset: false, dropped: 3 });
  });

  it('refuses to read, or write over, progress from a newer version', () => {
    const storage = new MemoryStorage({
      [PROGRESS_STORAGE_KEY]: JSON.stringify({ version: PROGRESS_VERSION + 1, records: [] }),
    });
    const loaded = loadProgress(storage);
    expect(loaded).toMatchObject({ ok: false, error: 'newer-version' });
    expect(loaded.data.records).toEqual([]);
    // Nothing was written: the newer file is still there untouched.
    expect(storage.writes).toEqual([]);
  });

  it('keeps one record per card, the one that has seen more reviewing', () => {
    const { records, duplicates } = dedupeRecords([
      record('card-1', { reviews: 1 }),
      record('card-1', { reviews: 9, correct: 9 }),
      record('card-2'),
    ]);
    expect(records).toHaveLength(2);
    expect(records.find((r) => r.cardId === 'card-1')?.reviews).toBe(9);
    expect(duplicates).toBe(1);
  });

  it('merges duplicate days and keeps only the most recent ones', () => {
    const merged = normalizeHistory([
      { day: '2025-04-20', reviews: 2, correct: 1 },
      { day: '2025-04-19', reviews: 1, correct: 1 },
      { day: '2025-04-20', reviews: 3, correct: 3 },
    ]);
    expect(merged).toEqual([
      { day: '2025-04-19', reviews: 1, correct: 1 },
      { day: '2025-04-20', reviews: 5, correct: 4 },
    ]);

    const many = Array.from({ length: MAX_HISTORY_DAYS + 20 }, (_, index) => ({
      day: `2020-01-${String((index % 28) + 1).padStart(2, '0')}`,
      reviews: 1,
      correct: 1,
    }));
    expect(normalizeHistory(many).length).toBeLessThanOrEqual(MAX_HISTORY_DAYS);
  });
});

describe('keeping records in step with the cards', () => {
  const biology = makeDeck({ id: 'biology', name: 'Biology' });
  const data = makeAppData(
    [makeCard({ id: 'kept', deckId: 'default' }), makeCard({ id: 'moved', deckId: 'biology' })],
    [makeDeck({ id: 'default', name: 'My Cards' }), biology],
  );

  it('drops the record of a card that no longer exists', () => {
    const result = reconcileProgress([record('kept'), record('deleted')], data);
    expect(result.records.map((r) => r.cardId)).toEqual(['kept']);
    expect(result.changed).toBe(true);
  });

  it('follows a card that has moved to another deck', () => {
    const result = reconcileProgress([record('moved', { deckId: 'default' })], data);
    expect(result.records[0]).toMatchObject({ cardId: 'moved', deckId: 'biology' });
    expect(result.changed).toBe(true);
  });

  it('repairs a record pointing at a deck that was deleted', () => {
    const result = reconcileProgress([record('kept', { deckId: 'gone' })], data);
    expect(result.records[0]?.deckId).toBe('default');
  });

  it('changes nothing when everything already matches', () => {
    const records = [record('kept'), record('moved', { deckId: 'biology' })];
    const result = reconcileProgress(records, data);
    expect(result.changed).toBe(false);
    expect(result.records).toEqual(records);
  });

  it('removes duplicate records while it is there', () => {
    const result = reconcileProgress([record('kept'), record('kept', { reviews: 4 })], data);
    expect(result.records).toHaveLength(1);
    expect(result.changed).toBe(true);
  });

  it('keeps nothing when every card is gone', () => {
    const empty = makeAppData([]);
    expect(reconcileProgress([record('kept')], empty).records).toEqual([]);
  });
});

describe('the activity log', () => {
  it('counts an answer against the day it was given', () => {
    const history = recordActivity([], NOW, true);
    expect(history).toEqual([{ day: dayKey(NOW), reviews: 1, correct: 1 }]);

    const withMiss = recordActivity(history, NOW, false);
    expect(withMiss).toEqual([{ day: dayKey(NOW), reviews: 2, correct: 1 }]);
  });

  it('starts a new day without disturbing the old ones', () => {
    const yesterday = { day: '2025-04-19', reviews: 3, correct: 2 };
    const history = recordActivity([yesterday], NOW, true);
    expect(history).toEqual([yesterday, { day: dayKey(NOW), reviews: 1, correct: 1 }]);
  });

  it('looks records up by card', () => {
    const map = recordsById([record('card-1'), record('card-2')]);
    expect(map.get('card-1')?.cardId).toBe('card-1');
    expect(map.get('missing')).toBeUndefined();
  });
});
