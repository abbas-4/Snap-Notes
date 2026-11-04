import type { Card, Timestamp } from '../domain/types';

/** A short, human name for a card, for use in labels and confirmations. */
export function cardLabel(card: Pick<Card, 'term'>): string {
  const term = card.term.trim();
  if (term === '') return 'untitled card';
  return term.length > 60 ? `${term.slice(0, 60)}…` : term;
}

export function formatDate(timestamp: Timestamp): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** "You have 1 card with both…" plus a note about cards that can't be used. */
export function eligibilitySummary(total: number, eligible: number): string {
  if (total === 0) return 'You have no cards yet.';
  const left = total - eligible;
  let text = `You have ${eligible} ${eligible === 1 ? 'card' : 'cards'} with both a term and a definition.`;
  if (left > 0) {
    text += ` ${left} ${left === 1 ? 'card is' : 'cards are'} missing a term or definition and can’t be used.`;
  }
  return text;
}
