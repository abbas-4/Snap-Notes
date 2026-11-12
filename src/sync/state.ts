import type { Card, Deck, Timestamp } from '../domain/types';
import type { RecordKind, RecordTypes } from './records';

/**
 * What this device remembers about the cloud copy of the user's data.
 *
 * The central idea: for every record, the device keeps the last version it
 * knows the server holds (the *base*), with the server's revision number for
 * it. A record whose local version differs from its base is a change waiting
 * to be uploaded. There is no separate queue of edits that could get out of
 * step with the data: the pending changes are always exactly the difference
 * between what is here and what the server last confirmed. That makes them
 * survive a refresh, collapse repeated edits into one upload, and recover
 * cleanly from a sync that was cut off half way.
 */

/** The server's version of one record. `data` is null when it was deleted there. */
export interface BaseEntry<T> {
  revision: number;
  data: T | null;
}

export type BaseSets = { [K in RecordKind]: Record<string, BaseEntry<RecordTypes[K]>> };

export function emptyBaseSets(): BaseSets {
  return { deck: {}, card: {}, progress: {}, history: {} };
}

/**
 * A change that could not be merged without choosing between two versions.
 * The version not chosen is kept here so the user can still restore it.
 */
export interface SyncConflict {
  /** Unique, for the UI. */
  id: string;
  kind: 'deck' | 'card';
  recordId: string;
  detectedAt: Timestamp;
  /**
   * - `both-changed`: edited on two devices; the later edit was kept.
   * - `deleted-here`: deleted on this device but edited on another, so it was kept.
   * - `deleted-elsewhere`: deleted on another device but edited here, so it was kept.
   * - `linked`: this browser and the account both had a version when they were joined.
   */
  reason: 'both-changed' | 'deleted-here' | 'deleted-elsewhere' | 'linked';
  /** The version now in use. */
  kept: Deck | Card | null;
  /** The version that was not used, which can still be restored. */
  other: Deck | Card | null;
}

/** A change the server refused as invalid. It is not sent again until it changes. */
export interface RejectedChange {
  kind: RecordKind;
  id: string;
  message: string;
  at: Timestamp;
  /** The content that was refused. */
  fingerprint: string;
}

export interface SyncState {
  version: 1;
  /** The account this device's data is linked to. */
  userId: string;
  /** The account's email when it was linked, to name it if someone else signs in. */
  email: string | null;
  /** Every server change up to this revision has been applied here. */
  cursor: number;
  lastSyncedAt: Timestamp | null;
  linkedAt: Timestamp;
  base: BaseSets;
  conflicts: SyncConflict[];
  rejected: RejectedChange[];
}

/** At most this many conflicts are kept, newest first. */
export const MAX_CONFLICTS = 200;

export function createSyncState(userId: string, email: string | null, now: Timestamp): SyncState {
  return {
    version: 1,
    userId,
    email,
    cursor: 0,
    lastSyncedAt: null,
    linkedAt: now,
    base: emptyBaseSets(),
    conflicts: [],
    rejected: [],
  };
}

/** A change to upload. `baseRevision` is the server revision it was made on top of. */
export interface PushChange {
  kind: RecordKind;
  id: string;
  baseRevision: number | null;
  deleted: boolean;
  data: RecordTypes[RecordKind] | null;
}

/** A record as the server sends it. Tombstones have `deleted: true` and no data. */
export interface RemoteRecord {
  kind: RecordKind;
  id: string;
  revision: number;
  deleted: boolean;
  data: RecordTypes[RecordKind] | null;
}

export interface PullPage {
  changes: RemoteRecord[];
  cursor: number;
  hasMore: boolean;
}

export type PushResult =
  | { kind: RecordKind; id: string; status: 'applied'; revision: number | null }
  | {
      kind: RecordKind;
      id: string;
      status: 'conflict';
      reason: 'changed' | 'deck-missing' | 'deck-not-empty' | 'card-missing';
      current: RemoteRecord | null;
    }
  | { kind: RecordKind; id: string; status: 'rejected'; reason: string; message: string };

export function addConflicts(
  existing: readonly SyncConflict[],
  added: readonly SyncConflict[],
): SyncConflict[] {
  return [...added, ...existing].slice(0, MAX_CONFLICTS);
}
