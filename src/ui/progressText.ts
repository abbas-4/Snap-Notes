import { daysBetween } from '../domain/srs';
import type { Timestamp } from '../domain/types';

/** Shared wording for progress, so the dashboard, the decks and the card list agree. */

export function cardsLabel(count: number): string {
  return `${count} ${count === 1 ? 'card' : 'cards'}`;
}

export function reviewsLabel(count: number): string {
  return `${count} ${count === 1 ? 'review' : 'reviews'}`;
}

/** A share from 0 to 1 as a whole percentage, such as "86%". */
export function percent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  return `${Math.round(Math.min(1, value) * 100)}%`;
}

/** "today", "tomorrow", "in 4 days", or a date further out. */
export function relativeDay(at: Timestamp, now: Timestamp): string {
  const days = daysBetween(now, at);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days <= 6) return `in ${days} days`;
  return `on ${new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/** The weekday letter used under each bar of the activity chart. */
export function weekdayLabel(at: Timestamp): string {
  return new Date(at).toLocaleDateString(undefined, { weekday: 'short' });
}

/** A full date for the title of an activity bar. */
export function fullDate(at: Timestamp): string {
  return new Date(at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
