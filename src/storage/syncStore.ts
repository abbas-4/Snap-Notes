import { z } from 'zod';
import { RECORD_KINDS, type RecordKind } from '../sync/records';
import type { SyncState } from '../sync/state';
import { cardProgressSchema, dailyActivitySchema } from './progressStore';
import { cardSchema, deckSchema } from './schemas';

/**
 * Where this device keeps what it knows about the cloud copy: which account it
 * is linked to, how far it has read the server's changes, and the last
 * version of each record the server confirmed (see `src/sync/state.ts`).
 *
 * Kept under its own key, apart from the cards and the progress, so a problem
 * here can never cost the user a card. Losing it is safe: the device simply
 * links to the account again, and records that match by ID or content are
 * recognised rather than duplicated.
 */

/** Namespaced, because every project on the same origin shares one localStorage. */
export const SYNC_STORAGE_KEY = 'snapnotes.sync.v1';

const revisionSchema = z.number().int().nonnegative();

function baseEntries<T extends z.ZodType>(data: T) {
  return z.record(z.string(), z.object({ revision: revisionSchema, data: data.nullable() }));
}

const dataSchemas = {
  deck: deckSchema,
  card: cardSchema,
  progress: cardProgressSchema,
  history: dailyActivitySchema,
} as const;

const recordSchema = z.union([deckSchema, cardSchema]);

const syncStateSchema = z.object({
  version: z.literal(1),
  userId: z.string().min(1),
  email: z.string().nullable(),
  cursor: revisionSchema,
  lastSyncedAt: z.number().int().positive().nullable(),
  linkedAt: z.number().int().positive(),
  base: z.object({
    deck: baseEntries(dataSchemas.deck),
    card: baseEntries(dataSchemas.card),
    progress: baseEntries(dataSchemas.progress),
    history: baseEntries(dataSchemas.history),
  }),
  conflicts: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['deck', 'card']),
      recordId: z.string(),
      detectedAt: z.number().int().positive(),
      reason: z.enum(['both-changed', 'deleted-here', 'deleted-elsewhere', 'linked']),
      kept: recordSchema.nullable(),
      other: recordSchema.nullable(),
    }),
  ),
  rejected: z.array(
    z.object({
      kind: z.enum(RECORD_KINDS as unknown as [RecordKind, ...RecordKind[]]),
      id: z.string(),
      message: z.string(),
      at: z.number().int().positive(),
      fingerprint: z.string(),
    }),
  ),
});

export type SyncStateLoad =
  | { ok: true; state: SyncState | null }
  /** Stored but unreadable. Treated as not linked; the next link recognises existing records. */
  | { ok: false; error: 'corrupt' | 'unavailable'; message: string };

export function loadSyncState(storage: Storage | null): SyncStateLoad {
  if (!storage)
    return { ok: false, error: 'unavailable', message: 'Browser storage is not available.' };
  let raw: string | null;
  try {
    raw = storage.getItem(SYNC_STORAGE_KEY);
  } catch (error) {
    return { ok: false, error: 'unavailable', message: String(error) };
  }
  if (raw === null) return { ok: true, state: null };

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'corrupt', message: 'Saved sync information is not valid JSON.' };
  }
  const parsed = syncStateSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: 'corrupt', message: 'Saved sync information could not be read.' };
  }
  return { ok: true, state: parsed.data as SyncState };
}

/** Saves the sync state and confirms it landed. Never touches cards or progress. */
export function saveSyncState(storage: Storage | null, state: SyncState): boolean {
  if (!storage) return false;
  const serialized = JSON.stringify(state);
  try {
    storage.setItem(SYNC_STORAGE_KEY, serialized);
    return storage.getItem(SYNC_STORAGE_KEY) === serialized;
  } catch {
    return false;
  }
}

/** Forgets the link to an account. The cards and progress on this device stay. */
export function clearSyncState(storage: Storage | null): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(SYNC_STORAGE_KEY);
    return storage.getItem(SYNC_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}
