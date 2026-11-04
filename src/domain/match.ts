import { hasBothSides, textKey } from './cardText';
import type { RandomFn } from './random';
import { shuffle } from './shuffle';
import type { Card } from './types';

export type MatchSide = 'term' | 'definition';

export interface MatchTile {
  /** Unique within a round. */
  id: string;
  /** The card this tile came from. A term and a definition match when their pair IDs are equal. */
  pairId: string;
  side: MatchSide;
  text: string;
}

export interface MatchRound {
  terms: readonly MatchTile[];
  definitions: readonly MatchTile[];
}

export interface MatchOptions {
  /** Maximum pairs in a round. Defaults to 6. */
  pairCount?: number;
  random?: RandomFn;
}

export const DEFAULT_PAIR_COUNT = 6;

/** A round needs at least two pairs, or there is nothing to choose between. */
export const MIN_PAIR_COUNT = 2;

/**
 * The cards that can be used in a round: both sides have text, and no other
 * card has a term or definition that looks the same. Two tiles that read the
 * same would make a correct-looking pick count as wrong, so only the first
 * card with a given term or definition is kept.
 */
export function matchableCards(cards: readonly Card[]): Card[] {
  const ids = new Set<string>();
  const terms = new Set<string>();
  const definitions = new Set<string>();
  return cards.filter((card) => {
    if (!hasBothSides(card)) return false;
    const term = textKey(card.term);
    const definition = textKey(card.definition);
    if (ids.has(card.id) || terms.has(term) || definitions.has(definition)) return false;
    ids.add(card.id);
    terms.add(term);
    definitions.add(definition);
    return true;
  });
}

/**
 * Picks up to `pairCount` random cards and lays out their terms and
 * definitions as two separately shuffled lists. Returns null when fewer than
 * two cards can be matched.
 */
export function buildMatchRound(
  cards: readonly Card[],
  { pairCount = DEFAULT_PAIR_COUNT, random = Math.random }: MatchOptions = {},
): MatchRound | null {
  if (!Number.isInteger(pairCount) || pairCount < MIN_PAIR_COUNT) {
    throw new RangeError(`pairCount must be an integer of at least 2, got ${pairCount}`);
  }

  const usable = matchableCards(cards);
  if (usable.length < MIN_PAIR_COUNT) return null;

  const picked = shuffle(usable, random).slice(0, pairCount);
  const tiles = (side: MatchSide) =>
    picked.map((card) => ({
      id: `${side}:${card.id}`,
      pairId: card.id,
      side,
      text: side === 'term' ? card.term : card.definition,
    }));

  return {
    terms: shuffle(tiles('term'), random),
    definitions: shuffle(tiles('definition'), random),
  };
}
