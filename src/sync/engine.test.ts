import { beforeEach, describe, expect, it } from 'vitest';
import { FakeSyncServer } from '../test/fakeSyncServer';
import { TestDevice } from '../test/syncDevice';
import { SyncError } from './engine';

let server: FakeSyncServer;

beforeEach(() => {
  server = new FakeSyncServer();
});

/** Two devices of one user, both linked; A uploaded `cards` first and B downloaded them. */
async function twoDevices(cards: Array<[string, string]> = [['hola', 'hello']]) {
  const a = new TestDevice('a');
  for (const [term, definition] of cards) a.addCard(term, definition);
  await a.link(server.transport());
  await a.sync(server.transport());
  const b = new TestDevice('b');
  await b.link(server.transport(), 'use-account');
  await b.sync(server.transport());
  return { a, b };
}

describe('initial upload and download', () => {
  it('uploads every deck, card, progress record and review day from the first device', async () => {
    const a = new TestDevice('a');
    const card = a.addCard('hola', 'hello');
    a.review(card.id, 'good');
    await a.link(server.transport());
    const result = await a.sync(server.transport());

    expect(result.pending).toBe(0);
    expect(server.live('deck').map((d) => d.id)).toEqual(['default']);
    expect(server.live('card')).toEqual([card]);
    expect(server.live('progress')).toHaveLength(1);
    expect(server.live('history')).toHaveLength(1);
  });

  it('downloads everything to a second device, progress included', async () => {
    const a = new TestDevice('a');
    const card = a.addCard('hola', 'hello');
    a.review(card.id, 'easy');
    await a.link(server.transport());
    await a.sync(server.transport());

    const b = new TestDevice('b');
    await b.link(server.transport(), 'use-account');
    await b.sync(server.transport());

    expect(b.cards).toEqual(a.cards);
    expect(b.progressOf(card.id)).toEqual(a.progressOf(card.id));
    expect(b.snapshot.progress.history).toEqual(a.snapshot.progress.history);
  });

  it('uploads a large collection in batches', async () => {
    const a = new TestDevice('a');
    for (let i = 0; i < 25; i += 1) a.addCard(`term ${i}`, `definition ${i}`);
    await a.link(server.transport());
    await a.sync(server.transport(), 10);
    expect(server.pushes).toBe(3);
    expect(server.live('card')).toHaveLength(25);
  });

  it('pages through a large download', async () => {
    const a = new TestDevice('a');
    for (let i = 0; i < 12; i += 1) a.addCard(`term ${i}`, `definition ${i}`);
    await a.link(server.transport());
    await a.sync(server.transport());
    server.pageSize = 5;

    const b = new TestDevice('b');
    await b.link(server.transport(), 'use-account');
    expect(b.cards).toHaveLength(12);
  });
});

describe('changes across devices', () => {
  it('brings an edit, an addition and a deletion from one device to the other', async () => {
    const { a, b } = await twoDevices([
      ['one', '1'],
      ['two', '2'],
    ]);
    const [first, second] = a.cards;
    a.editCard(first!.id, { term: 'uno' });
    a.deleteCard(second!.id);
    const third = a.addCard('tres', '3');
    await a.sync(server.transport());
    await b.sync(server.transport());

    expect(b.cards.map((c) => c.term)).toEqual(['uno', 'tres']);
    expect(b.card(third.id)).toEqual(third);
  });

  it('does nothing when synced again with no changes', async () => {
    const { a } = await twoDevices();
    const before = structuredClone(a.snapshot);
    const pushes = server.pushes;
    const result = await a.sync(server.transport());
    expect(result.uploaded).toBe(0);
    expect(server.pushes).toBe(pushes);
    expect(a.snapshot).toEqual(before);
  });

  it('reports changes that are waiting to upload', async () => {
    const { a } = await twoDevices();
    a.addCard('new', 'card');
    server.failPushes.push('network');
    await expect(a.sync(server.transport())).rejects.toBeInstanceOf(SyncError);
    // The change is still here and still pending, ready for the next try.
    expect(a.cards.map((c) => c.term)).toContain('new');
    const retry = await a.sync(server.transport());
    expect(retry.uploaded).toBe(1);
    expect(retry.pending).toBe(0);
  });
});

describe('failures and retries', () => {
  it('leaves local data untouched when the server cannot be reached', async () => {
    const { a } = await twoDevices();
    a.addCard('offline', 'edit');
    const before = structuredClone(a.snapshot);
    const state = structuredClone(a.state);
    server.failPulls.push('network');

    const error = await a.sync(server.transport()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncError);
    expect((error as SyncError).kind).toBe('network');
    expect((error as SyncError).retryable).toBe(true);
    expect(a.snapshot).toEqual(before);
    expect(a.state).toEqual(state);
  });

  it('never duplicates a change whose reply was lost', async () => {
    const { a, b } = await twoDevices();
    a.addCard('once', 'only');
    server.loseReplies = 1;
    await expect(a.sync(server.transport())).rejects.toBeInstanceOf(SyncError);
    await a.sync(server.transport());
    await b.sync(server.transport());

    expect(server.live('card').filter((c) => c.term === 'once')).toHaveLength(1);
    expect(b.cards.filter((c) => c.term === 'once')).toHaveLength(1);
  });

  it('keeps what one batch uploaded when a later batch fails, and resumes', async () => {
    const a = new TestDevice('a');
    for (let i = 0; i < 6; i += 1) a.addCard(`term ${i}`, `definition ${i}`);
    await a.link(server.transport());
    // The first batch lands; the second fails.
    let calls = 0;
    const transport = server.transport();
    const flaky = {
      pull: transport.pull,
      push: async (changes: Parameters<typeof transport.push>[0]) => {
        calls += 1;
        if (calls === 2) throw new SyncError('server', 'Service unavailable', true);
        return transport.push(changes);
      },
    };
    await expect(a.sync(flaky, 3)).rejects.toBeInstanceOf(SyncError);
    expect(server.live('card').length).toBeGreaterThan(0);
    expect(server.live('card').length).toBeLessThan(6);

    const pushedBefore = server.pushedChanges;
    const result = await a.sync(server.transport(), 3);
    expect(result.pending).toBe(0);
    expect(server.live('card')).toHaveLength(6);
    // Only what had not landed was sent again.
    expect(server.pushedChanges - pushedBefore).toBeLessThan(7);
  });

  it('records a change the server refuses and does not send it again until it changes', async () => {
    const { a } = await twoDevices();
    const bad = a.addCard('x', 'y');
    // A record the server's own validation rejects (an out-of-range timestamp).
    a.snapshot.data.cards = a.cards.map((c) => (c.id === bad.id ? { ...c, createdAt: 0.5 } : c));
    const good = a.addCard('fine', 'card');

    await a.sync(server.transport());
    expect(server.live('card').map((c) => c.id)).toContain(good.id);
    expect(a.state?.rejected.map((r) => r.id)).toEqual([bad.id]);

    const pushes = server.pushes;
    await a.sync(server.transport());
    expect(server.pushes).toBe(pushes);

    a.snapshot.data.cards = a.cards.map((c) =>
      c.id === bad.id ? { ...c, createdAt: a.clock, updatedAt: a.clock } : c,
    );
    await a.sync(server.transport());
    expect(server.live('card').map((c) => c.id)).toContain(bad.id);
    expect(a.state?.rejected).toEqual([]);
  });

  it('stops without saving when this browser cannot store the result', async () => {
    const { a, b } = await twoDevices();
    a.addCard('new', 'card');
    await a.sync(server.transport());
    b.failWrites = 1;
    const cursor = b.state?.cursor;

    const error = await b.sync(server.transport()).catch((e: unknown) => e);
    expect((error as SyncError).kind).toBe('local');
    expect(b.state?.cursor).toBe(cursor);

    await b.sync(server.transport());
    expect(b.cards.map((c) => c.term)).toContain('new');
  });

  it('surfaces an expired session without touching anything', async () => {
    const { a } = await twoDevices();
    server.failPulls.push('auth');
    const error = await a.sync(server.transport()).catch((e: unknown) => e);
    expect((error as SyncError).kind).toBe('auth');
    expect((error as SyncError).retryable).toBe(false);
  });
});

describe('conflicts', () => {
  it('keeps edits to different fields of one card made offline on two devices', async () => {
    const { a, b } = await twoDevices();
    const id = a.cards[0]!.id;
    a.editCard(id, { term: 'hola!' });
    b.editCard(id, { definition: 'hello!' });
    await a.sync(server.transport());
    await b.sync(server.transport());
    await a.sync(server.transport());

    expect(a.card(id)).toMatchObject({ term: 'hola!', definition: 'hello!' });
    expect(b.card(id)).toEqual(a.card(id));
    expect(b.state?.conflicts).toEqual([]);
  });

  it('keeps the later of two edits to the same field and saves the other', async () => {
    const { a, b } = await twoDevices();
    const id = a.cards[0]!.id;
    a.editCard(id, { term: 'from a' });
    b.tick(120_000);
    b.editCard(id, { term: 'from b' });
    await a.sync(server.transport());
    await b.sync(server.transport());
    await a.sync(server.transport());

    expect(a.card(id)?.term).toBe('from b');
    expect(b.card(id)?.term).toBe('from b');
    expect(b.state?.conflicts).toHaveLength(1);
    expect(b.state?.conflicts[0]).toMatchObject({
      reason: 'both-changed',
      other: { term: 'from a' },
    });
  });

  it('converges whichever device syncs first', async () => {
    const { a, b } = await twoDevices();
    const id = a.cards[0]!.id;
    a.editCard(id, { term: 'from a' });
    b.editCard(id, { term: 'from b' });
    await b.sync(server.transport());
    await a.sync(server.transport());
    await b.sync(server.transport());
    expect(a.card(id)).toEqual(b.card(id));
    expect(server.live('card')[0]).toEqual(a.card(id));
  });

  it('keeps a card edited on one device and deleted on another', async () => {
    const { a, b } = await twoDevices();
    const id = a.cards[0]!.id;
    a.deleteCard(id);
    b.editCard(id, { term: 'still needed' });
    await a.sync(server.transport());
    await b.sync(server.transport());
    await a.sync(server.transport());

    expect(a.card(id)?.term).toBe('still needed');
    expect(b.card(id)?.term).toBe('still needed');
    expect(b.state?.conflicts[0]).toMatchObject({ reason: 'deleted-elsewhere', recordId: id });
  });

  it('deletes everywhere when the other device did not change the card', async () => {
    const { a, b } = await twoDevices();
    const id = a.cards[0]!.id;
    a.deleteCard(id);
    await a.sync(server.transport());
    await b.sync(server.transport());
    expect(b.card(id)).toBeUndefined();
    expect(server.live('card')).toEqual([]);
  });

  it('brings a deck back when another device added a card to it after it was deleted', async () => {
    const a = new TestDevice('a');
    a.createDeck('Spanish', 'spanish');
    a.addCard('uno', 'one', 'spanish');
    await a.link(server.transport());
    await a.sync(server.transport());
    const b = new TestDevice('b');
    await b.link(server.transport(), 'use-account');

    a.deleteDeck('spanish', 'default');
    const added = b.addCard('dos', 'two', 'spanish');
    await b.sync(server.transport());
    await a.sync(server.transport());
    await b.sync(server.transport());

    for (const device of [a, b]) {
      expect(device.snapshot.data.decks.map((d) => d.id)).toContain('spanish');
      expect(device.card(added.id)?.deckId).toBe('spanish');
      // The card that was in the deck when it was deleted stays where it was moved.
      expect(device.cards.find((c) => c.term === 'uno')?.deckId).toBe('default');
    }
  });

  it('brings a deck back when this device added a card after another device deleted it', async () => {
    const a = new TestDevice('a');
    a.createDeck('Spanish', 'spanish');
    await a.link(server.transport());
    await a.sync(server.transport());
    const b = new TestDevice('b');
    await b.link(server.transport(), 'use-account');

    a.deleteDeck('spanish', 'default');
    await a.sync(server.transport());
    const added = b.addCard('dos', 'two', 'spanish');
    await b.sync(server.transport());
    await a.sync(server.transport());

    expect(a.card(added.id)?.deckId).toBe('spanish');
    expect(a.snapshot.data.decks.find((d) => d.id === 'spanish')?.name).toBe('Spanish');
    expect(server.live('deck').map((d) => d.id)).toContain('spanish');
  });

  it('adds up reviews of the same card made on two devices', async () => {
    const { a, b } = await twoDevices();
    const id = a.cards[0]!.id;
    a.review(id, 'good');
    await a.sync(server.transport());
    await b.sync(server.transport());

    a.review(id, 'good');
    b.review(id, 'again');
    b.review(id, 'good');
    await a.sync(server.transport());
    await b.sync(server.transport());
    await a.sync(server.transport());

    expect(a.progressOf(id)).toMatchObject({ reviews: 4, correct: 3, incorrect: 1 });
    expect(b.progressOf(id)).toEqual(a.progressOf(id));
    const today = a.snapshot.progress.history.at(-1);
    expect(today?.reviews).toBe(4);
    expect(b.snapshot.progress.history).toEqual(a.snapshot.progress.history);
  });

  it('removes progress everywhere when its card is deleted', async () => {
    const { a, b } = await twoDevices();
    const id = a.cards[0]!.id;
    a.review(id, 'good');
    await a.sync(server.transport());
    await b.sync(server.transport());
    a.deleteCard(id);
    await a.sync(server.transport());
    await b.sync(server.transport());
    expect(b.progressOf(id)).toBeUndefined();
    expect(server.live('progress')).toEqual([]);
  });
});

describe('recovery after a refresh', () => {
  it('uploads changes made before a reload, from the saved state alone', async () => {
    const { a } = await twoDevices();
    a.addCard('before', 'reload');
    // A reload: everything in memory is rebuilt from what was saved.
    const reloaded = new TestDevice('a');
    reloaded.snapshot = structuredClone(a.snapshot);
    reloaded.state = structuredClone(a.state);
    const result = await reloaded.sync(server.transport());
    expect(result.uploaded).toBe(1);
    expect(server.live('card').map((c) => c.term)).toContain('before');
  });

  it('finishes cleanly when the page closed between saving data and saving sync state', async () => {
    const { a, b } = await twoDevices();
    a.addCard('arrives', 'twice');
    await a.sync(server.transport());
    // b saves the merged data, but its sync state is lost before it is saved.
    b.failStateSaves = true;
    await expect(b.sync(server.transport())).rejects.toBeInstanceOf(SyncError);
    b.failStateSaves = false;
    const result = await b.sync(server.transport());
    expect(result.pending).toBe(0);
    expect(b.cards.filter((c) => c.term === 'arrives')).toHaveLength(1);
  });
});
