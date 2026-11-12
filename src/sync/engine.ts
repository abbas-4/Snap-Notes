import { createId } from '../domain/ids';
import type { Timestamp } from '../domain/types';
import {
  acknowledge,
  applyRemote,
  cloneBase,
  currentRejections,
  pendingChanges,
  rejection,
} from './changes';
import type { ConflictDraft } from './merge';
import { planLink, type LinkChoice, type LinkReport } from './link';
import { recordsFromSnapshot, snapshotFromRecords, type LocalSnapshot } from './records';
import {
  addConflicts,
  createSyncState,
  type PullPage,
  type PushChange,
  type PushResult,
  type RemoteRecord,
  type SyncConflict,
  type SyncState,
} from './state';

/**
 * Runs one synchronisation: download what changed on the server, merge it
 * into this device's data, then upload what changed here.
 *
 * The engine knows nothing about React, Supabase or localStorage. It talks to
 * the server through a `SyncTransport` and to this device's data through a
 * `LocalStore`, which is what lets it be tested against real and failing
 * servers alike.
 *
 * Every step is safe to interrupt. Local data is written before the sync
 * state that describes it, so if the page closes between the two, the next run
 * sees the same server changes again, finds them already applied, and moves
 * on. Uploads are idempotent on the server. Nothing is ever deleted locally
 * because a request failed.
 */

export type SyncErrorKind =
  /** The server could not be reached. */
  | 'network'
  /** The session is missing, expired or revoked. */
  | 'auth'
  /** The server failed or asked us to slow down. */
  | 'server'
  /** The server's reply was not what this version of the app expects. */
  | 'protocol'
  /** This device could not save the result. */
  | 'local'
  /** The server's data was mid-change; trying again shortly will finish the job. */
  | 'incomplete';

export class SyncError extends Error {
  readonly kind: SyncErrorKind;
  /** Whether trying again later may succeed without the user doing anything. */
  readonly retryable: boolean;

  constructor(kind: SyncErrorKind, message: string, retryable: boolean) {
    super(message);
    this.name = 'SyncError';
    this.kind = kind;
    this.retryable = retryable;
  }
}

export interface SyncTransport {
  pull(since: number): Promise<PullPage>;
  push(changes: readonly PushChange[]): Promise<PushResult[]>;
}

export interface LocalStore {
  /** This device's data as it is right now. */
  read(): LocalSnapshot;
  /** Saves new data for this device, or explains why it could not. */
  write(next: LocalSnapshot): { ok: true } | { ok: false; message: string };
}

export interface SyncContext {
  transport: SyncTransport;
  local: LocalStore;
  /** Persists the sync state; returns false when it could not be saved. */
  saveState(state: SyncState): boolean;
  now?: () => Timestamp;
  /** For tests: smaller batches exercise the batching. */
  batchSize?: number;
}

export interface SyncRunResult {
  state: SyncState;
  downloaded: number;
  uploaded: number;
  conflicts: SyncConflict[];
  /** Changes still waiting, such as edits made while this run was uploading. */
  pending: number;
}

/** Upload at most this many changes per request. */
export const PUSH_BATCH_SIZE = 200;

/** A pull, push, merge round is repeated at most this often in one run. */
const MAX_ROUNDS = 4;

/** Reads every server change after `since`, page by page. */
export async function pullAll(
  transport: SyncTransport,
  since: number,
): Promise<{ records: RemoteRecord[]; cursor: number }> {
  const records: RemoteRecord[] = [];
  let cursor = since;
  for (;;) {
    const page = await transport.pull(cursor);
    if (page.cursor < cursor) {
      throw new SyncError('protocol', 'The server went back in time.', false);
    }
    records.push(...page.changes);
    if (!page.hasMore) return { records, cursor: page.cursor };
    if (page.cursor === cursor) {
      throw new SyncError('protocol', 'The server sent an empty page.', false);
    }
    cursor = page.cursor;
  }
}

function materialize(drafts: readonly ConflictDraft[], now: Timestamp): SyncConflict[] {
  return drafts.map((draft) => ({ ...draft, id: createId(), detectedAt: now }));
}

function save(context: SyncContext, state: SyncState): void {
  if (!context.saveState(state)) {
    throw new SyncError(
      'local',
      'Sync progress could not be saved in this browser. Browser storage may be full.',
      false,
    );
  }
}

/**
 * Merges server records into this device's data and saves both. Returns the
 * new state and the conflicts it found.
 */
function applyAndCommit(
  context: SyncContext,
  state: SyncState,
  records: readonly RemoteRecord[],
  cursor: number,
  now: Timestamp,
): { state: SyncState; conflicts: SyncConflict[]; changed: boolean } {
  const snapshot = context.local.read();
  const outcome = applyRemote(recordsFromSnapshot(snapshot), state.base, records);
  if (outcome.missingDecks.length > 0) {
    throw new SyncError(
      'incomplete',
      'Some cards arrived before their deck. The next sync will finish the job.',
      true,
    );
  }
  if (outcome.changed) {
    const written = context.local.write(snapshotFromRecords(outcome.sets, snapshot));
    if (!written.ok) throw new SyncError('local', written.message, false);
  }
  const conflicts = materialize(outcome.conflicts, now);
  const next: SyncState = {
    ...state,
    base: outcome.base,
    cursor,
    conflicts: addConflicts(state.conflicts, conflicts),
  };
  save(context, next);
  return { state: next, conflicts, changed: outcome.changed };
}

function pendingFor(
  context: SyncContext,
  state: SyncState,
): {
  pending: PushChange[];
  state: SyncState;
} {
  const sets = recordsFromSnapshot(context.local.read());
  const rejected = currentRejections(state.rejected, pendingChanges(sets, state.base));
  const next = rejected.length === state.rejected.length ? state : { ...state, rejected };
  return { pending: pendingChanges(sets, next.base, next.rejected), state: next };
}

function checkResults(batch: readonly PushChange[], results: readonly PushResult[]): void {
  const matches =
    results.length === batch.length &&
    results.every(
      (result, index) => result.kind === batch[index]?.kind && result.id === batch[index]?.id,
    );
  if (!matches) {
    throw new SyncError('protocol', 'The server replied about different changes.', false);
  }
}

export async function runSync(context: SyncContext, start: SyncState): Promise<SyncRunResult> {
  const now = context.now ?? Date.now;
  const batchSize = context.batchSize ?? PUSH_BATCH_SIZE;
  let state = start;
  let downloaded = 0;
  let uploaded = 0;
  const conflicts: SyncConflict[] = [];

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    // 1. Download.
    const pulled = await pullAll(context.transport, state.cursor);
    if (pulled.records.length > 0) {
      const applied = applyAndCommit(context, state, pulled.records, pulled.cursor, now());
      state = applied.state;
      conflicts.push(...applied.conflicts);
      downloaded += pulled.records.length;
    } else if (pulled.cursor !== state.cursor) {
      state = { ...state, cursor: pulled.cursor };
      save(context, state);
    }

    // 2. Upload.
    const waiting = pendingFor(context, state);
    state = waiting.state;
    if (waiting.pending.length === 0) break;

    const returned: RemoteRecord[] = [];
    let mustPull = false;
    for (let offset = 0; offset < waiting.pending.length; offset += batchSize) {
      const batch = waiting.pending.slice(offset, offset + batchSize);
      const results = await context.transport.push(batch);
      checkResults(batch, results);

      const base = cloneBase(state.base);
      const rejected = [...state.rejected];
      batch.forEach((change, index) => {
        const result = results[index] as PushResult;
        if (result.status === 'applied') {
          acknowledge(base, change, result.revision);
          uploaded += 1;
        } else if (result.status === 'conflict') {
          if (result.current) returned.push(result.current);
          // The server no longer has a record this device thought it had.
          else if (change.baseRevision !== null) acknowledge(base, change, null);
          if (result.reason !== 'changed') mustPull = true;
        } else {
          rejected.push(rejection(change, result.message, now()));
        }
      });
      // Saved after every batch, so an upload cut short resumes where it stopped.
      state = { ...state, base, rejected };
      save(context, state);
    }

    // 3. Merge what the server had instead, then go round again to upload it.
    if (returned.length > 0) {
      const applied = applyAndCommit(context, state, returned, state.cursor, now());
      state = applied.state;
      conflicts.push(...applied.conflicts);
    }
    if (returned.length === 0 && !mustPull && pendingFor(context, state).pending.length === 0) {
      break;
    }
  }

  const remaining = pendingFor(context, state);
  state = { ...remaining.state, lastSyncedAt: now() };
  save(context, state);
  return { state, downloaded, uploaded, conflicts, pending: remaining.pending.length };
}

export interface LinkResult {
  state: SyncState;
  report: LinkReport;
}

/**
 * Links this device to an account for the first time (or to a different
 * account), combining its data with the account's as `choice` says, and saves
 * the result. Uploading is left to the next `runSync`, so an interrupted link
 * resumes like any other sync.
 */
export async function linkAccount(
  context: SyncContext,
  account: { userId: string; email: string | null },
  choice: LinkChoice,
): Promise<LinkResult> {
  const now = context.now ?? Date.now;
  const pulled = await pullAll(context.transport, 0);
  const local = context.local.read();
  const planned = planLink(local, pulled.records, choice, now());
  if (!planned.ok) throw new SyncError('local', planned.message, false);

  const { plan } = planned;
  const written = context.local.write(plan.snapshot);
  if (!written.ok) throw new SyncError('local', written.message, false);

  const state: SyncState = {
    ...createSyncState(account.userId, account.email, now()),
    base: plan.base,
    cursor: pulled.cursor,
    conflicts: materialize(plan.conflicts, now()),
  };
  save(context, state);
  return { state, report: plan.report };
}
