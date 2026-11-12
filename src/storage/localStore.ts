import { createEmptyAppData } from '../domain/appData';
import type { IdFactory } from '../domain/ids';
import { SCHEMA_VERSION, type AppData, type Timestamp } from '../domain/types';
import { createMigrationRecord, saveMigrationRecord } from './migrationRecord';
import { migrateV1, type MigrationReport } from './migrations';
import { appDataSchema, describeIssues } from './schemas';

/**
 * Key used by the original app. It is only ever read, never written or removed,
 * so the original app and the user's original data keep working as a backup.
 */
export const LEGACY_STORAGE_KEY = 'abbas_flashcards_v1';

/** Key for v2 data. Namespaced because every project on abbas-4.github.io shares one localStorage. */
export const STORAGE_KEY = 'snapnotes.data.v2';

/** Why the original app's data could not be migrated. */
export type LegacyProblem = 'invalid-json' | 'not-an-array' | 'no-usable-cards';

export type SaveError = {
  ok: false;
  error: 'unavailable' | 'invalid-data' | 'quota-exceeded' | 'write-failed';
  message: string;
};

export type SaveResult = { ok: true } | SaveError;

export type LoadResult =
  | {
      ok: true;
      data: AppData;
      /** `stored`: read from the v2 key. `migrated-v1`: converted from the original app's data. `new`: nothing saved yet. */
      source: 'stored' | 'migrated-v1' | 'new';
      /** False when migrated data could not be written back (the app can still run from memory). */
      persisted: boolean;
      migration?: MigrationReport;
      /** Why migrated data could not be written back. The next load will try the migration again. */
      saveError?: SaveError;
    }
  /** localStorage cannot be used at all (disabled, blocked, or some private modes). */
  | { ok: false; error: 'unavailable'; message: string }
  /**
   * The v2 key holds data this version cannot read. Nothing is overwritten, and
   * `raw` is returned so the user can be offered a download of it.
   */
  | { ok: false; error: 'corrupt' | 'newer-version'; message: string; raw: string }
  /**
   * There is no v2 data, and the original app's data cannot be read as cards.
   * Nothing is written: starting with an empty collection here would hide the
   * problem and block the migration for good, so the UI asks the user instead.
   */
  | {
      ok: false;
      error: 'legacy-unreadable';
      problem: LegacyProblem;
      message: string;
      /** The original app's data exactly as stored, for a backup download. */
      raw: string;
      /** What the migration found, when the data was readable but held no usable card. */
      migration?: MigrationReport;
    };

export interface StoreOptions {
  /** Defaults to `window.localStorage`. Pass a fake in tests. */
  storage?: Storage | null;
  now?: Timestamp;
  createId?: IdFactory;
}

/** Accessing `window.localStorage` itself can throw (e.g. when cookies are blocked). */
export function getBrowserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The storage to use: the given one, or the browser's when none was given. */
export function resolveStorage(storage: Storage | null | undefined): Storage | null {
  return storage === undefined ? getBrowserStorage() : storage;
}

const UNAVAILABLE = {
  ok: false,
  error: 'unavailable',
  message: 'Browser storage is not available.',
} as const;

/** Whether a failed write was refused because storage is full. Shared with the progress store. */
export function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  // Current browsers set the name; older WebKit used code 22 and older Firefox 1014.
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
}

export function saveAppData(data: AppData, options: StoreOptions = {}): SaveResult {
  const storage = resolveStorage(options.storage);
  if (!storage) return UNAVAILABLE;
  return writeAppData(storage, data);
}

function writeAppData(storage: Storage, data: AppData): SaveResult {
  const parsed = appDataSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: 'invalid-data', message: describeIssues(parsed.error) };
  }

  const serialized = JSON.stringify(parsed.data);
  try {
    storage.setItem(STORAGE_KEY, serialized);
  } catch (error) {
    if (isQuotaError(error)) {
      return { ok: false, error: 'quota-exceeded', message: 'Browser storage is full.' };
    }
    return { ok: false, error: 'write-failed', message: String(error) };
  }

  // A write that throws nothing can still be dropped (some private modes do
  // this), so confirm it landed before telling the caller the data is saved.
  let readBack: string | null;
  try {
    readBack = storage.getItem(STORAGE_KEY);
  } catch (error) {
    return {
      ok: false,
      error: 'write-failed',
      message: `Saved data could not be read back: ${String(error)}`,
    };
  }
  if (readBack !== serialized) {
    return {
      ok: false,
      error: 'write-failed',
      message: 'Saved data did not read back as written.',
    };
  }
  return { ok: true };
}

/**
 * Loads app data. Only when there is no v2 data at all is the original app's
 * key consulted: its cards are migrated and saved under the v2 key, and the
 * original key is left exactly as it was.
 */
export function loadAppData(options: StoreOptions = {}): LoadResult {
  const storage = resolveStorage(options.storage);
  const now = options.now ?? Date.now();
  if (!storage) return UNAVAILABLE;

  let raw: string | null;
  let legacyRaw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
    // Any v2 value, even an empty collection, means the migration already
    // happened or the user started fresh. Existing data always wins.
    legacyRaw = raw === null ? storage.getItem(LEGACY_STORAGE_KEY) : null;
  } catch (error) {
    return { ok: false, error: 'unavailable', message: String(error) };
  }

  if (raw !== null) return readStoredData(raw);

  if (legacyRaw === null) {
    return { ok: true, data: createEmptyAppData(now), source: 'new', persisted: false };
  }

  return migrateLegacyData(legacyRaw, storage, now, options.createId);
}

function migrateLegacyData(
  legacyRaw: string,
  storage: Storage,
  now: Timestamp,
  createId: IdFactory | undefined,
): LoadResult {
  let legacy: unknown;
  try {
    legacy = JSON.parse(legacyRaw);
  } catch {
    return {
      ok: false,
      error: 'legacy-unreadable',
      problem: 'invalid-json',
      message: 'The data saved by the original app is not valid JSON.',
      raw: legacyRaw,
    };
  }

  // The original app read its data as `JSON.parse(...) || []`, so null meant no cards.
  if (legacy === null || (Array.isArray(legacy) && legacy.length === 0)) {
    return { ok: true, data: createEmptyAppData(now), source: 'new', persisted: false };
  }

  if (!Array.isArray(legacy)) {
    return {
      ok: false,
      error: 'legacy-unreadable',
      problem: 'not-an-array',
      message: 'The data saved by the original app is not a list of cards.',
      raw: legacyRaw,
    };
  }

  const { data, report } = migrateV1(legacy, { now, createId });
  if (report.cardsMigrated === 0) {
    const entries = report.recordsFound === 1 ? 'entry' : 'entries';
    return {
      ok: false,
      error: 'legacy-unreadable',
      problem: 'no-usable-cards',
      message: `None of the ${report.recordsFound} saved ${entries} could be read as a card.`,
      raw: legacyRaw,
      migration: report,
    };
  }

  const saved = writeAppData(storage, data);
  if (!saved.ok) {
    return {
      ok: true,
      data,
      source: 'migrated-v1',
      persisted: false,
      migration: report,
      saveError: saved,
    };
  }

  // The record only drives the notice in the UI. If it cannot be written, the
  // migration itself still stands.
  saveMigrationRecord(storage, createMigrationRecord(report, now));
  return { ok: true, data, source: 'migrated-v1', persisted: true, migration: report };
}

function readStoredData(raw: string): LoadResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'corrupt', message: 'Saved data is not valid JSON.', raw };
  }

  const version = (json as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof version === 'number' && version > SCHEMA_VERSION) {
    return {
      ok: false,
      error: 'newer-version',
      message: `Saved data uses format version ${version}, but this app only understands version ${SCHEMA_VERSION}.`,
      raw,
    };
  }

  const parsed = appDataSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: 'corrupt', message: describeIssues(parsed.error), raw };
  }
  return { ok: true, data: parsed.data, source: 'stored', persisted: true };
}
