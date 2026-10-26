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
