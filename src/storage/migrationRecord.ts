import { z } from 'zod';
import type { Timestamp } from '../domain/types';
import { MIGRATION_ISSUE_KINDS, type MigrationIssue, type MigrationReport } from './migrations';

/**
 * Key for the record of the one-time migration from the original app. It is
 * kept apart from the data: losing it costs nothing but the notice in the UI,
 * and it never decides whether a migration happens (only the v2 key does).
 */
export const MIGRATION_RECORD_KEY = 'snapnotes.migration.v1';

/** Issues kept in the record. Real data has a handful; this bounds a pathological case. */
export const MAX_RECORDED_ISSUES = 50;

export interface MigrationRecord {
  version: 1;
  migratedAt: Timestamp;
  recordsFound: number;
  cardsMigrated: number;
  /** The first `MAX_RECORDED_ISSUES` issues; `issuesTotal` is the full count. */
  issues: MigrationIssue[];
  issuesTotal: number;
  /** Set once the user has closed the notice about the migration. */
  dismissed: boolean;
}

const issueSchema = z.object({
  kind: z.enum(MIGRATION_ISSUE_KINDS),
  index: z.number().int().nonnegative().optional(),
  field: z.enum(['term', 'definition']).optional(),
  reason: z.enum(['not-an-object', 'no-text']).optional(),
  message: z.string(),
}) satisfies z.ZodType<MigrationIssue>;

const recordSchema = z.object({
  version: z.literal(1),
  migratedAt: z.number().int().positive(),
  recordsFound: z.number().int().nonnegative(),
  cardsMigrated: z.number().int().nonnegative(),
  issues: z.array(issueSchema),
  issuesTotal: z.number().int().nonnegative(),
  dismissed: z.boolean(),
}) satisfies z.ZodType<MigrationRecord>;

export function createMigrationRecord(
  report: MigrationReport,
  migratedAt: Timestamp,
): MigrationRecord {
  return {
    version: 1,
    migratedAt,
    recordsFound: report.recordsFound,
    cardsMigrated: report.cardsMigrated,
    issues: report.issues.slice(0, MAX_RECORDED_ISSUES),
    issuesTotal: report.issues.length,
    dismissed: false,
  };
}

/** Reads the record. Anything missing or unreadable counts as no record; this never throws. */
export function loadMigrationRecord(storage: Storage | null): MigrationRecord | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(MIGRATION_RECORD_KEY);
    if (raw === null) return null;
    const parsed = recordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Writes the record. A failure is reported, never thrown: the record is a convenience, not a gate. */
export function saveMigrationRecord(storage: Storage | null, record: MigrationRecord): boolean {
  if (!storage) return false;
  try {
    storage.setItem(MIGRATION_RECORD_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** Marks the record as dismissed so the notice stays closed on later visits. */
export function dismissMigrationRecord(storage: Storage | null): boolean {
  const record = loadMigrationRecord(storage);
  if (!record) return false;
  return saveMigrationRecord(storage, { ...record, dismissed: true });
}
