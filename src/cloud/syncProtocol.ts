import { z } from 'zod';
import { cardProgressSchema, dailyActivitySchema } from '../storage/progressStore';
import { cardSchema, deckSchema } from '../storage/schemas';
import { SyncError } from '../sync/engine';
import type { PullPage, PushResult, RemoteRecord } from '../sync/state';

/**
 * The wire format of the sync API (`sync_pull` and `sync_push` in
 * supabase/migrations), checked on the way in. Data from the server is
 * validated with the same schemas as data from localStorage: a reply that
 * does not fit is refused as a whole, and nothing from it reaches the device.
 */

const kindSchema = z.enum(['deck', 'card', 'progress', 'history']);

const dataByKind = {
  deck: deckSchema,
  card: cardSchema,
  progress: cardProgressSchema,
  history: dailyActivitySchema,
} as const;

const remoteShape = z.object({
  kind: kindSchema,
  id: z.string().min(1),
  revision: z.number().int().positive(),
  deleted: z.boolean(),
  data: z.unknown(),
});

function parseRemote(value: unknown): RemoteRecord {
  const shape = remoteShape.safeParse(value);
  if (!shape.success) throw protocolError('a change in an unexpected format');
  const { kind, id, revision, deleted, data } = shape.data;
  if (deleted) return { kind, id, revision, deleted: true, data: null };
  const parsed = dataByKind[kind].safeParse(data);
  if (!parsed.success) throw protocolError(`an invalid ${kind}`);
  return { kind, id, revision, deleted: false, data: parsed.data };
}

function protocolError(what: string): SyncError {
  return new SyncError('protocol', `The server sent ${what}.`, false);
}

export function parsePullPage(json: unknown): PullPage {
  const page = z
    .object({
      changes: z.array(z.unknown()),
      cursor: z.number().int().nonnegative(),
      hasMore: z.boolean(),
    })
    .safeParse(json);
  if (!page.success) throw protocolError('a reply in an unexpected format');
  return {
    changes: page.data.changes.map(parseRemote),
    cursor: page.data.cursor,
    hasMore: page.data.hasMore,
  };
}

const resultSchema = z.discriminatedUnion('status', [
  z.object({
    kind: kindSchema,
    id: z.string(),
    status: z.literal('applied'),
    revision: z.number().int().positive().nullable(),
  }),
  z.object({
    kind: kindSchema,
    id: z.string(),
    status: z.literal('conflict'),
    reason: z.enum(['changed', 'deck-missing', 'deck-not-empty', 'card-missing']),
    current: z.unknown(),
  }),
  z.object({
    kind: kindSchema,
    id: z.string(),
    status: z.literal('rejected'),
    reason: z.string(),
    message: z.string(),
  }),
]);

export function parsePushResults(json: unknown): PushResult[] {
  const reply = z.object({ results: z.array(resultSchema) }).safeParse(json);
  if (!reply.success) throw protocolError('a reply in an unexpected format');
  return reply.data.results.map((result) =>
    result.status === 'conflict'
      ? { ...result, current: result.current == null ? null : parseRemote(result.current) }
      : result,
  );
}

export interface RpcFailure {
  status: number;
  code?: string | null;
  message?: string | null;
  hint?: string | null;
}

/**
 * Sorts a failed request into what the app can do about it: wait and retry
 * (network, server), ask the user to sign in again (auth), or stop (protocol).
 * The raw server message is kept out of the UI, which only says what to do.
 */
export function classifyRpcFailure(failure: RpcFailure): SyncError {
  const { status, code } = failure;
  if (status === 0) {
    return new SyncError('network', 'Snap Notes could not reach the server.', true);
  }
  if (
    status === 401 ||
    status === 403 ||
    code === '28000' ||
    code === '42501' ||
    code === 'PGRST301' ||
    code === 'PGRST302' ||
    code === 'PGRST303'
  ) {
    return new SyncError('auth', 'Your session has ended. Sign in again to keep syncing.', false);
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new SyncError('server', 'The sync server is busy or unavailable.', true);
  }
  return new SyncError('protocol', 'The sync server refused the request.', false);
}
