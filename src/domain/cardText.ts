import type { Card } from './types';

/**
 * A comparison key for card text. Two texts that differ only by case or
 * spacing look identical on screen, so they share a key.
 */
export function textKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** True when both the term and the definition have visible text. */
export function hasBothSides(card: Pick<Card, 'term' | 'definition'>): boolean {
  return card.term.trim() !== '' && card.definition.trim() !== '';
}
