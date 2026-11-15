import { beforeEach, describe, expect, it } from 'vitest';
import { parsePullPage } from '../cloud/syncProtocol';
import { buildAnalyticsBase, periodRange, totalsFor } from '../domain/analytics';
import type { StudySession } from '../domain/studySessions';
import { emptyAnalytics } from '../storage/analyticsStore';
import { emptyProgress } from '../storage/progressStore';
import { loadSyncState, SYNC_STORAGE_KEY } from '../storage/syncStore';
import { FakeSyncServer } from '../test/fakeSyncServer';
import { MemoryStorage } from '../test/memoryStorage';
import { TestDevice } from '../test/syncDevice';
import { pendingChanges } from './changes';
import { isLocalEmpty } from './link';
import { mergeRecord } from './merge';
import { canonical, cleanRecord, recordsFromSnapshot, snapshotFromRecords } from './records';
import { createSyncState } from './state';

let server: FakeSyncServer;

beforeEach(() => {
  server = new FakeSyncServer();
});

function session(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: 'session-1',
    mode: 'quiz',
    deckId: null,
    day: '2023-11-14',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_060_000,
    durationMs: 60_000,
    answered: 2,
    correct: 1,
    responseMs: 4_000,
    timedAnswers: 2,
    results: [{ cardId: 'c1', correct: 1, incorrect: 1 }],
    ...overrides,
  };
}

/** Every answer the analytics would count on a device, all time. */
function answersOn(device: TestDevice): number {
  const base = buildAnalyticsBase({
    data: device.snapshot.data,
    records: new Map(device.snapshot.progress.records.map((r) => [r.cardId, r])),
    history: device.snapshot.progress.history,
    sessions: device.sessions,
    goals: device.snapshot.analytics?.goals ?? [],
  });
  return totalsFor(base, periodRange('all', device.clock, base.earliest)).answered;
}

describe('merging sessions and goals', () => {
  it('keeps the copy of a session that got further, whichever side it is on', () => {
    const short = session();
    const long = session({ answered: 3, correct: 2, endedAt: short.endedAt + 1 });
    expect(mergeRecord('session', short, long, short, 'session-1').value).toEqual(long);
    expect(mergeRecord('session', short, short, long, 'session-1').value).toEqual(long);
    expect(mergeRecord('session', null, long, short, 'session-1').conflict).toBeNull();
  });

  it('keeps the later goal target and both histories', () => {
    const base = {
      id: 'cards-per-day' as const,
      target: 10,
      updatedAt: 1,
      changes: [{ at: 1, target: 10 }],
    };
    const local = {
      ...base,
      target: 15,
      updatedAt: 5,
      changes: [...base.changes, { at: 5, target: 15 }],
    };
    const remote = {
      ...base,
      target: 30,
      updatedAt: 9,
      changes: [...base.changes, { at: 9, target: 30 }],
    };
    const merged = mergeRecord('goal', base, local, remote, 'cards-per-day').value;
    expect(merged).toMatchObject({ target: 30, updatedAt: 9 });
    expect(merged?.changes).toHaveLength(3);
  });

  it('stores only the fields the app defines', () => {
    const stray = {
      ...session(),
      extra: 'x',
      results: [{ cardId: 'c1', correct: 1, incorrect: 0, note: 'x' }],
    };
    const cleaned = cleanRecord('session', stray as StudySession);
    expect(cleaned).not.toHaveProperty('extra');
    expect(cleaned.results[0]).not.toHaveProperty('note');
    expect(canonical('session', cleaned)).toBe(canonical('session', stray as StudySession));
  });

  it('carries the study log through the record sets and back, compacted', () => {
    const snapshot = {
      data: { schemaVersion: 2 as const, decks: [], cards: [] },
      progress: emptyProgress(),
      analytics: {
        ...emptyAnalytics(),
        sessions: [session({ id: 'b', startedAt: 2e12, endedAt: 2e12 }), session({ id: 'a' })],
        goals: [
          {
            id: 'days-per-week' as const,
            target: 3,
            updatedAt: 1,
            changes: [{ at: 1, target: 3 }],
          },
        ],
      },
    };
    const sets = recordsFromSnapshot(snapshot);
    expect(sets.session.size).toBe(2);
    expect(sets.goal.size).toBe(1);
    const back = snapshotFromRecords(sets, snapshot);
    expect(back.analytics?.sessions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(back.analytics?.goals).toEqual(snapshot.analytics.goals);
    // A snapshot without a study log has none.
    expect(
      recordsFromSnapshot({ data: snapshot.data, progress: emptyProgress() }).session.size,
    ).toBe(0);
  });

  it('counts a device with study history as not empty', () => {
    const empty = new TestDevice('e');
    expect(isLocalEmpty(empty.snapshot)).toBe(true);
    empty.setGoal('cards-per-day', 10);
    expect(isLocalEmpty(empty.snapshot)).toBe(true);
    empty.answer('gone', true);
    expect(isLocalEmpty(empty.snapshot)).toBe(false);
  });
});

describe('syncing the study log between devices', () => {
  it('uploads sessions and goals, and a second device downloads them exactly once', async () => {
    const a = new TestDevice('a');
    const card = a.addCard('hola', 'hello');
    a.answer(card.id, true);
    a.answer(card.id, false);
    a.setGoal('cards-per-day', 20);
    await a.link(server.transport());
    await a.sync(server.transport());
    expect(server.live('session')).toHaveLength(1);
    expect(server.live('goal')).toHaveLength(1);

    const b = new TestDevice('b');
    await b.link(server.transport(), 'use-account');
    await b.sync(server.transport());
    expect(b.sessions).toEqual(a.sessions);
    expect(b.snapshot.analytics?.goals).toEqual(a.snapshot.analytics?.goals);
    expect(answersOn(b)).toBe(2);

    // Syncing again, on both, changes nothing and counts nothing twice.
    expect((await a.sync(server.transport())).uploaded).toBe(0);
    expect((await b.sync(server.transport())).uploaded).toBe(0);
    expect(answersOn(a)).toBe(2);
    expect(answersOn(b)).toBe(2);
  });

  it('adds up study done offline on two devices, never doubling it', async () => {
    const a = new TestDevice('a');
    const card = a.addCard('uno', 'one');
    await a.link(server.transport());
    await a.sync(server.transport());
    const b = new TestDevice('b');
    await b.link(server.transport(), 'use-account');
    await b.sync(server.transport());

    // Both offline: three answers here, two there.
    a.answer(card.id, true);
    a.answer(card.id, true);
    a.answer(card.id, false);
    b.tick(3_600_000);
    b.answer(card.id, false, 'learn');
    b.answer(card.id, true, 'learn');

    await a.sync(server.transport());
    await b.sync(server.transport());
    await a.sync(server.transport());
    expect(answersOn(a)).toBe(5);
    expect(answersOn(b)).toBe(5);
    expect(a.sessions.map((s) => s.id).sort()).toEqual(b.sessions.map((s) => s.id).sort());
    expect(server.live('session')).toHaveLength(2);
  });

  it('carries on a session that grew after it was first uploaded', async () => {
    const a = new TestDevice('a');
    const card = a.addCard('dos', 'two');
    a.answer(card.id, true);
    await a.link(server.transport());
    await a.sync(server.transport());
    const b = new TestDevice('b');
    await b.link(server.transport(), 'use-account');

    a.answer(card.id, false);
    await a.sync(server.transport());
    await b.sync(server.transport());
    expect(b.sessions).toHaveLength(1);
    expect(b.sessions[0]?.answered).toBe(2);
  });

  it('never duplicates a session whose upload reply was lost', async () => {
    const a = new TestDevice('a');
    a.answer('c1', true);
    await a.link(server.transport());
    server.loseReplies = 1;
    await expect(a.sync(server.transport())).rejects.toThrow();
    await a.sync(server.transport());
    expect(server.live('session')).toHaveLength(1);
    expect((await a.sync(server.transport())).pending).toBe(0);
  });

  it('settles a goal changed on two devices on the later change', async () => {
    const a = new TestDevice('a');
    await a.link(server.transport());
    await a.sync(server.transport());
    const b = new TestDevice('b', undefined, a.clock);
    await b.link(server.transport(), 'use-account');

    a.setGoal('days-per-week', 4);
    b.tick(10 * 60_000);
    b.setGoal('days-per-week', 6);
    await a.sync(server.transport());
    await b.sync(server.transport());
    await a.sync(server.transport());
    const goalA = a.snapshot.analytics?.goals[0];
    expect(goalA).toEqual(b.snapshot.analytics?.goals[0]);
    expect(goalA?.target).toBe(6);
    expect(goalA?.changes.map((c) => c.target)).toEqual([4, 6]);
  });

  it('keeps sessions when the cards they mention are deleted', async () => {
    const a = new TestDevice('a');
    const card = a.addCard('tres', 'three');
    a.answer(card.id, true);
    await a.link(server.transport());
    await a.sync(server.transport());
    a.deleteCard(card.id);
    await a.sync(server.transport());
    expect(server.live('card')).toHaveLength(0);
    expect(server.live('session')).toHaveLength(1);
    expect(answersOn(a)).toBe(1);
  });
});

describe('linking a browser with study history to an account', () => {
  it('joins sessions by ID and moves their results onto the account’s copy of a card', async () => {
    const a = new TestDevice('a');
    a.addCard('gato', 'cat', 'default', 'account-card');
    a.answer('account-card', true);
    await a.link(server.transport());
    await a.sync(server.transport());

    // The same card, written separately in another browser under another ID.
    const b = new TestDevice('b');
    b.addCard('gato', 'cat', 'default', 'local-card');
    b.answer('local-card', false);
    await b.link(server.transport(), 'merge');
    await b.sync(server.transport());

    expect(b.cards.map((c) => c.id)).toEqual(['account-card']);
    expect(b.sessions).toHaveLength(2);
    expect(b.sessions.flatMap((s) => s.results.map((r) => r.cardId))).toEqual([
      'account-card',
      'account-card',
    ]);
    expect(answersOn(b)).toBe(2);

    // Linking the same browser again recognises everything.
    await b.link(server.transport(), 'merge');
    expect(b.sessions).toHaveLength(2);
  });

  it('keeps each account’s study history to itself', async () => {
    const accountOne = new FakeSyncServer();
    const accountTwo = new FakeSyncServer();
    const device = new TestDevice('shared');
    device.answer('c1', true);
    await device.link(accountOne.transport(), 'merge', 'user-1');
    await device.sync(accountOne.transport());

    const other = new TestDevice('other');
    other.answer('c9', false);
    other.setGoal('minutes-per-day', 30);
    await other.link(accountTwo.transport(), 'merge', 'user-2');
    await other.sync(accountTwo.transport());

    // Someone else signs in on the shared browser and uses their account's data.
    await device.link(accountTwo.transport(), 'use-account', 'user-2');
    await device.sync(accountTwo.transport());
    expect(device.sessions).toEqual(other.sessions);
    expect(device.snapshot.analytics?.goals.map((g) => g.id)).toEqual(['minutes-per-day']);
    expect(accountTwo.live('session').map((s) => s.results[0]?.cardId)).toEqual(['c9']);
    expect(accountOne.live('session').map((s) => s.results[0]?.cardId)).toEqual(['c1']);
  });
});

describe('a device that synced before sessions existed', () => {
  it('reads the account again from the start, once, and applies nothing twice', async () => {
    const a = new TestDevice('a');
    const card = a.addCard('cuatro', 'four');
    a.review(card.id, 'good');
    a.answer(card.id, true);
    await a.link(server.transport());
    await a.sync(server.transport());

    // An older build saved this sync state: no session or goal entries, and a
    // cursor past the sessions it was never sent.
    const b = new TestDevice('b');
    await b.link(server.transport(), 'use-account');
    const state = b.state!;
    const old = {
      ...state,
      base: {
        deck: state.base.deck,
        card: state.base.card,
        progress: state.base.progress,
        history: state.base.history,
      },
    };
    const storage = new MemoryStorage({ [SYNC_STORAGE_KEY]: JSON.stringify(old) });
    const loaded = loadSyncState(storage);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok || !loaded.state) return;
    expect(loaded.state.cursor).toBe(0);
    expect(loaded.state.base.session).toEqual({});
    expect(loaded.state.base.deck).toEqual(state.base.deck);

    // Without its study log, as the older build left it.
    b.state = loaded.state;
    b.snapshot = { ...b.snapshot, analytics: emptyAnalytics() };
    const result = await b.sync(server.transport());
    expect(result.uploaded).toBe(0);
    expect(b.sessions).toEqual(a.sessions);
    expect(b.cards).toEqual(a.cards);
    expect(b.snapshot.progress).toEqual(a.snapshot.progress);
  });

  it('leaves a current sync state as it is', () => {
    const state = { ...createSyncState('u', null, 1), cursor: 42 };
    const loaded = loadSyncState(new MemoryStorage({ [SYNC_STORAGE_KEY]: JSON.stringify(state) }));
    expect(loaded).toEqual({ ok: true, state });
  });
});

describe('the wire format', () => {
  it('reads sessions and goals from the server, and refuses an invalid one', () => {
    const page = parsePullPage({
      changes: [
        { kind: 'session', id: 'session-1', revision: 3, deleted: false, data: session() },
        { kind: 'goal', id: 'cards-per-day', revision: 4, deleted: true, data: null },
      ],
      cursor: 4,
      hasMore: false,
    });
    expect(page.changes.map((c) => c.kind)).toEqual(['session', 'goal']);
    expect(() =>
      parsePullPage({
        changes: [
          {
            kind: 'session',
            id: 'x',
            revision: 5,
            deleted: false,
            data: { ...session(), correct: 9 },
          },
        ],
        cursor: 5,
        hasMore: false,
      }),
    ).toThrow(/invalid session/);
  });

  it('uploads study log changes after cards and their progress', () => {
    const a = new TestDevice('a');
    const card = a.addCard('cinco', 'five');
    a.review(card.id, 'good');
    a.answer(card.id, true);
    a.setGoal('cards-per-day', 5);
    const kinds = pendingChanges(
      recordsFromSnapshot(a.snapshot),
      createSyncState('u', null, 1).base,
    ).map((c) => c.kind);
    expect(kinds.slice(0, 3)).toEqual(['deck', 'card', 'progress']);
    expect(kinds.slice(3).sort()).toEqual(['goal', 'history', 'session']);
  });
});
