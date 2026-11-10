import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../test/memoryStorage';
import {
  createMigrationRecord,
  dismissMigrationRecord,
  loadMigrationRecord,
  MAX_RECORDED_ISSUES,
  MIGRATION_RECORD_KEY,
  saveMigrationRecord,
} from './migrationRecord';
import type { MigrationIssue, MigrationReport } from './migrations';

const NOW = 1_800_000_000_000;

function report(issues: MigrationIssue[] = []): MigrationReport {
  return { recordsFound: 3, cardsMigrated: 2, issues };
}

describe('createMigrationRecord', () => {
  it('copies the counts and caps the issues while keeping the total', () => {
    const issues: MigrationIssue[] = Array.from({ length: MAX_RECORDED_ISSUES + 5 }, (_, i) => ({
      kind: 'filled-timestamp',
      index: i,
      message: `Record ${i}: missing creation time was filled in.`,
    }));

    const record = createMigrationRecord(report(issues), NOW);

    expect(record).toMatchObject({
      version: 1,
      migratedAt: NOW,
      recordsFound: 3,
      cardsMigrated: 2,
      issuesTotal: MAX_RECORDED_ISSUES + 5,
      dismissed: false,
    });
    expect(record.issues).toHaveLength(MAX_RECORDED_ISSUES);
    expect(record.issues[0]).toEqual(issues[0]);
  });
});

describe('loadMigrationRecord and saveMigrationRecord', () => {
  it('round-trips a record', () => {
    const storage = new MemoryStorage();
    const record = createMigrationRecord(
      report([{ kind: 'skipped-record', index: 1, reason: 'no-text', message: 'Record 1.' }]),
      NOW,
    );

    expect(saveMigrationRecord(storage, record)).toBe(true);
    expect(loadMigrationRecord(storage)).toEqual(record);
    expect(storage.writes).toEqual([{ method: 'setItem', key: MIGRATION_RECORD_KEY }]);
  });

  it('returns null when there is no record, and never throws on a bad one', () => {
    expect(loadMigrationRecord(null)).toBeNull();
    expect(loadMigrationRecord(new MemoryStorage())).toBeNull();
    expect(loadMigrationRecord(new MemoryStorage({ [MIGRATION_RECORD_KEY]: '{oops' }))).toBeNull();
    expect(
      loadMigrationRecord(
        new MemoryStorage({ [MIGRATION_RECORD_KEY]: JSON.stringify({ version: 2 }) }),
      ),
    ).toBeNull();

    const blocked = new MemoryStorage();
    blocked.failReads = new Error('blocked');
    expect(loadMigrationRecord(blocked)).toBeNull();
  });

  it('reports a failed save instead of throwing', () => {
    const storage = new MemoryStorage();
    storage.failWrites = new Error('full');

    expect(saveMigrationRecord(storage, createMigrationRecord(report(), NOW))).toBe(false);
    expect(saveMigrationRecord(null, createMigrationRecord(report(), NOW))).toBe(false);
  });
});

describe('dismissMigrationRecord', () => {
  it('marks the record as dismissed and keeps everything else', () => {
    const storage = new MemoryStorage();
    const record = createMigrationRecord(report(), NOW);
    saveMigrationRecord(storage, record);

    expect(dismissMigrationRecord(storage)).toBe(true);

    expect(loadMigrationRecord(storage)).toEqual({ ...record, dismissed: true });
  });

  it('does nothing without a record', () => {
    const storage = new MemoryStorage();

    expect(dismissMigrationRecord(storage)).toBe(false);
    expect(storage.writes).toEqual([]);
  });
});
