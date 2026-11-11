import { describe, expect, it } from 'vitest';
import { appDataSchema } from '../storage/schemas';
import { DEFAULT_DECK_ID } from './appData';
import {
  cardCountByDeck,
  createDeck,
  deckNameTaken,
  deleteDeck,
  moveCards,
  renameDeck,
  type DeckOpResult,
} from './deckOps';
import { SCHEMA_VERSION, type AppData, type Card, type Deck } from './types';

const NOW = 1_800_000_000_000;
const EARLIER = 1_700_000_000_000;

/** Predictable IDs so tests can assert exact values. */
function sequentialIds(prefix = 'deck') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function deck(id: string, name: string): Deck {
  return { id, name, createdAt: EARLIER, updatedAt: EARLIER };
}

function card(id: string, deckId: string, term = `Term ${id}`): Card {
  return {
    id,
    deckId,
    term,
    definition: `Definition ${id}`,
    createdAt: EARLIER,
    updatedAt: EARLIER,
  };
}

function appData(decks: Deck[], cards: Card[] = []): AppData {
  return { schemaVersion: SCHEMA_VERSION, decks, cards };
}

/** Every operation must produce data the storage layer would accept. */
function expectValid(result: DeckOpResult): AppData {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(appDataSchema.safeParse(result.data).success).toBe(true);
  return result.data;
}

function expectRefused(result: DeckOpResult): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected the operation to be refused');
  return result.message;
}

const base = appData(
  [deck(DEFAULT_DECK_ID, 'My Cards'), deck('biology', 'Biology')],
  [card('a', DEFAULT_DECK_ID), card('b', 'biology'), card('c', 'biology')],
);

describe('createDeck', () => {
  it('adds a deck with trimmed name and matching timestamps', () => {
    const data = expectValid(
      createDeck(base, '  Chemistry  ', { now: NOW, createId: sequentialIds() }),
    );

    expect(data.decks).toHaveLength(3);
    expect(data.decks[2]).toEqual({
      id: 'deck-1',
      name: 'Chemistry',
      createdAt: NOW,
      updatedAt: NOW,
    });
    // Nothing else is touched.
    expect(data.cards).toEqual(base.cards);
  });

  it('refuses a blank name', () => {
    expect(expectRefused(createDeck(base, '   '))).toBe('A deck needs a name.');
  });

  it('refuses a name another deck already uses, ignoring case and spacing', () => {
    expect(expectRefused(createDeck(base, '  biology '))).toContain('already exists');
    expect(expectRefused(createDeck(base, 'BIOLOGY'))).toContain('already exists');
  });

  it('replaces an ID that is already in use', () => {
    const ids = ['biology', 'biology', 'fresh'];
    let n = 0;
    const data = expectValid(
      createDeck(base, 'Chemistry', { now: NOW, createId: () => ids[n++] ?? 'fallback' }),
    );

    expect(data.decks.map((d) => d.id)).toEqual([DEFAULT_DECK_ID, 'biology', 'fresh']);
  });

  it('replaces an ID the schema would reject', () => {
    const ids = ['has spaces', 'ok-id'];
    let n = 0;
    const data = expectValid(
      createDeck(base, 'Chemistry', { now: NOW, createId: () => ids[n++] ?? 'fallback' }),
    );

    expect(data.decks[2]?.id).toBe('ok-id');
  });

  it('does not modify the data it was given', () => {
    const before = structuredClone(base);
    createDeck(base, 'Chemistry', { now: NOW, createId: sequentialIds() });
    expect(base).toEqual(before);
  });
});

describe('renameDeck', () => {
  it('renames a deck and trims the new name', () => {
    const data = expectValid(renameDeck(base, 'biology', '  Life sciences ', { now: NOW }));

    expect(data.decks[1]).toEqual({
      id: 'biology',
      name: 'Life sciences',
      createdAt: EARLIER,
      updatedAt: NOW,
    });
    expect(data.cards).toEqual(base.cards);
  });

  it('renames the default deck like any other', () => {
    const data = expectValid(renameDeck(base, DEFAULT_DECK_ID, 'Everything', { now: NOW }));

    expect(data.decks[0]?.name).toBe('Everything');
  });

  it('is a no-op when the name is unchanged', () => {
    const result = renameDeck(base, 'biology', 'Biology', { now: NOW });

    expect(result).toEqual({ ok: true, data: base });
  });

  it('lets a deck keep its own name with different case', () => {
    const data = expectValid(renameDeck(base, 'biology', 'BIOLOGY', { now: NOW }));

    expect(data.decks[1]?.name).toBe('BIOLOGY');
  });

  it('refuses a blank name, a taken name, and an unknown deck', () => {
    expect(expectRefused(renameDeck(base, 'biology', '  '))).toBe('A deck needs a name.');
    expect(expectRefused(renameDeck(base, 'biology', 'My Cards'))).toContain('already exists');
    expect(expectRefused(renameDeck(base, 'nope', 'Anything'))).toBe('This deck no longer exists.');
  });

  it('never dates a rename before the deck was created', () => {
    const data = expectValid(renameDeck(base, 'biology', 'Renamed', { now: EARLIER - 5_000 }));

    expect(data.decks[1]?.updatedAt).toBe(EARLIER);
  });
});

describe('deleteDeck', () => {
  it('moves the cards to the chosen deck and removes only the deck', () => {
    const data = expectValid(deleteDeck(base, 'biology', DEFAULT_DECK_ID, { now: NOW }));

    expect(data.decks.map((d) => d.id)).toEqual([DEFAULT_DECK_ID]);
    // Every card survives, in the same order.
    expect(data.cards.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(data.cards.every((c) => c.deckId === DEFAULT_DECK_ID)).toBe(true);
    expect(data.cards[1]).toMatchObject({ term: 'Term b', definition: 'Definition b' });
    expect(data.cards[1]?.updatedAt).toBe(NOW);
    // A card that did not move is left exactly as it was.
    expect(data.cards[0]).toEqual(base.cards[0]);
  });

  it('deletes an empty deck without touching any card', () => {
    const data = expectValid(
      deleteDeck(appData([deck('a', 'A'), deck('b', 'B')], [card('x', 'a')]), 'b', 'a', {
        now: NOW,
      }),
    );

    expect(data.decks.map((d) => d.id)).toEqual(['a']);
    expect(data.cards[0]?.updatedAt).toBe(EARLIER);
  });

  it('refuses to delete the only deck', () => {
    const only = appData([deck('solo', 'Solo')], [card('x', 'solo')]);

    expect(expectRefused(deleteDeck(only, 'solo', 'solo'))).toBe(
      'This is your only deck, so it cannot be deleted.',
    );
  });

  it('refuses an unknown deck, an unknown destination, and itself as destination', () => {
    expect(expectRefused(deleteDeck(base, 'nope', DEFAULT_DECK_ID))).toBe(
      'This deck no longer exists.',
    );
    expect(expectRefused(deleteDeck(base, 'biology', 'nope'))).toContain('no longer exists');
    expect(expectRefused(deleteDeck(base, 'biology', 'biology'))).toContain('different deck');
  });
});

describe('moveCards', () => {
  it('changes only deckId and updatedAt', () => {
    const data = expectValid(moveCards(base, ['b'], DEFAULT_DECK_ID, { now: NOW }));

    const moved = data.cards.find((c) => c.id === 'b');
    const original = base.cards.find((c) => c.id === 'b');
    expect(moved).toEqual({ ...original, deckId: DEFAULT_DECK_ID, updatedAt: NOW });
    expect(data.decks).toEqual(base.decks);
  });

  it('moves several cards at once', () => {
    const data = expectValid(moveCards(base, ['b', 'c'], DEFAULT_DECK_ID, { now: NOW }));

    expect(data.cards.every((c) => c.deckId === DEFAULT_DECK_ID)).toBe(true);
  });

  it('is a no-op when the card is already in that deck', () => {
    const result = moveCards(base, ['b'], 'biology', { now: NOW });

    expect(result).toEqual({ ok: true, data: base });
  });

  it('refuses an unknown deck and unknown cards', () => {
    expect(expectRefused(moveCards(base, ['b'], 'nope'))).toBe('That deck no longer exists.');
    expect(expectRefused(moveCards(base, ['nope'], 'biology'))).toBe('This card no longer exists.');
    expect(expectRefused(moveCards(base, ['b', 'nope'], DEFAULT_DECK_ID))).toBe(
      'Some of those cards no longer exist.',
    );
  });

  it('never dates a move before the card was created', () => {
    const data = expectValid(moveCards(base, ['b'], DEFAULT_DECK_ID, { now: EARLIER - 5_000 }));

    expect(data.cards.find((c) => c.id === 'b')?.updatedAt).toBe(EARLIER);
  });
});

describe('cardCountByDeck', () => {
  it('counts the cards in each deck and reports empty decks as zero', () => {
    const counts = cardCountByDeck(appData([deck('a', 'A'), deck('b', 'B')], [card('x', 'a')]));

    expect(counts.get('a')).toBe(1);
    expect(counts.get('b')).toBe(0);
  });
});

describe('deckNameTaken', () => {
  it('ignores case and surrounding space, and can skip one deck', () => {
    expect(deckNameTaken(base, ' biology ')).toBe(true);
    expect(deckNameTaken(base, 'Chemistry')).toBe(false);
    expect(deckNameTaken(base, 'Biology', 'biology')).toBe(false);
  });
});
