import { cardProgressSchema, dailyActivitySchema } from '../storage/progressStore';
import { cardSchema, deckSchema } from '../storage/schemas';
import type { SyncTransport } from '../sync/engine';
import type { SyncError } from '../sync/engine';
import { classifyRpcFailure } from '../cloud/syncProtocol';
import { canonical, RECORD_KINDS, type RecordKind, type RecordTypes } from '../sync/records';
import type { PullPage, PushChange, PushResult, RemoteRecord } from '../sync/state';

/**
 * An in-memory copy of the server's sync rules (supabase/migrations), for unit
 * tests that need to fail requests at exact moments. The integration tests
 * run the same scenarios against the real database, which keeps the two honest.
 */

interface Row {
  revision: number;
  deleted: boolean;
  data: RecordTypes[RecordKind] | null;
}

const schemas = {
  deck: deckSchema,
  card: cardSchema,
  progress: cardProgressSchema,
  history: dailyActivitySchema,
};

export type FailureMode = 'network' | 'server' | 'auth';

/** The same errors the real transport raises, by way of the real classifier. */
function failure(mode: FailureMode): SyncError {
  if (mode === 'network') return classifyRpcFailure({ status: 0 });
  if (mode === 'auth') return classifyRpcFailure({ status: 401, code: 'PGRST303' });
  return classifyRpcFailure({ status: 503 });
}

export class FakeSyncServer {
  revision = 0;
  readonly rows: { [K in RecordKind]: Map<string, Row> } = {
    deck: new Map(),
    card: new Map(),
    progress: new Map(),
    history: new Map(),
  };
  pageSize = 500;
  pulls = 0;
  pushes = 0;
  pushedChanges = 0;

  /** Failures to throw before the next pulls, in order. */
  failPulls: FailureMode[] = [];
  /** Failures to throw before the next pushes, in order. */
  failPushes: FailureMode[] = [];
  /** Apply the next N pushes, then fail as if the reply was lost. */
  loseReplies = 0;

  pull(since: number): PullPage {
    const all: RemoteRecord[] = [];
    for (const kind of RECORD_KINDS) {
      for (const [id, row] of this.rows[kind]) {
        if (row.revision > since) all.push(this.toRemote(kind, id, row));
      }
    }
    all.sort((a, b) => a.revision - b.revision);
    const page = all.slice(0, this.pageSize);
    return {
      changes: page,
      cursor: page.length > 0 ? (page[page.length - 1] as RemoteRecord).revision : since,
      hasMore: all.length > this.pageSize,
    };
  }

  push(changes: readonly PushChange[]): PushResult[] {
    return changes.map((change) => this.apply(change));
  }

  transport(): SyncTransport {
    return {
      pull: async (since) => {
        await Promise.resolve();
        this.pulls += 1;
        const mode = this.failPulls.shift();
        if (mode) throw failure(mode);
        return structuredClone(this.pull(since));
      },
      push: async (changes) => {
        await Promise.resolve();
        this.pushes += 1;
        const mode = this.failPushes.shift();
        if (mode) throw failure(mode);
        this.pushedChanges += changes.length;
        const results = structuredClone(this.push(structuredClone(changes)));
        if (this.loseReplies > 0) {
          this.loseReplies -= 1;
          throw failure('network');
        }
        return results;
      },
    };
  }

  /** Live records of one kind, for checking what the server holds. */
  live<K extends RecordKind>(kind: K): RecordTypes[K][] {
    return [...this.rows[kind].values()]
      .filter((row) => !row.deleted)
      .map((row) => row.data as RecordTypes[K]);
  }

  private toRemote(kind: RecordKind, id: string, row: Row): RemoteRecord {
    return { kind, id, revision: row.revision, deleted: row.deleted, data: row.data };
  }

  private next(): number {
    this.revision += 1;
    return this.revision;
  }

  private apply(change: PushChange): PushResult {
    const { kind, id } = change;
    if (!change.deleted) {
      const parsed = schemas[kind].safeParse(change.data);
      const dataId = change.data
        ? (change.data as { id?: string; cardId?: string; day?: string })
        : {};
      const matches = (dataId.id ?? dataId.cardId ?? dataId.day) === id;
      if (!parsed.success || !matches) {
        return { kind, id, status: 'rejected', reason: 'invalid', message: 'invalid record' };
      }
    }

    const rows = this.rows[kind];
    const current = rows.get(id);
    if (change.baseRevision !== (current?.revision ?? null)) {
      const same =
        current &&
        (change.deleted
          ? current.deleted
          : !current.deleted &&
            current.data !== null &&
            change.data !== null &&
            canonical(kind, current.data) === canonical(kind, change.data));
      if (same) return { kind, id, status: 'applied', revision: current.revision };
      return {
        kind,
        id,
        status: 'conflict',
        reason: 'changed',
        current: current ? this.toRemote(kind, id, current) : null,
      };
    }

    if (change.deleted) {
      if (!current) return { kind, id, status: 'applied', revision: null };
      if (current.deleted) return { kind, id, status: 'applied', revision: current.revision };
      if (kind === 'deck' && this.live('card').some((card) => card.deckId === id)) {
        return {
          kind,
          id,
          status: 'conflict',
          reason: 'deck-not-empty',
          current: this.toRemote(kind, id, current),
        };
      }
      const row = { revision: this.next(), deleted: true, data: null };
      rows.set(id, row);
      return { kind, id, status: 'applied', revision: row.revision };
    }

    if (kind === 'card') {
      const deckId = (change.data as RecordTypes['card']).deckId;
      const deck = this.rows.deck.get(deckId);
      if (!deck || deck.deleted) {
        return {
          kind,
          id,
          status: 'conflict',
          reason: 'deck-missing',
          current: current ? this.toRemote(kind, id, current) : null,
        };
      }
    }
    if (kind === 'progress') {
      const card = this.rows.card.get(id);
      if (!card || card.deleted) {
        return {
          kind,
          id,
          status: 'conflict',
          reason: 'card-missing',
          current: current ? this.toRemote(kind, id, current) : null,
        };
      }
    }

    const row = { revision: this.next(), deleted: false, data: structuredClone(change.data) };
    rows.set(id, row);
    return { kind, id, status: 'applied', revision: row.revision };
  }
}
