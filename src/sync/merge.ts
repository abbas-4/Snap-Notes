import type { DailyActivity } from '../domain/progressStats';
import type { CardProgress } from '../domain/srs';
import type { Card, Deck } from '../domain/types';
import { sameRecord, type RecordKind, type RecordTypes } from './records';
import type { SyncConflict } from './state';

/**
 * How two versions of one record are combined when both have changed since
 * the version they share (the *base*).
 *
 * The rules, in order:
 *
 * 1. If only one side changed, that side wins. If both made the same change,
 *    there is nothing to decide.
 * 2. **Editing beats deleting.** A record deleted on one device but edited on
 *    another is kept, with the edit, so a deletion can never silently destroy
 *    work done elsewhere. The user is told, and can delete it again.
 * 3. **Decks and cards merge field by field.** An edit to a card's term on one
 *    device and to its definition on another both survive. Only when the
 *    *same* field was changed to different values on both does one have to be
 *    chosen: the more recent edit wins, and the other version is kept as a
 *    conflict the user can restore.
 * 4. **Learning progress adds up.** Reviews made on two devices are both
 *    counted (each device's reviews since the shared version are added
 *    together), and the schedule comes from whichever device reviewed the card
 *    most recently, because that answer is the best guide to when it is next
 *    due. With no shared version to count from, the larger count is used, so
 *    reviews are never counted twice.
 * 5. The day-by-day review log adds up the same way.
 *
 * Detection never depends on device clocks: the server's revision numbers
 * decide whether a record changed. Clocks are consulted only to choose between
 * two edits to the same field, and the losing edit is kept either way.
 */

export type ConflictDraft = Omit<SyncConflict, 'id' | 'detectedAt'>;

export interface MergeOutcome<T> {
  /** The merged record, or null when it stays deleted. */
  value: T | null;
  /** Set when a version had to be set aside; the user can review it. */
  conflict: ConflictDraft | null;
}

export function mergeRecord<K extends RecordKind>(
  kind: K,
  base: RecordTypes[K] | null,
  local: RecordTypes[K] | null,
  remote: RecordTypes[K] | null,
  recordId: string,
): MergeOutcome<RecordTypes[K]> {
  if (sameRecord(kind, local, remote)) return { value: remote, conflict: null };
  if (sameRecord(kind, local, base)) return { value: remote, conflict: null };
  if (sameRecord(kind, remote, base)) return { value: local, conflict: null };

  if (local === null || remote === null) {
    // One side deleted it and the other changed it: the change wins.
    const value = local ?? remote;
    const reportable = kind === 'deck' || kind === 'card';
    return {
      value,
      conflict: reportable
        ? {
            kind: kind as 'deck' | 'card',
            recordId,
            reason: local === null ? 'deleted-here' : 'deleted-elsewhere',
            kept: value as Deck | Card,
            other: null,
          }
        : null,
    };
  }

  switch (kind) {
    case 'deck':
      return mergeFields(
        'deck',
        base as Deck | null,
        local as Deck,
        remote as Deck,
        ['name'],
        recordId,
      ) as MergeOutcome<RecordTypes[K]>;
    case 'card':
      return mergeFields(
        'card',
        base as Card | null,
        local as Card,
        remote as Card,
        ['deckId', 'term', 'definition'],
        recordId,
      ) as MergeOutcome<RecordTypes[K]>;
    case 'progress':
      return {
        value: mergeProgress(
          base as CardProgress | null,
          local as CardProgress,
          remote as CardProgress,
        ),
        conflict: null,
      } as MergeOutcome<RecordTypes[K]>;
    default:
      return {
        value: mergeHistory(
          base as DailyActivity | null,
          local as DailyActivity,
          remote as DailyActivity,
        ),
        conflict: null,
      } as MergeOutcome<RecordTypes[K]>;
  }
}

function mergeFields<T extends Deck | Card>(
  kind: 'deck' | 'card',
  base: T | null,
  local: T,
  remote: T,
  fields: readonly (keyof T)[],
  recordId: string,
): MergeOutcome<T> {
  // Only the timestamps differ: the server's version stands, so nothing is
  // uploaded just because two devices created the same record at different times.
  if (fields.every((field) => local[field] === remote[field])) {
    return { value: remote, conflict: null };
  }

  // The later edit wins a field both sides changed. On a tie the server's
  // version wins, so every device makes the same choice.
  const winner = local.updatedAt > remote.updatedAt ? local : remote;
  const loser = winner === local ? remote : local;

  const merged = { ...remote };
  let conflicting = false;
  for (const field of fields) {
    const l = local[field];
    const r = remote[field];
    if (l === r) continue;
    if (base && l === base[field]) {
      merged[field] = r;
    } else if (base && r === base[field]) {
      merged[field] = l;
    } else {
      conflicting = true;
      merged[field] = winner[field];
    }
  }
  merged.createdAt = Math.min(local.createdAt, remote.createdAt);
  merged.updatedAt = Math.max(local.updatedAt, remote.updatedAt, merged.createdAt);

  return {
    value: merged,
    conflict: conflicting
      ? { kind, recordId, reason: base ? 'both-changed' : 'linked', kept: merged, other: loser }
      : null,
  };
}

/** Reviews made on each side since the shared version, added together. */
function combineCount(base: number | undefined, local: number, remote: number): number {
  if (base === undefined) return Math.max(local, remote);
  return Math.max(local, remote, local + remote - base);
}

export function mergeProgress(
  base: CardProgress | null,
  local: CardProgress,
  remote: CardProgress,
): CardProgress {
  let schedule: CardProgress;
  if (local.lastReviewedAt !== remote.lastReviewedAt) {
    schedule = local.lastReviewedAt > remote.lastReviewedAt ? local : remote;
  } else {
    schedule = local.reviews > remote.reviews ? local : remote;
  }
  const correct = combineCount(base?.correct, local.correct, remote.correct);
  const incorrect = combineCount(base?.incorrect, local.incorrect, remote.incorrect);
  const reviews = Math.max(
    combineCount(base?.reviews, local.reviews, remote.reviews),
    correct + incorrect,
  );
  return { ...schedule, reviews, correct, incorrect };
}

export function mergeHistory(
  base: DailyActivity | null,
  local: DailyActivity,
  remote: DailyActivity,
): DailyActivity {
  const correct = combineCount(base?.correct, local.correct, remote.correct);
  const reviews = Math.max(combineCount(base?.reviews, local.reviews, remote.reviews), correct);
  return { day: remote.day, reviews, correct };
}
