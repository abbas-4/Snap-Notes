import { describe, expect, it } from 'vitest';
import { browser, newAccount, PASSWORD } from '../test/integration';
import { TestDevice } from '../test/syncDevice';
import { SyncError, type SyncTransport } from './engine';

/**
 * The scenarios of engine.test.ts, against the real database: two devices of
 * one account, each with its own browser session, syncing through Postgres.
 */

async function twoDevices(label: string) {
  const account = await newAccount(label);
  const second = await browser();
  await second.auth.signIn(account.email, PASSWORD);
  return {
    a: { device: new TestDevice('a'), transport: account.services.transport },
    b: { device: new TestDevice('b'), transport: second.transport },
    account,
  };
}

/** A transport whose next push lands on the server but whose reply never arrives. */
function losingReplies(transport: SyncTransport, count: number): SyncTransport {
  let left = count;
  return {
    pull: (since) => transport.pull(since),
    push: async (changes) => {
      const results = await transport.push(changes);
      if (left > 0) {
        left -= 1;
        throw new SyncError('network', 'Failed to fetch', true);
      }
      return results;
    },
  };
}

describe('sync against the real server', () => {
  it('uploads from one device and downloads to another, progress included', async () => {
    const { a, b } = await twoDevices('updown');
    const card = a.device.addCard('hola', 'hello');
    a.device.review(card.id, 'good');
    await a.device.link(a.transport);
    expect((await a.device.sync(a.transport)).pending).toBe(0);

    await b.device.link(b.transport, 'use-account');
    await b.device.sync(b.transport);
    expect(b.device.cards).toEqual(a.device.cards);
    expect(b.device.progressOf(card.id)).toEqual(a.device.progressOf(card.id));
    expect(b.device.snapshot.progress.history).toEqual(a.device.snapshot.progress.history);
  });

  it('carries edits and deletions between devices, and repeats cleanly', async () => {
    const { a, b } = await twoDevices('edits');
    const one = a.device.addCard('one', '1');
    const two = a.device.addCard('two', '2');
    await a.device.link(a.transport);
    await a.device.sync(a.transport);
    await b.device.link(b.transport, 'use-account');

    a.device.editCard(one.id, { term: 'uno' });
    a.device.deleteCard(two.id);
    await a.device.sync(a.transport);
    await b.device.sync(b.transport);
    expect(b.device.cards.map((c) => c.term)).toEqual(['uno']);

    const again = await b.device.sync(b.transport);
    expect(again.uploaded).toBe(0);
    expect(again.pending).toBe(0);
  });

  it('never duplicates a change whose reply was lost', async () => {
    const { a, b } = await twoDevices('lost');
    await a.device.link(a.transport);
    a.device.addCard('once', 'only');
    await expect(a.device.sync(losingReplies(a.transport, 1))).rejects.toBeInstanceOf(SyncError);
    await a.device.sync(a.transport);
    await b.device.link(b.transport, 'use-account');
    expect(b.device.cards.filter((c) => c.term === 'once')).toHaveLength(1);
  });

  it('merges offline edits to one card from two devices', async () => {
    const { a, b } = await twoDevices('concurrent');
    const card = a.device.addCard('hola', 'hello');
    await a.device.link(a.transport);
    await a.device.sync(a.transport);
    await b.device.link(b.transport, 'use-account');

    a.device.editCard(card.id, { term: 'hola!' });
    b.device.editCard(card.id, { definition: 'hello!' });
    await a.device.sync(a.transport);
    await b.device.sync(b.transport);
    await a.device.sync(a.transport);
    expect(a.device.card(card.id)).toMatchObject({ term: 'hola!', definition: 'hello!' });
    expect(b.device.card(card.id)).toEqual(a.device.card(card.id));
  });

  it('keeps a card deleted on one device but edited on the other', async () => {
    const { a, b } = await twoDevices('editdelete');
    const card = a.device.addCard('keep', 'me');
    await a.device.link(a.transport);
    await a.device.sync(a.transport);
    await b.device.link(b.transport, 'use-account');

    a.device.deleteCard(card.id);
    b.device.editCard(card.id, { term: 'kept' });
    await a.device.sync(a.transport);
    await b.device.sync(b.transport);
    await a.device.sync(a.transport);
    expect(a.device.card(card.id)?.term).toBe('kept');
  });

  it('brings a deck back when a card was added to it on another device', async () => {
    const { a, b } = await twoDevices('deckrace');
    a.device.createDeck('Spanish', 'spanish');
    await a.device.link(a.transport);
    await a.device.sync(a.transport);
    await b.device.link(b.transport, 'use-account');

    a.device.deleteDeck('spanish', 'default');
    const added = b.device.addCard('dos', 'two', 'spanish');
    await b.device.sync(b.transport);
    await a.device.sync(a.transport);
    await b.device.sync(b.transport);
    for (const { device } of [a, b]) {
      expect(device.card(added.id)?.deckId).toBe('spanish');
      expect(device.snapshot.data.decks.map((d) => d.id)).toContain('spanish');
    }
  });

  it('adds up reviews made on both devices', async () => {
    const { a, b } = await twoDevices('reviews');
    const card = a.device.addCard('hola', 'hello');
    await a.device.link(a.transport);
    await a.device.sync(a.transport);
    await b.device.link(b.transport, 'use-account');

    a.device.review(card.id, 'good');
    b.device.review(card.id, 'again');
    await a.device.sync(a.transport);
    await b.device.sync(b.transport);
    await a.device.sync(a.transport);
    expect(a.device.progressOf(card.id)).toMatchObject({ reviews: 2, correct: 1, incorrect: 1 });
    expect(b.device.progressOf(card.id)).toEqual(a.device.progressOf(card.id));
  });

  it('resumes an interrupted first upload without duplicating anything', async () => {
    const { a, b } = await twoDevices('resume');
    for (let i = 0; i < 30; i += 1) a.device.addCard(`term ${i}`, `definition ${i}`);
    await a.device.link(a.transport);
    let pushes = 0;
    const failing: SyncTransport = {
      pull: (since) => a.transport.pull(since),
      push: (changes) => {
        pushes += 1;
        if (pushes === 2) return Promise.reject(new SyncError('network', 'offline', true));
        return a.transport.push(changes);
      },
    };
    await expect(a.device.sync(failing, 10)).rejects.toBeInstanceOf(SyncError);
    const result = await a.device.sync(a.transport, 10);
    expect(result.pending).toBe(0);

    await b.device.link(b.transport, 'use-account');
    expect(b.device.cards).toHaveLength(30);
    expect(new Set(b.device.cards.map((c) => c.id)).size).toBe(30);
  });

  it('links a second device with its own data, recognising duplicates', async () => {
    const { a, b } = await twoDevices('linkmerge');
    a.device.addCard('hola', 'hello');
    await a.device.link(a.transport);
    await a.device.sync(a.transport);

    // b was used offline before signing in, and has one of the same cards.
    b.device.addCard('hola', 'hello');
    b.device.addCard('adios', 'goodbye');
    const linked = await b.device.link(b.transport, 'merge');
    expect(linked.report).toMatchObject({ duplicateCards: 1, cardsUploaded: 1 });
    await b.device.sync(b.transport);
    await a.device.sync(a.transport);
    expect(a.device.cards.map((c) => c.term).sort()).toEqual(['adios', 'hola']);
  });
});
