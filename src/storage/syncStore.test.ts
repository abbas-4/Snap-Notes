import { describe, expect, it } from 'vitest';
import { createSyncState } from '../sync/state';
import { MemoryStorage } from '../test/memoryStorage';
import { clearSyncState, loadSyncState, saveSyncState, SYNC_STORAGE_KEY } from './syncStore';

describe('sync state storage', () => {
  it('is kept under its own namespaced key', () => {
    expect(SYNC_STORAGE_KEY).toBe('snapnotes.sync.v1');
  });

  it('round-trips, base and conflicts included', () => {
    const storage = new MemoryStorage();
    const state = createSyncState('user-1', 'me@example.test', 1_000);
    state.base.card.c1 = {
      revision: 3,
      data: { id: 'c1', deckId: 'default', term: 'a', definition: 'b', createdAt: 1, updatedAt: 2 },
    };
    state.base.deck.gone = { revision: 4, data: null };
    state.conflicts.push({
      id: 'x',
      kind: 'card',
      recordId: 'c1',
      detectedAt: 5,
      reason: 'both-changed',
      kept: null,
      other: {
        id: 'c1',
        deckId: 'default',
        term: 'z',
        definition: 'b',
        createdAt: 1,
        updatedAt: 1,
      },
    });
    expect(saveSyncState(storage, state)).toBe(true);
    expect(loadSyncState(storage)).toEqual({ ok: true, state });
  });

  it('reports nothing saved as not linked', () => {
    expect(loadSyncState(new MemoryStorage())).toEqual({ ok: true, state: null });
  });

  it('treats damaged state as unreadable without throwing', () => {
    expect(loadSyncState(new MemoryStorage({ [SYNC_STORAGE_KEY]: '{oops' }))).toMatchObject({
      ok: false,
      error: 'corrupt',
    });
    expect(
      loadSyncState(new MemoryStorage({ [SYNC_STORAGE_KEY]: JSON.stringify({ version: 1 }) })),
    ).toMatchObject({ ok: false, error: 'corrupt' });
  });

  it('reports a refused write instead of claiming success', () => {
    const storage = new MemoryStorage();
    storage.failWrites = new DOMException('full', 'QuotaExceededError');
    expect(saveSyncState(storage, createSyncState('u', null, 1))).toBe(false);
    const dropping = new MemoryStorage();
    dropping.dropWrites = true;
    expect(saveSyncState(dropping, createSyncState('u', null, 1))).toBe(false);
  });

  it('forgets the link without touching cards or progress', () => {
    const storage = new MemoryStorage({
      [SYNC_STORAGE_KEY]: '{}',
      'snapnotes.data.v2': 'cards',
      'snapnotes.progress.v1': 'progress',
    });
    expect(clearSyncState(storage)).toBe(true);
    expect(storage.getItem(SYNC_STORAGE_KEY)).toBeNull();
    expect(storage.getItem('snapnotes.data.v2')).toBe('cards');
    expect(storage.getItem('snapnotes.progress.v1')).toBe('progress');
  });
});
