import { createDefaultDeck, DEFAULT_DECK_ID } from '../domain/appData';
import { createId, isValidId, type IdFactory } from '../domain/ids';
import { SCHEMA_VERSION, type AppData, type Card, type Timestamp } from '../domain/types';

export type MigrationIssueKind =
  | 'unreadable-json'
  | 'not-an-array'
  | 'skipped-record'
  | 'replaced-id'
  | 'converted-field'
  | 'dropped-field'
  | 'filled-timestamp';

export interface MigrationIssue {
  kind: MigrationIssueKind;
  /** Position of the record in the legacy array, when the issue concerns one record. */
  index?: number;
  message: string;
}

export interface MigrationReport {
  recordsFound: number;
  cardsMigrated: number;
  issues: MigrationIssue[];
}

export interface MigrationResult {
  data: AppData;
  report: MigrationReport;
}

export interface MigrationOptions {
  now?: Timestamp;
  createId?: IdFactory;
}

type TextField = 'term' | 'definition';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidTimestamp(value: unknown): value is Timestamp {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Converts the legacy app's data (the parsed value of the `abbas_flashcards_v1`
 * localStorage key, or a legacy export file) into the v2 format.
 *
 * Legacy records look like `{ id, term, definition, created?, updated? }`, but
 * imports were never validated, so any value may be malformed. The migration:
 * - keeps term and definition text exactly as written (no trimming or escaping);
 * - converts numbers and booleans in text fields to strings;
 * - skips records that are not objects or have neither a term nor a definition;
 * - replaces missing, unsafe, or duplicate IDs (the first occurrence keeps its ID);
 * - fills in missing timestamps;
 * - puts every card in the default deck.
 *
 * It is pure: it never reads or writes storage, and the input is not modified.
 */
export function migrateV1(legacy: unknown, options: MigrationOptions = {}): MigrationResult {
  const now = options.now ?? Date.now();
  const newId = options.createId ?? createId;
  const issues: MigrationIssue[] = [];
  const cards: Card[] = [];

  if (!Array.isArray(legacy)) {
    if (legacy !== null && legacy !== undefined) {
      issues.push({ kind: 'not-an-array', message: 'Legacy data is not a list of cards.' });
    }
    return {
      data: { schemaVersion: SCHEMA_VERSION, decks: [createDefaultDeck(now)], cards },
      report: { recordsFound: 0, cardsMigrated: 0, issues },
    };
  }

  const usedIds = new Set<string>();
  const uniqueId = () => {
    let id = newId();
    while (usedIds.has(id) || !isValidId(id)) id = newId();
    return id;
  };

  legacy.forEach((record: unknown, index) => {
    if (!isPlainObject(record)) {
      issues.push({
        kind: 'skipped-record',
        index,
        message: `Record ${index} is not a card object.`,
      });
      return;
    }

    const readText = (field: TextField): string => {
      const value = record[field];
      if (typeof value === 'string') return value;
      if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') {
        issues.push({
          kind: 'converted-field',
          index,
          message: `Record ${index}: ${field} was a ${typeof value} and was converted to text.`,
        });
        return String(value);
      }
      if (value !== undefined && value !== null) {
        issues.push({
          kind: 'dropped-field',
          index,
          message: `Record ${index}: ${field} had an unsupported type and was left empty.`,
        });
      }
      return '';
    };

    const term = readText('term');
    const definition = readText('definition');
    if (term.trim() === '' && definition.trim() === '') {
      issues.push({
        kind: 'skipped-record',
        index,
        message: `Record ${index} has neither a term nor a definition.`,
      });
      return;
    }

    // Numeric IDs (e.g. from hand-written JSON) broke edit and delete in the legacy app.
    const rawId =
      typeof record.id === 'number' && Number.isSafeInteger(record.id)
        ? String(record.id)
        : record.id;
    let id: string;
    if (isValidId(rawId) && !usedIds.has(rawId)) {
      id = rawId;
    } else {
      const reason = isValidId(rawId)
        ? 'duplicate'
        : rawId === undefined || rawId === null || rawId === ''
          ? 'missing'
          : 'invalid';
      id = uniqueId();
      issues.push({
        kind: 'replaced-id',
        index,
        message: `Record ${index}: ${reason} id was replaced with "${id}".`,
      });
    }
    usedIds.add(id);

    const { created, updated } = record;
    let createdAt: Timestamp;
    if (isValidTimestamp(created)) {
      createdAt = created;
    } else {
      createdAt = isValidTimestamp(updated) ? updated : now;
      issues.push({
        kind: 'filled-timestamp',
        index,
        message: `Record ${index}: missing creation time was filled in.`,
      });
    }
    const updatedAt = isValidTimestamp(updated) && updated >= createdAt ? updated : createdAt;

    cards.push({ id, deckId: DEFAULT_DECK_ID, term, definition, createdAt, updatedAt });
  });

  return {
    data: { schemaVersion: SCHEMA_VERSION, decks: [createDefaultDeck(now)], cards },
    report: { recordsFound: legacy.length, cardsMigrated: cards.length, issues },
  };
}
