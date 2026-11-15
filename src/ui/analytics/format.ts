import type { Granularity } from '../../domain/analytics';
import { daysBetween } from '../../domain/srs';
import type { StudyMode } from '../../domain/studySessions';
import type { Timestamp } from '../../domain/types';

/** Wording shared by the Analytics page, so every section says things the same way. */

export const MODE_LABELS: Record<StudyMode, string> = {
  review: 'Review',
  quiz: 'Quiz',
  learn: 'Learn',
  match: 'Match',
};

export function count(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** A share from 0 to 1 as a whole percentage, or a dash when there is none. */
export function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

/** A change in accuracy, such as "+6 pts". */
export function points(change: number): string {
  const rounded = Math.round(change * 100);
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(rounded)} pts`;
}

/** Study time: "0 min", "45 min", "2 h 5 min". */
export function studyTime(ms: number): string {
  const minutes = Math.round(Math.max(0, ms) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** A response time: "4.2 s". */
export function seconds(ms: number): string {
  const value = Math.max(0, ms) / 1000;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} s`;
}

export function shortDate(at: Timestamp): string {
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function longDate(at: Timestamp): string {
  return new Date(at).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function timeOfDay(at: Timestamp): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "today", "yesterday", "3 days ago", or a date further back. */
export function daysAgo(at: Timestamp, now: Timestamp): string {
  const days = daysBetween(at, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return `on ${new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/** A chart bucket's short axis label. */
export function bucketLabel(start: Timestamp, granularity: Granularity): string {
  if (granularity === 'month') {
    return new Date(start).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }
  return shortDate(start);
}

/** A chart bucket's full name, for tooltips and the table view. */
export function bucketName(start: Timestamp, end: Timestamp, granularity: Granularity): string {
  if (granularity === 'day') return longDate(start);
  if (granularity === 'month') {
    return new Date(start).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  return `${shortDate(start)} – ${shortDate(end)}`;
}
