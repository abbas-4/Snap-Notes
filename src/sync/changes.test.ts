import { describe, expect, it } from 'vitest';
import { createDefaultDeck } from '../domain/appData';
import type { Card, Deck } from '../domain/types';
import { acknowledge, applyRemote, currentRejections, pendingChanges, rejection } from './changes';
import { emptyRecordSets, type RecordSets } from './records';
import { emptyBaseSets, type BaseSets, type RemoteRecord } from './state';

const deck: Deck = createDefaultDeck(1_000);
const spanish: Deck = { id: 'spanish', name: 'Spanish', createdAt: 1_000, updatedAt: 1_000 };
const card = (overrides: Partial<Card> = {}): Card => ({
  id: 'c1',
  deckId: 'default',
  term: 'hola',
  definition: 'hello',
  createdAt: 2_000,
  updatedAt: 2_000,
  ...overrides,
});

function sets(decks: Deck[], cards: Card[]): RecordSets {
  const result = emptyRecordSets();
  for (const d of decks) result.deck.set(d.id, d);
  for (const c of cards) result.card.set(c.id, c);
  return result;
}

function synced(decks: Deck[], cards: Card[], revision = 1): BaseSets {
  const base = emptyBaseSets();
  for (const d of decks) base.deck[d.id] = { revision, data: d };
  for (const c of cards) base.card[c.id] = { revision, data: c };
  return base;
}

const remote = (
  kind: RemoteRecord['kind'],
  id: string,
  revision: number,
  data: RemoteRecord['data'],
): RemoteRecord => ({ kind, id, revision, deleted: data === null, data });

describe('pendingChanges', () => {
  it('lists nothing when everything matches what the server confirmed', () => {
    expect(pendingChanges(sets([deck], [card()]), synced([deck], [card()]))).toEqual([]);
  });

  it('finds new, edited and deleted records', () => {
    const base = synced([deck, spanish], [card(), card({ id: 'c2' })]);
    const local = sets([deck], [card({ term: 'edited', updatedAt: 3_000 }), card({ id: 'c3' })]);
    const changes = pendingChanges(local, base);
    expect(changes.map((c) => [c.kind, c.id, c.deleted, c.baseRevision])).toEqual([
      ['card', 'c1', false, 1],
      ['card', 'c3', false, null],
      ['card', 'c2', true, 1],
      ['deck', 'spanish', true, 1],
    ]);
  });

  it('uploads decks before their cards and deleted decks last', () => {
    const local = sets([spanish], [card({ deckId: 'spanish' })]);
    const base = synced([deck], []);
    expect(pendingChanges(local, base).map((c) => `${c.kind}:${c.id}:${c.deleted}`)).toEqual([
      'deck:spanish:false',
      'card:c1:false',
      'deck:default:true',
    ]);
  });

  it('does not send a record the server has deleted and this device does not have', () => {
    const base = emptyBaseSets();
    base.card.gone = { revision: 3, data: null };
    expect(pendingChanges(sets([], []), base)).toEqual([]);
  });

  it('recreates a record on top of the server tombstone', () => {
    const base = emptyBaseSets();
    base.deck.default = { revision: 3, data: null };
    expect(pendingChanges(sets([deck], []), base)[0]).toMatchObject({ baseRevision: 3 });
  });

  it('holds back a refused change until its content changes', () => {
    const local = sets([deck], [card()]);
    const base = synced([deck], []);
    const [change] = pendingChanges(local, base);
    const refused = [rejection(change!, 'too long', 5)];
    expect(pendingChanges(local, base, refused)).toEqual([]);

    const edited = sets([deck], [card({ term: 'fixed' })]);
    expect(pendingChanges(edited, base, refused)).toHaveLength(1);
    expect(currentRejections(refused, pendingChanges(edited, base))).toEqual([]);
    expect(currentRejections(refused, pendingChanges(local, base))).toEqual(refused);
  });
});

describe('acknowledge', () => {
  it('moves the base to what the server confirmed', () => {
    const base = emptyBaseSets();
    acknowledge(
      base,
      { kind: 'card', id: 'c1', baseRevision: null, deleted: false, data: card() },
      7,
    );
    expect(base.card.c1).toEqual({ revision: 7, data: card() });
    acknowledge(base, { kind: 'card', id: 'c1', baseRevision: 7, deleted: true, data: null }, 8);
    expect(base.card.c1).toEqual({ revision: 8, data: null });
    acknowledge(base, { kind: 'card', id: 'c1', baseRevision: 8, deleted: true, data: null }, null);
    expect(base.card.c1).toBeUndefined();
  });
});

describe('applyRemote', () => {
  it('takes the server version of a record that did not change here', () => {
    const edited = card({ term: 'edited', updatedAt: 3_000 });
    const outcome = applyRemote(sets([deck], [card()]), synced([deck], [card()]), [
      remote('card', 'c1', 2, edited),
    ]);
    expect(outcome.sets.card.get('c1')).toEqual(edited);
    expect(outcome.base.card.c1).toEqual({ revision: 2, data: edited });
    expect(outcome.changed).toBe(true);
  });

  it('keeps a local change when the server sends something it already had', () => {
    const local = card({ term: 'mine', updatedAt: 3_000 });
    const outcome = applyRemote(sets([deck], [local]), synced([deck], [card()], 4), [
      remote('card', 'c1', 4, card()),
    ]);
    expect(outcome.sets.card.get('c1')).toEqual(local);
    expect(outcome.changed).toBe(false);
  });

  it('adds records it has never seen and removes records deleted elsewhere', () => {
    const outcome = applyRemote(sets([deck], [card()]), synced([deck], [card()]), [
      remote('card', 'c1', 2, null),
      remote('card', 'c9', 3, card({ id: 'c9' })),
    ]);
    expect([...outcome.sets.card.keys()]).toEqual(['c9']);
  });

  it('merges a record changed on both sides and reports a true conflict', () => {
    const outcome = applyRemote(
      sets([deck], [card({ term: 'mine', updatedAt: 9_000 })]),
      synced([deck], [card()]),
      [remote('card', 'c1', 2, card({ term: 'theirs', updatedAt: 3_000 }))],
    );
    expect(outcome.sets.card.get('c1')?.term).toBe('mine');
    expect(outcome.conflicts).toHaveLength(1);
    // The base is the server's version, so the merged card is a change to upload.
    expect(outcome.base.card.c1?.data?.term).toBe('theirs');
  });

  it('keeps a deck deleted elsewhere while this device has cards in it', () => {
    const local = sets([deck, spanish], [card({ deckId: 'spanish' })]);
    const base = synced([deck, spanish], [card({ deckId: 'spanish' })]);
    const outcome = applyRemote(local, base, [remote('deck', 'spanish', 2, null)]);
    // The card was moved out by the deleting device, but this copy is still in the deck.
    expect(outcome.sets.deck.get('spanish')).toEqual(spanish);
    expect(outcome.conflicts[0]).toMatchObject({ kind: 'deck', reason: 'deleted-elsewhere' });
    expect(outcome.missingDecks).toEqual([]);
  });

  it('restores a deck deleted here when another device put a card in it', () => {
    const local = sets([deck], []);
    const base = synced([deck, spanish], []);
    const outcome = applyRemote(local, base, [
      remote('card', 'new', 2, card({ id: 'new', deckId: 'spanish' })),
    ]);
    expect(outcome.sets.deck.get('spanish')).toEqual(spanish);
    expect(outcome.conflicts[0]).toMatchObject({ reason: 'deleted-here' });
  });

  it('reports a card whose deck it cannot find, so nothing half-done is saved', () => {
    const outcome = applyRemote(sets([deck], []), synced([deck], []), [
      remote('card', 'new', 2, card({ id: 'new', deckId: 'unknown' })),
    ]);
    expect(outcome.missingDecks).toEqual(['unknown']);
  });

  it('applies only the newest copy of a record listed twice', () => {
    const outcome = applyRemote(sets([deck], []), synced([deck], []), [
      remote('card', 'c1', 5, card({ term: 'newest' })),
      remote('card', 'c1', 3, card({ term: 'older' })),
    ]);
    expect(outcome.sets.card.get('c1')?.term).toBe('newest');
    expect(outcome.base.card.c1?.revision).toBe(5);
  });
});
