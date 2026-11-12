import { useSearchParams } from 'react-router';
import type { ReviewMode } from '../domain/reviewQueue';
import type { Card, Deck } from '../domain/types';
import { useAppData } from './appData';

/** The query parameter that narrows a page to one deck, as in `/study?deck=biology`. */
export const DECK_PARAM = 'deck';

export interface DeckScope {
  /** The deck named by `?deck=`, or undefined when the URL names none. */
  deck: Deck | undefined;
  /** The raw `?deck=` value, or null when there is none. */
  deckId: string | null;
  /** True when `?deck=` names a deck that no longer exists. */
  unknownDeck: boolean;
  /** The cards in scope: one deck's cards, or every card when the URL names no deck. */
  cards: Card[];
}

/**
 * Reads `?deck=<id>` and narrows the collection to that deck.
 *
 * Every page keeps working without the parameter, which is how the navigation
 * and the old `#study:<id>` links still reach "all my cards". A parameter
 * naming a deck that has since been deleted scopes to nothing and says so,
 * rather than quietly falling back to the whole collection.
 */
export function useDeckScope(): DeckScope {
  const { data } = useAppData();
  const deckId = useSearchParams()[0].get(DECK_PARAM);

  if (deckId === null)
    return { deck: undefined, deckId: null, unknownDeck: false, cards: data.cards };

  const deck = data.decks.find((d) => d.id === deckId);
  if (!deck) return { deck: undefined, deckId, unknownDeck: true, cards: [] };

  return {
    deck,
    deckId,
    unknownDeck: false,
    cards: data.cards.filter((card) => card.deckId === deckId),
  };
}

/** A link into a review session, carrying the deck in scope when there is one. */
export function reviewLink(mode: ReviewMode, deckId: string | null): string {
  const params = new URLSearchParams({ mode });
  if (deckId !== null) params.set(DECK_PARAM, deckId);
  return `/review?${params.toString()}`;
}

/** Appends `?deck=<id>` to a path, or leaves it alone when nothing is in scope. */
export function withDeck(path: string, deckId: string | null): string {
  return deckId === null ? path : `${path}?${DECK_PARAM}=${encodeURIComponent(deckId)}`;
}
