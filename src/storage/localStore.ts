import { createEmptyAppData } from '../domain/appData';
import type { IdFactory } from '../domain/ids';
import { SCHEMA_VERSION, type AppData, type Timestamp } from '../domain/types';
import { migrateV1, type MigrationReport } from './migrations';
import { appDataSchema, describeIssues } from './schemas';

/**
 * Key used by the original app. It is only ever read, never written or removed,
 * so the legacy app and the user's original data keep working as a backup.
 */
export const LEGACY_STORAGE_KEY = 'abbas_flashcards_v1';

/** Key for v2 data. Namespaced because every project on abbas-4.github.io shares one localStorage. */
export const STORAGE_KEY = 'snapnotes.data.v2';

export type LoadResult =
  | {
      ok: true;
      data: AppData;
      /** `stored`: read from the v2 key. `migrated-v1`: converted from legacy data. `new`: nothing saved yet. */
      source: 'stored' | 'migrated-v1' | 'new';
      /** False when migrated data could not be written back (the app can still run from memory). */
      persisted: boolean;
      migration?: MigrationReport;
    }
  /** localStorage cannot be used at all (disabled, blocked, or some private modes). */
  | { ok: false; error: 'unavailable'; message: string }
  /**
   * The v2 key holds data this version cannot read. Nothing is overwritten, and
   * `raw` is returned so the user can be offered a download of it.
   */
  | { ok: false; error: 'corrupt' | 'newer-version'; message: string; raw: string };

export type SaveResult =
  | { ok: true }
  | {
      ok: false;
      error: 'unavailable' | 'invalid-data' | 'quota-exceeded' | 'write-failed';
      message: string;
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

function resolveStorage(options: StoreOptions): Storage | null {
  return options.storage === undefined ? getBrowserStorage() : options.storage;
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

export function saveAppData(data: AppData, options: StoreOptions = {}): SaveResult {
  const parsed = appDataSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: 'invalid-data', message: describeIssues(parsed.error) };
  }

  const storage = resolveStorage(options);
  if (!storage)
    return { ok: false, error: 'unavailable', message: 'Browser storage is not available.' };

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(parsed.data));
    return { ok: true };
  } catch (error) {
    if (isQuotaError(error)) {
      return { ok: false, error: 'quota-exceeded', message: 'Browser storage is full.' };
    }
    return { ok: false, error: 'write-failed', message: String(error) };
  }
}

/**
 * Loads app data. If only legacy data exists, it is migrated and the result is
 * saved under the v2 key; the legacy key is left exactly as it was.
 */
export function loadAppData(options: StoreOptions = {}): LoadResult {
  const storage = resolveStorage(options);
  const now = options.now ?? Date.now();
  if (!storage)
    return { ok: false, error: 'unavailable', message: 'Browser storage is not available.' };

  let raw: string | null;
  let legacyRaw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
    legacyRaw = raw === null ? storage.getItem(LEGACY_STORAGE_KEY) : null;
  } catch (error) {
    return { ok: false, error: 'unavailable', message: String(error) };
  }

  if (raw !== null) return readStoredData(raw);

  if (legacyRaw === null) {
    return { ok: true, data: createEmptyAppData(now), source: 'new', persisted: false };
  }

  let legacy: unknown;
  let legacyUnreadable = false;
  try {
    legacy = JSON.parse(legacyRaw);
  } catch {
    // The legacy app also treated unreadable JSON as "no cards".
    legacyUnreadable = true;
  }
  const { data, report } = migrateV1(legacy, { now, createId: options.createId });
  if (legacyUnreadable) {
    report.issues.unshift({ kind: 'unreadable-json', message: 'Legacy data is not valid JSON.' });
  }
  const saved = saveAppData(data, { storage });
  return { ok: true, data, source: 'migrated-v1', persisted: saved.ok, migration: report };
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
