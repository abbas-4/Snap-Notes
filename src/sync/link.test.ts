import { describe, expect, it } from 'vitest';
import { createEmptyAppData } from '../domain/appData';
import type { CardProgress } from '../domain/srs';
import type { Card, Deck } from '../domain/types';
import { emptyProgress } from '../storage/progressStore';
import { isLocalEmpty, planLink } from './link';
import type { LocalSnapshot } from './records';
import type { RemoteRecord } from './state';

const NOW = 1_700_000_000_000;

const deck = (id: string, name: string): Deck => ({
  id,
  name,
  createdAt: 1_000,
  updatedAt: 1_000,
});
const card = (id: string, term: string, deckId = 'default', definition = `${term} def`): Card => ({
  id,
  deckId,
  term,
  definition,
  createdAt: 2_000,
  updatedAt: 2_000,
});
const progress = (cardId: string, reviews: number, lastReviewedAt = 5_000): CardProgress => ({
  cardId,
  deckId: 'default',
  reviews,
  correct: reviews,
  incorrect: 0,
  stage: 'learning',
  intervalDays: 1,
  ease: 2.5,
  lastReviewedAt,
  dueAt: lastReviewedAt + 86_400_000,
  streak: reviews,
});

function local(decks: Deck[], cards: Card[], records: CardProgress[] = []): LocalSnapshot {
  return {
    data: { schemaVersion: 2, decks, cards },
    progress: { ...emptyProgress(), records },
  };
}

let revision = 0;
function cloud(decks: Deck[], cards: Card[], records: CardProgress[] = []): RemoteRecord[] {
  return [
    ...decks.map((d) => ({
      kind: 'deck' as const,
      id: d.id,
      revision: ++revision,
      deleted: false,
      data: d,
    })),
    ...cards.map((c) => ({
      kind: 'card' as const,
      id: c.id,
      revision: ++revision,
      deleted: false,
      data: c,
    })),
    ...records.map((p) => ({
      kind: 'progress' as const,
      id: p.cardId,
      revision: ++revision,
      deleted: false,
      data: p,
    })),
  ];
}

const myCards = deck('default', 'My Cards');

describe('isLocalEmpty', () => {
  it('is true for a browser that has never been used', () => {
    expect(isLocalEmpty({ data: createEmptyAppData(NOW), progress: emptyProgress() })).toBe(true);
  });

  it('is false once there is a card, a renamed deck or a new deck', () => {
    expect(isLocalEmpty(local([myCards], [card('c', 'x')]))).toBe(false);
    expect(isLocalEmpty(local([deck('default', 'Mine')], []))).toBe(false);
    expect(isLocalEmpty(local([myCards, deck('d', 'Spanish')], []))).toBe(false);
  });
});

describe('planLink', () => {
  it('downloads the account into an empty browser', () => {
    const result = planLink(
      { data: createEmptyAppData(NOW), progress: emptyProgress() },
      cloud([myCards, deck('es', 'Spanish')], [card('c1', 'hola', 'es')], [progress('c1', 3)]),
      'use-account',
      NOW,
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.snapshot.data.cards.map((c) => c.id)).toEqual(['c1']);
    expect(result.plan.snapshot.progress.records[0]).toMatchObject({ cardId: 'c1', deckId: 'es' });
    expect(result.plan.report).toMatchObject({ cardsDownloaded: 1, decksDownloaded: 2 });
  });

  it('gives an empty account a deck to put cards in', () => {
    const result = planLink(local([myCards], []), [], 'use-account', NOW);
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.snapshot.data.decks.map((d) => d.id)).toEqual(['default']);
  });

  it('uploads everything from this browser to an empty account', () => {
    const result = planLink(
      local([myCards, deck('es', 'Spanish')], [card('c1', 'hola', 'es')], [progress('c1', 2)]),
      [],
      'merge',
      NOW,
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.report).toMatchObject({ decksUploaded: 2, cardsUploaded: 1 });
    expect(result.plan.snapshot.data.cards).toEqual([card('c1', 'hola', 'es')]);
    // Nothing is in the base yet, so every record is waiting to upload.
    expect(Object.keys(result.plan.base.card)).toEqual([]);
  });

  it('keeps IDs exactly as they were', () => {
    const result = planLink(local([myCards], [card('legacy-17', 'x')]), [], 'merge', NOW);
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.snapshot.data.cards[0]?.id).toBe('legacy-17');
  });

  it('joins both sides, recognising decks by name and cards by content', () => {
    const result = planLink(
      local(
        [myCards, deck('local-es', 'spanish ')],
        [card('l1', 'hola', 'local-es'), card('l2', 'adios', 'local-es')],
        [progress('l1', 4, 9_000)],
      ),
      cloud(
        [myCards, deck('cloud-es', 'Spanish')],
        [card('c1', 'hola', 'cloud-es'), card('c2', 'gracias', 'cloud-es')],
        [progress('c1', 2, 3_000)],
      ),
      'merge',
      NOW,
    );
    if (!result.ok) throw new Error(result.message);
    const { snapshot, report } = result.plan;

    expect(snapshot.data.decks.map((d) => d.id).sort()).toEqual(['cloud-es', 'default']);
    expect(snapshot.data.cards.map((c) => `${c.id}:${c.deckId}`).sort()).toEqual([
      'c1:cloud-es',
      'c2:cloud-es',
      'l2:cloud-es',
    ]);
    expect(report).toMatchObject({
      duplicateDecks: 1,
      duplicateCards: 1,
      cardsUploaded: 1,
      cardsDownloaded: 1,
    });
    // The duplicate's progress is merged into the account's card, never counted twice.
    expect(snapshot.progress.records.find((p) => p.cardId === 'c1')).toMatchObject({
      reviews: 4,
      lastReviewedAt: 9_000,
    });
  });

  it('merges a card both sides hold under one ID, keeping the other version as a conflict', () => {
    const result = planLink(
      local([myCards], [{ ...card('c1', 'mine'), updatedAt: 9_000 }]),
      cloud([myCards], [card('c1', 'theirs')]),
      'merge',
      NOW,
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.snapshot.data.cards[0]?.term).toBe('mine');
    expect(result.plan.conflicts[0]).toMatchObject({ reason: 'linked', other: { term: 'theirs' } });
  });

  it('never duplicates when the same browser data is linked twice', () => {
    const data = local([myCards], [card('c1', 'hola'), card('c2', 'adios')]);
    const first = planLink(data, [], 'merge', NOW);
    if (!first.ok) throw new Error(first.message);
    const uploaded = cloud(first.plan.snapshot.data.decks, first.plan.snapshot.data.cards);

    const again = planLink(data, uploaded, 'merge', NOW);
    if (!again.ok) throw new Error(again.message);
    expect(again.plan.snapshot.data.cards).toHaveLength(2);
    expect(again.plan.report.cardsUploaded).toBe(0);
  });

  it('leaves an empty deck deleted in the account deleted', () => {
    const remote: RemoteRecord[] = [
      ...cloud([deck('es', 'Spanish')], []),
      { kind: 'deck', id: 'default', revision: ++revision, deleted: true, data: null },
    ];
    const result = planLink(
      local([myCards, deck('fr', 'French')], [card('c1', 'x', 'fr')]),
      remote,
      'merge',
      NOW,
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.snapshot.data.decks.map((d) => d.id).sort()).toEqual(['es', 'fr']);
  });
});
