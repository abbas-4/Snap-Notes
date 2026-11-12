import type { DailyActivity } from '../domain/progressStats';
import type { CardProgress } from '../domain/srs';
import { SCHEMA_VERSION, type AppData, type Card, type Deck } from '../domain/types';
import {
  normalizeHistory,
  PROGRESS_VERSION,
  reconcileProgress,
  type ProgressData,
} from '../storage/progressStore';

/**
 * The records that sync between devices.
 *
 * Everything the app keeps is split into four kinds of record, each with a
 * stable ID: decks and cards (by their own IDs), learning progress (by the
 * card it belongs to) and the review log (by day). Each kind is synced on its
 * own, so a review on one device and an edit to the same card on another never
 * get in each other's way.
 *
 * The migration notice is not synced: it describes what happened in one
 * browser, and means nothing on another.
 */

export const RECORD_KINDS = ['deck', 'card', 'progress', 'history'] as const;

export type RecordKind = (typeof RECORD_KINDS)[number];

export interface RecordTypes {
  deck: Deck;
  card: Card;
  progress: CardProgress;
  history: DailyActivity;
}

/** One record of any kind. */
export type AnyRecord = RecordTypes[RecordKind];

/** Everything kept on this device, in the two shapes the app stores it in. */
export interface LocalSnapshot {
  data: AppData;
  progress: ProgressData;
}

/** Records by kind, then by ID. */
export type RecordSets = { [K in RecordKind]: Map<string, RecordTypes[K]> };

export function emptyRecordSets(): RecordSets {
  return { deck: new Map(), card: new Map(), progress: new Map(), history: new Map() };
}

export function recordId<K extends RecordKind>(kind: K, record: RecordTypes[K]): string {
  switch (kind) {
    case 'progress':
      return (record as CardProgress).cardId;
    case 'history':
      return (record as DailyActivity).day;
    default:
      return (record as Deck | Card).id;
  }
}

export function recordsFromSnapshot(snapshot: LocalSnapshot): RecordSets {
  const sets = emptyRecordSets();
  for (const deck of snapshot.data.decks) sets.deck.set(deck.id, deck);
  for (const card of snapshot.data.cards) sets.card.set(card.id, card);
  for (const record of snapshot.progress.records) sets.progress.set(record.cardId, record);
  for (const day of snapshot.progress.history) sets.history.set(day.day, day);
  return sets;
}

/**
 * Turns records back into what the app stores.
 *
 * Decks and cards keep the order they had in `previous`, with new ones added
 * at the end, so a sync never shuffles the user's lists. Progress records are
 * brought into line with the cards, exactly as the progress store does.
 */
export function snapshotFromRecords(sets: RecordSets, previous: LocalSnapshot): LocalSnapshot {
  const decks = ordered(
    sets.deck,
    previous.data.decks.map((deck) => deck.id),
  );
  const cards = ordered(
    sets.card,
    previous.data.cards.map((card) => card.id),
  );
  const data: AppData = { schemaVersion: SCHEMA_VERSION, decks, cards };
  const records = reconcileProgress([...sets.progress.values()], data).records;
  return {
    data,
    progress: {
      version: PROGRESS_VERSION,
      records,
      history: normalizeHistory([...sets.history.values()]),
    },
  };
}

function ordered<T>(byId: ReadonlyMap<string, T>, previousOrder: readonly string[]): T[] {
  const result: T[] = [];
  const seen = new Set<string>();
  for (const id of previousOrder) {
    const value = byId.get(id);
    if (value !== undefined && !seen.has(id)) {
      result.push(value);
      seen.add(id);
    }
  }
  for (const [id, value] of byId) {
    if (!seen.has(id)) result.push(value);
  }
  return result;
}

/**
 * A record's content in a fixed field order, so two records can be compared
 * without caring how their objects were built.
 */
export function canonical<K extends RecordKind>(kind: K, record: RecordTypes[K]): string {
  switch (kind) {
    case 'deck': {
      const d = record as Deck;
      return JSON.stringify([d.id, d.name, d.createdAt, d.updatedAt]);
    }
    case 'card': {
      const c = record as Card;
      return JSON.stringify([c.id, c.deckId, c.term, c.definition, c.createdAt, c.updatedAt]);
    }
    case 'progress': {
      const p = record as CardProgress;
      return JSON.stringify([
        p.cardId,
        p.deckId,
        p.reviews,
        p.correct,
        p.incorrect,
        p.stage,
        p.intervalDays,
        p.ease,
        p.lastReviewedAt,
        p.dueAt,
        p.streak,
      ]);
    }
    default: {
      const h = record as DailyActivity;
      return JSON.stringify([h.day, h.reviews, h.correct]);
    }
  }
}

/** Whether two versions of a record (either of which may be absent) say the same thing. */
export function sameRecord<K extends RecordKind>(
  kind: K,
  a: RecordTypes[K] | null | undefined,
  b: RecordTypes[K] | null | undefined,
): boolean {
  if (a == null || b == null) return a == null && b == null;
  return canonical(kind, a) === canonical(kind, b);
}

/** A copy holding only the fields the app defines, so stray properties never reach storage. */
export function cleanRecord<K extends RecordKind>(kind: K, record: RecordTypes[K]): RecordTypes[K] {
  switch (kind) {
    case 'deck': {
      const { id, name, createdAt, updatedAt } = record as Deck;
      return { id, name, createdAt, updatedAt } as RecordTypes[K];
    }
    case 'card': {
      const { id, deckId, term, definition, createdAt, updatedAt } = record as Card;
      return { id, deckId, term, definition, createdAt, updatedAt } as RecordTypes[K];
    }
    case 'progress': {
      const p = record as CardProgress;
      return {
        cardId: p.cardId,
        deckId: p.deckId,
        reviews: p.reviews,
        correct: p.correct,
        incorrect: p.incorrect,
        stage: p.stage,
        intervalDays: p.intervalDays,
        ease: p.ease,
        lastReviewedAt: p.lastReviewedAt,
        dueAt: p.dueAt,
        streak: p.streak,
      } as RecordTypes[K];
    }
    default: {
      const { day, reviews, correct } = record as DailyActivity;
      return { day, reviews, correct } as RecordTypes[K];
    }
  }
}

/** A key for one record, unique across kinds. */
export function recordKey(kind: RecordKind, id: string): string {
  return `${kind}:${id}`;
}
