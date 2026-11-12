import type { Deck } from '../domain/types';
import { mergeRecord, type ConflictDraft } from './merge';
import {
  canonical,
  cleanRecord,
  RECORD_KINDS,
  sameRecord,
  type RecordKind,
  type RecordSets,
  type RecordTypes,
} from './records';
import type { BaseEntry, BaseSets, PushChange, RejectedChange, RemoteRecord } from './state';

/** Pure functions that move records between this device and its picture of the server. */

export function cloneSets(sets: RecordSets): RecordSets {
  return {
    deck: new Map(sets.deck),
    card: new Map(sets.card),
    progress: new Map(sets.progress),
    history: new Map(sets.history),
  };
}

export function cloneBase(base: BaseSets): BaseSets {
  return {
    deck: { ...base.deck },
    card: { ...base.card },
    progress: { ...base.progress },
    history: { ...base.history },
  };
}

function getBase<K extends RecordKind>(
  base: BaseSets,
  kind: K,
  id: string,
): BaseEntry<RecordTypes[K]> | undefined {
  return Object.hasOwn(base[kind], id) ? (base[kind][id] as BaseEntry<RecordTypes[K]>) : undefined;
}

function setBase<K extends RecordKind>(
  base: BaseSets,
  kind: K,
  id: string,
  entry: BaseEntry<RecordTypes[K]> | undefined,
): void {
  const entries = base[kind] as Record<string, BaseEntry<RecordTypes[K]>>;
  if (entry === undefined) delete entries[id];
  else entries[id] = entry;
}

function setLocal<K extends RecordKind>(
  sets: RecordSets,
  kind: K,
  id: string,
  value: RecordTypes[K] | null,
): void {
  const map = sets[kind] as Map<string, RecordTypes[K]>;
  if (value === null) map.delete(id);
  else map.set(id, value);
}

export interface ApplyOutcome {
  sets: RecordSets;
  base: BaseSets;
  conflicts: ConflictDraft[];
  /** Whether anything stored on this device changed. */
  changed: boolean;
  /**
   * Decks that live cards point at but that are not known anywhere yet. The
   * result must not be saved: the next pull will bring the deck.
   */
  missingDecks: string[];
}

/**
 * Applies records from the server to the records on this device.
 *
 * - A record with no local change since its base simply takes the server's version.
 * - A record changed here but not there keeps the local version.
 * - A record changed on both sides is merged (see `mergeRecord`).
 *
 * The base moves to the server's version in every case, so a merged result
 * becomes a change to upload on top of what the server now holds.
 */
export function applyRemote(
  local: RecordSets,
  base: BaseSets,
  remote: readonly RemoteRecord[],
): ApplyOutcome {
  const sets = cloneSets(local);
  const nextBase = cloneBase(base);
  const conflicts: ConflictDraft[] = [];
  let changed = false;

  // A pull can list a record more than once only across pages; the newest wins.
  const newest = new Map<string, RemoteRecord>();
  for (const record of remote) {
    const key = `${record.kind}:${record.id}`;
    const seen = newest.get(key);
    if (!seen || record.revision > seen.revision) newest.set(key, record);
  }

  for (const record of [...newest.values()].sort((a, b) => a.revision - b.revision)) {
    const { kind, id } = record;
    const entry = getBase(nextBase, kind, id);
    // Already known: typically this device's own upload coming back.
    if (entry && record.revision <= entry.revision) continue;

    const before = sets[kind].get(id) ?? null;
    const shared = entry?.data ?? null;
    const theirs = record.deleted || record.data === null ? null : cleanRecord(kind, record.data);

    let value: RecordTypes[typeof kind] | null;
    if (sameRecord(kind, before, shared)) {
      value = theirs;
    } else if (sameRecord(kind, before, theirs)) {
      value = before;
    } else {
      const merged = mergeRecord(kind, shared, before, theirs, id);
      value = merged.value;
      if (merged.conflict) conflicts.push(merged.conflict);
    }

    if (!sameRecord(kind, before, value)) {
      setLocal(sets, kind, id, value);
      changed = true;
    }
    setBase(nextBase, kind, id, { revision: record.revision, data: theirs });
  }

  // A live card always needs a live deck. A deck deleted on one device while
  // cards were added to it on another comes back, so the cards stay visible.
  const missingDecks: string[] = [];
  for (const card of sets.card.values()) {
    if (sets.deck.has(card.deckId)) continue;
    const restored: Deck | null =
      local.deck.get(card.deckId) ?? getBase(base, 'deck', card.deckId)?.data ?? null;
    if (restored) {
      sets.deck.set(card.deckId, restored);
      changed = true;
      conflicts.push({
        kind: 'deck',
        recordId: card.deckId,
        reason: local.deck.has(card.deckId) ? 'deleted-elsewhere' : 'deleted-here',
        kept: restored,
        other: null,
      });
    } else if (!missingDecks.includes(card.deckId)) {
      missingDecks.push(card.deckId);
    }
  }

  return { sets, base: nextBase, conflicts, changed, missingDecks };
}

function fingerprint(change: PushChange): string {
  return change.deleted || change.data === null ? 'deleted' : canonical(change.kind, change.data);
}

/**
 * Upload order: decks before the cards in them, cards before their progress,
 * and deleted decks last, after their cards have moved out.
 */
function uploadRank(change: PushChange): number {
  switch (change.kind) {
    case 'deck':
      return change.deleted ? 5 : 0;
    case 'card':
      return change.deleted ? 2 : 1;
    case 'progress':
      return 3;
    default:
      return 4;
  }
}

/**
 * Every change on this device that the server has not confirmed: records that
 * differ from their base, records the server has never seen, and records
 * deleted here that are still live there.
 *
 * Changes the server refused are left out until their content changes, so an
 * invalid record is not sent over and over.
 */
export function pendingChanges(
  sets: RecordSets,
  base: BaseSets,
  rejected: readonly RejectedChange[] = [],
): PushChange[] {
  const changes: PushChange[] = [];
  for (const kind of RECORD_KINDS) {
    for (const [id, value] of sets[kind] as Map<string, RecordTypes[RecordKind]>) {
      const entry = getBase(base, kind, id);
      if (entry && sameRecord(kind, value, entry.data)) continue;
      changes.push({
        kind,
        id,
        baseRevision: entry?.revision ?? null,
        deleted: false,
        data: cleanRecord(kind, value),
      });
    }
    for (const [id, entry] of Object.entries(base[kind])) {
      if (entry.data !== null && !sets[kind].has(id)) {
        changes.push({ kind, id, baseRevision: entry.revision, deleted: true, data: null });
      }
    }
  }

  const refused = new Map(rejected.map((r) => [`${r.kind}:${r.id}`, r.fingerprint]));
  return changes
    .filter((change) => refused.get(`${change.kind}:${change.id}`) !== fingerprint(change))
    .sort((a, b) => uploadRank(a) - uploadRank(b));
}

/** Records that the server now holds `change` at `revision`. */
export function acknowledge(base: BaseSets, change: PushChange, revision: number | null): void {
  if (revision === null) {
    setBase(base, change.kind, change.id, undefined);
    return;
  }
  setBase(base, change.kind, change.id, {
    revision,
    data: change.deleted ? null : change.data,
  });
}

export function rejection(change: PushChange, message: string, at: number): RejectedChange {
  return { kind: change.kind, id: change.id, message, at, fingerprint: fingerprint(change) };
}

/**
 * Keeps only the rejections that still apply: the record is still waiting to
 * upload, with exactly the content that was refused. Pass every pending
 * change, including refused ones (`pendingChanges(sets, base)`).
 */
export function currentRejections(
  rejected: readonly RejectedChange[],
  allPending: readonly PushChange[],
): RejectedChange[] {
  const waiting = new Map(allPending.map((c) => [`${c.kind}:${c.id}`, fingerprint(c)]));
  return rejected.filter((r) => waiting.get(`${r.kind}:${r.id}`) === r.fingerprint);
}
