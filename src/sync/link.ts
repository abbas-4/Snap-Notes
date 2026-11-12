import { createDefaultDeck, DEFAULT_DECK_ID, DEFAULT_DECK_NAME } from '../domain/appData';
import { createEmptyAppData } from '../domain/appData';
import type { Timestamp } from '../domain/types';
import { emptyProgress } from '../storage/progressStore';
import { appDataSchema, describeIssues } from '../storage/schemas';
import { cloneBase } from './changes';
import { mergeHistory, mergeProgress, mergeRecord, type ConflictDraft } from './merge';
import {
  cleanRecord,
  emptyRecordSets,
  recordsFromSnapshot,
  snapshotFromRecords,
  type LocalSnapshot,
  type RecordKind,
  type RecordSets,
  type RecordTypes,
} from './records';
import { emptyBaseSets, type BaseSets, type RemoteRecord } from './state';

/**
 * Joining this browser's data to an account for the first time.
 *
 * Two choices are offered when both sides hold something:
 *
 * - **merge**: everything from both is kept. Records with the same ID are the
 *   same record and are merged with the usual rules. A deck in this browser
 *   with the same name as a deck in the account is treated as that deck, and
 *   a card with the same deck, term and definition as a card in the account is
 *   treated as that card, so linking a second device never doubles anything.
 *   The card's learning progress is merged into the account's copy.
 * - **use-account**: this browser takes the account's data, and its own data
 *   is set aside (the UI offers a backup download first).
 *
 * Nothing is uploaded here. The plan becomes the new local data plus a base
 * describing the server, and the ordinary sync then uploads the difference,
 * one batch at a time. An upload cut short is simply resumed the next time.
 */

export type LinkChoice = 'merge' | 'use-account';

export interface LinkReport {
  choice: LinkChoice;
  /** Decks and cards from this browser that the account did not have. */
  decksUploaded: number;
  cardsUploaded: number;
  /** Decks and cards from the account that this browser did not have. */
  decksDownloaded: number;
  cardsDownloaded: number;
  /** Decks and cards found on both sides under different IDs, and joined. */
  duplicateDecks: number;
  duplicateCards: number;
  conflicts: number;
}

export interface LinkPlan {
  snapshot: LocalSnapshot;
  base: BaseSets;
  conflicts: ConflictDraft[];
  report: LinkReport;
}

export type LinkPlanResult = { ok: true; plan: LinkPlan } | { ok: false; message: string };

/** Whether there is nothing here worth keeping: no cards, no progress, only the untouched default deck. */
export function isLocalEmpty(snapshot: LocalSnapshot): boolean {
  return (
    snapshot.data.cards.length === 0 &&
    snapshot.progress.records.length === 0 &&
    snapshot.progress.history.length === 0 &&
    snapshot.data.decks.every(
      (deck) => deck.id === DEFAULT_DECK_ID && deck.name === DEFAULT_DECK_NAME,
    )
  );
}

/** The newest version of every record the server listed. */
export function baseFromRemote(records: readonly RemoteRecord[]): BaseSets {
  const base = emptyBaseSets();
  for (const record of records) {
    const entries = base[record.kind] as Record<string, { revision: number; data: unknown }>;
    const current = entries[record.id];
    if (current && current.revision >= record.revision) continue;
    entries[record.id] = {
      revision: record.revision,
      data: record.deleted || record.data === null ? null : cleanRecord(record.kind, record.data),
    };
  }
  return base;
}

function liveSets(base: BaseSets): RecordSets {
  const sets = emptyRecordSets();
  for (const kind of Object.keys(base) as RecordKind[]) {
    const map = sets[kind] as Map<string, RecordTypes[RecordKind]>;
    for (const [id, entry] of Object.entries(base[kind])) {
      if (entry.data !== null) map.set(id, entry.data);
    }
  }
  return sets;
}

export function cloudSummary(records: readonly RemoteRecord[]): { decks: number; cards: number } {
  const live = liveSets(baseFromRemote(records));
  return { decks: live.deck.size, cards: live.card.size };
}

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

function contentKey(card: { deckId: string; term: string; definition: string }): string {
  return JSON.stringify([card.deckId, card.term, card.definition]);
}

export function planLink(
  local: LocalSnapshot,
  remote: readonly RemoteRecord[],
  choice: LinkChoice,
  now: Timestamp,
): LinkPlanResult {
  const base = baseFromRemote(remote);
  const cloud = liveSets(base);
  const report: LinkReport = {
    choice,
    decksUploaded: 0,
    cardsUploaded: 0,
    decksDownloaded: 0,
    cardsDownloaded: 0,
    duplicateDecks: 0,
    duplicateCards: 0,
    conflicts: 0,
  };

  if (choice === 'use-account') {
    const sets = liveSets(base);
    // A collection always has somewhere to put a new card.
    if (sets.deck.size === 0) sets.deck.set(DEFAULT_DECK_ID, createDefaultDeck(now));
    report.decksDownloaded = cloud.deck.size;
    report.cardsDownloaded = cloud.card.size;
    const empty: LocalSnapshot = {
      data: { ...createEmptyAppData(now), decks: [] },
      progress: emptyProgress(),
    };
    return finish(snapshotFromRecords(sets, empty), base, [], report);
  }

  const mine = recordsFromSnapshot(local);
  const sets = liveSets(base);
  const conflicts: ConflictDraft[] = [];

  // Decks: same ID, then same name.
  const deckIdMap = new Map<string, string>();
  const cardCountByDeck = new Map<string, number>();
  for (const card of mine.card.values()) {
    cardCountByDeck.set(card.deckId, (cardCountByDeck.get(card.deckId) ?? 0) + 1);
  }
  const cloudDeckByName = new Map<string, string>();
  for (const deck of cloud.deck.values()) {
    if (!cloudDeckByName.has(nameKey(deck.name))) cloudDeckByName.set(nameKey(deck.name), deck.id);
  }
  const claimedDecks = new Set<string>();
  for (const deck of mine.deck.values()) {
    if (mine.deck.has(deck.id) && cloud.deck.has(deck.id)) claimedDecks.add(deck.id);
  }
  for (const deck of mine.deck.values()) {
    const theirs = cloud.deck.get(deck.id);
    if (theirs) {
      const merged = mergeRecord('deck', null, deck, theirs, deck.id);
      if (merged.value) sets.deck.set(deck.id, merged.value);
      if (merged.conflict) conflicts.push(merged.conflict);
      deckIdMap.set(deck.id, deck.id);
      continue;
    }
    const sameName = cloudDeckByName.get(nameKey(deck.name));
    if (sameName !== undefined && !claimedDecks.has(sameName)) {
      claimedDecks.add(sameName);
      deckIdMap.set(deck.id, sameName);
      report.duplicateDecks += 1;
      continue;
    }
    // An empty deck the account has deleted stays deleted.
    const deletedThere = Object.hasOwn(base.deck, deck.id);
    if (deletedThere && (cardCountByDeck.get(deck.id) ?? 0) === 0) continue;
    sets.deck.set(deck.id, deck);
    deckIdMap.set(deck.id, deck.id);
    report.decksUploaded += 1;
  }

  // Cards: same ID, then same deck and content.
  const cardIdMap = new Map<string, string>();
  const cloudCardByContent = new Map<string, string>();
  for (const card of cloud.card.values()) {
    if (!cloudCardByContent.has(contentKey(card)))
      cloudCardByContent.set(contentKey(card), card.id);
  }
  const claimedCards = new Set<string>([...mine.card.keys()].filter((id) => cloud.card.has(id)));
  for (const original of mine.card.values()) {
    const card = { ...original, deckId: deckIdMap.get(original.deckId) ?? original.deckId };
    const theirs = cloud.card.get(card.id);
    if (theirs) {
      const merged = mergeRecord('card', null, card, theirs, card.id);
      if (merged.value) sets.card.set(card.id, merged.value);
      if (merged.conflict) conflicts.push(merged.conflict);
      cardIdMap.set(card.id, card.id);
      continue;
    }
    const sameContent = cloudCardByContent.get(contentKey(card));
    if (sameContent !== undefined && !claimedCards.has(sameContent)) {
      claimedCards.add(sameContent);
      cardIdMap.set(card.id, sameContent);
      report.duplicateCards += 1;
      continue;
    }
    sets.card.set(card.id, card);
    cardIdMap.set(card.id, card.id);
    report.cardsUploaded += 1;
  }

  // Progress follows its card, wherever the card ended up.
  for (const original of mine.progress.values()) {
    const cardId = cardIdMap.get(original.cardId) ?? original.cardId;
    const card = sets.card.get(cardId);
    if (!card) continue;
    const record = { ...original, cardId, deckId: card.deckId };
    const theirs = sets.progress.get(cardId);
    sets.progress.set(cardId, theirs ? mergeProgress(null, record, theirs) : record);
  }

  for (const day of mine.history.values()) {
    const theirs = sets.history.get(day.day);
    sets.history.set(day.day, theirs ? mergeHistory(null, day, theirs) : day);
  }

  const matchedCloudCards = new Set(cardIdMap.values());
  report.cardsDownloaded = [...cloud.card.keys()].filter((id) => !matchedCloudCards.has(id)).length;
  const matchedCloudDecks = new Set(deckIdMap.values());
  report.decksDownloaded = [...cloud.deck.keys()].filter((id) => !matchedCloudDecks.has(id)).length;

  return finish(snapshotFromRecords(sets, local), base, conflicts, report);
}

function finish(
  snapshot: LocalSnapshot,
  base: BaseSets,
  conflicts: ConflictDraft[],
  report: LinkReport,
): LinkPlanResult {
  const valid = appDataSchema.safeParse(snapshot.data);
  if (!valid.success) {
    return {
      ok: false,
      message: `The combined data could not be checked: ${describeIssues(valid.error)}`,
    };
  }
  report.conflicts = conflicts.length;
  return { ok: true, plan: { snapshot, base: cloneBase(base), conflicts, report } };
}
