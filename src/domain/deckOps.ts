import { createId, isValidId, type IdFactory } from './ids';
import type { AppData, Timestamp } from './types';

/**
 * Deck operations, as pure functions over the whole collection.
 *
 * Each one returns the next `AppData` or a message explaining why it did not
 * happen. Nothing here reads storage or touches React: the provider hands the
 * result to its usual `commit`, which validates and saves it.
 *
 * `appDataSchema` requires every card to name a deck that exists, so a deck can
 * never be removed on its own: `deleteDeck` moves its cards in the same result.
 * A result that broke that rule would be refused by the storage layer and, if
 * it somehow reached storage, would make the *whole* collection unreadable.
 */

export type DeckOpResult = { ok: true; data: AppData } | { ok: false; message: string };

export interface DeckOpOptions {
  now?: Timestamp;
  /** Defaults to `createId`. Tests pass a counter so IDs are predictable. */
  createId?: IdFactory;
}

/** Deck names are compared with surrounding space and case ignored. */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Whether another deck already uses this name. `exceptId` skips the deck being renamed. */
export function deckNameTaken(data: AppData, name: string, exceptId?: string): boolean {
  const key = nameKey(name);
  return data.decks.some((deck) => deck.id !== exceptId && nameKey(deck.name) === key);
}

/** How many cards each deck holds, including the decks that hold none. */
export function cardCountByDeck(data: AppData): Map<string, number> {
  const counts = new Map<string, number>();
  for (const deck of data.decks) counts.set(deck.id, 0);
  for (const card of data.cards) counts.set(card.deckId, (counts.get(card.deckId) ?? 0) + 1);
  return counts;
}

/** `updatedAt` may never be earlier than `createdAt`, which the schema enforces. */
function touch(now: Timestamp, createdAt: Timestamp): Timestamp {
  return Math.max(now, createdAt);
}

export function createDeck(data: AppData, name: string, options: DeckOpOptions = {}): DeckOpResult {
  const now = options.now ?? Date.now();
  const newId = options.createId ?? createId;

  const trimmed = name.trim();
  if (trimmed === '') return { ok: false, message: 'A deck needs a name.' };
  if (deckNameTaken(data, trimmed)) {
    return { ok: false, message: `A deck called “${trimmed}” already exists.` };
  }

  // Same uniqueness loop as the legacy migration: an ID already in use, or one
  // the schema would reject, is replaced rather than written.
  const usedIds = new Set(data.decks.map((deck) => deck.id));
  let id = newId();
  while (usedIds.has(id) || !isValidId(id)) id = newId();

  const deck = { id, name: trimmed, createdAt: now, updatedAt: now };
  return { ok: true, data: { ...data, decks: [...data.decks, deck] } };
}

export function renameDeck(
  data: AppData,
  deckId: string,
  name: string,
  options: DeckOpOptions = {},
): DeckOpResult {
  const now = options.now ?? Date.now();

  const deck = data.decks.find((d) => d.id === deckId);
  if (!deck) return { ok: false, message: 'This deck no longer exists.' };

  const trimmed = name.trim();
  if (trimmed === '') return { ok: false, message: 'A deck needs a name.' };
  if (trimmed === deck.name) return { ok: true, data };
  if (deckNameTaken(data, trimmed, deckId)) {
    return { ok: false, message: `A deck called “${trimmed}” already exists.` };
  }

  const updatedAt = touch(now, deck.createdAt);
  const decks = data.decks.map((d) => (d.id === deckId ? { ...d, name: trimmed, updatedAt } : d));
  return { ok: true, data: { ...data, decks } };
}

/**
 * Removes a deck after moving every card it holds into `moveCardsTo`.
 *
 * Deleting a deck never deletes cards, and the last deck cannot be deleted:
 * without one, a new card would have nowhere to go.
 */
export function deleteDeck(
  data: AppData,
  deckId: string,
  moveCardsTo: string,
  options: DeckOpOptions = {},
): DeckOpResult {
  const now = options.now ?? Date.now();

  const deck = data.decks.find((d) => d.id === deckId);
  if (!deck) return { ok: false, message: 'This deck no longer exists.' };
  if (data.decks.length <= 1) {
    return { ok: false, message: 'This is your only deck, so it cannot be deleted.' };
  }
  if (moveCardsTo === deckId) {
    return { ok: false, message: 'Choose a different deck for the cards to move to.' };
  }
  if (!data.decks.some((d) => d.id === moveCardsTo)) {
    return { ok: false, message: 'The deck to move the cards to no longer exists.' };
  }

  const cards = data.cards.map((card) =>
    card.deckId === deckId
      ? { ...card, deckId: moveCardsTo, updatedAt: touch(now, card.createdAt) }
      : card,
  );
  const decks = data.decks.filter((d) => d.id !== deckId);
  return { ok: true, data: { ...data, decks, cards } };
}

/**
 * Moves cards into another deck. Everything else about a card is left alone;
 * only `deckId` and `updatedAt` change, because a move is an edit.
 *
 * Takes a list so the same operation covers one card today and a selection later.
 */
export function moveCards(
  data: AppData,
  cardIds: readonly string[],
  toDeckId: string,
  options: DeckOpOptions = {},
): DeckOpResult {
  const now = options.now ?? Date.now();

  if (!data.decks.some((deck) => deck.id === toDeckId)) {
    return { ok: false, message: 'That deck no longer exists.' };
  }

  const wanted = new Set(cardIds);
  const present = new Set(data.cards.filter((card) => wanted.has(card.id)).map((card) => card.id));
  if (present.size !== wanted.size) {
    return {
      ok: false,
      message:
        wanted.size === 1 ? 'This card no longer exists.' : 'Some of those cards no longer exist.',
    };
  }

  let moved = 0;
  const cards = data.cards.map((card) => {
    if (!wanted.has(card.id) || card.deckId === toDeckId) return card;
    moved += 1;
    return { ...card, deckId: toDeckId, updatedAt: touch(now, card.createdAt) };
  });
  if (moved === 0) return { ok: true, data };

  return { ok: true, data: { ...data, cards } };
}
