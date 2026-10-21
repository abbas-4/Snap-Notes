import { createId, type IdFactory } from '../domain/ids';
import { SCHEMA_VERSION, type AppData, type Timestamp } from '../domain/types';
import { migrateV1, type MigrationOptions, type MigrationReport } from './migrations';
import { appDataSchema, describeIssues } from './schemas';

export const EXPORT_FORMAT = 'snap-notes';

/** Upper bound on import size, in characters. Far beyond any real deck, small enough to stay responsive. */
export const MAX_IMPORT_CHARACTERS = 5_000_000;

/** What an export file contains: the app data plus a label and a creation time. */
export interface ExportFile extends AppData {
  format: typeof EXPORT_FORMAT;
  exportedAt: string;
}

export type ImportErrorCode =
  'too-large' | 'invalid-json' | 'unrecognized-format' | 'newer-version' | 'invalid-data' | 'empty';

export type ImportResult =
  | {
      ok: true;
      /** `v1-array`: the legacy app's export. `v2`: this app's export (or a copy of stored data). */
      format: 'v1-array' | 'v2';
      data: AppData;
      migration?: MigrationReport;
    }
  | { ok: false; error: ImportErrorCode; message: string };

export function serializeExport(data: AppData, now: Timestamp = Date.now()): string {
  const file: ExportFile = {
    format: EXPORT_FORMAT,
    schemaVersion: data.schemaVersion,
    exportedAt: new Date(now).toISOString(),
    decks: data.decks,
    cards: data.cards,
  };
  return JSON.stringify(file, null, 2);
}

export function exportFileName(now: Timestamp = Date.now()): string {
  return `snap-notes-${new Date(now).toISOString().slice(0, 10)}.json`;
}

/**
 * Reads the text of an import file. Accepts both the legacy app's bare array of
 * cards and the versioned v2 format. Returns the imported data on its own;
 * combine it with existing data using `mergeImportedData`.
 */
export function parseImportFile(text: string, options: MigrationOptions = {}): ImportResult {
  if (text.length > MAX_IMPORT_CHARACTERS) {
    return { ok: false, error: 'too-large', message: 'The file is too large to import.' };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid-json', message: 'The file is not valid JSON.' };
  }

  if (Array.isArray(json)) {
    if (json.length === 0)
      return { ok: false, error: 'empty', message: 'The file contains no cards.' };
    const { data, report } = migrateV1(json, options);
    if (data.cards.length === 0) {
      return { ok: false, error: 'invalid-data', message: 'The file contains no usable cards.' };
    }
    return { ok: true, format: 'v1-array', data, migration: report };
  }

  if (typeof json !== 'object' || json === null || !('schemaVersion' in json)) {
    return {
      ok: false,
      error: 'unrecognized-format',
      message: 'This does not look like a Snap Notes export.',
    };
  }

  const { format, schemaVersion, decks, cards } = json as Record<string, unknown>;
  if (format !== undefined && format !== EXPORT_FORMAT) {
    return {
      ok: false,
      error: 'unrecognized-format',
      message: 'This does not look like a Snap Notes export.',
    };
  }
  if (typeof schemaVersion === 'number' && schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      error: 'newer-version',
      message: 'This file was made by a newer version of Snap Notes.',
    };
  }

  // A v2 file is machine-written, so it is validated strictly and never partially imported.
  const parsed = appDataSchema.safeParse({ schemaVersion, decks, cards });
  if (!parsed.success) {
    return { ok: false, error: 'invalid-data', message: describeIssues(parsed.error) };
  }
  if (parsed.data.cards.length === 0) {
    return { ok: false, error: 'empty', message: 'The file contains no cards.' };
  }
  return { ok: true, format: 'v2', data: parsed.data };
}

export interface MergeReport {
  cardsAdded: number;
  decksAdded: number;
  /** Cards already present with the same ID and content (for example, importing the same file twice). */
  duplicatesSkipped: number;
  /** Cards whose ID was already used by a different card, so they were given a new one. */
  idsReassigned: number;
}

/**
 * Adds imported data to existing data without losing anything. Decks with the
 * same ID are treated as the same deck. The legacy import gave colliding IDs to
 * different cards; here a collision always gets a fresh ID instead.
 */
export function mergeImportedData(
  existing: AppData,
  incoming: AppData,
  { createId: newId = createId }: { createId?: IdFactory } = {},
): { data: AppData; report: MergeReport } {
  const report: MergeReport = {
    cardsAdded: 0,
    decksAdded: 0,
    duplicatesSkipped: 0,
    idsReassigned: 0,
  };

  const decks = [...existing.decks];
  const deckIds = new Set(decks.map((deck) => deck.id));
  for (const deck of incoming.decks) {
    if (deckIds.has(deck.id)) continue;
    decks.push(deck);
    deckIds.add(deck.id);
    report.decksAdded++;
  }

  const cards = [...existing.cards];
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  for (const card of incoming.cards) {
    const current = cardsById.get(card.id);
    if (
      current &&
      current.deckId === card.deckId &&
      current.term === card.term &&
      current.definition === card.definition
    ) {
      report.duplicatesSkipped++;
      continue;
    }

    let id = card.id;
    if (current) {
      do id = newId();
      while (cardsById.has(id));
      report.idsReassigned++;
    }
    const added = { ...card, id };
    cards.push(added);
    cardsById.set(id, added);
    report.cardsAdded++;
  }

  return { data: { schemaVersion: SCHEMA_VERSION, decks, cards }, report };
}
