import { describe, expect, it } from 'vitest';
import { createMigrationRecord } from '../storage/migrationRecord';
import type { MigrationIssue } from '../storage/migrations';
import {
  describeIssue,
  migrationHeadline,
  migrationOutcome,
  summarizeIssues,
} from './migrationSummary';

const NOW = 1_800_000_000_000;

function record(recordsFound: number, cardsMigrated: number, issues: MigrationIssue[] = []) {
  return createMigrationRecord({ recordsFound, cardsMigrated, issues }, NOW);
}

describe('migrationOutcome and migrationHeadline', () => {
  it('calls a migration complete when every entry became a card', () => {
    expect(migrationOutcome(record(3, 3))).toBe('complete');
    expect(migrationHeadline(record(3, 3))).toBe(
      'Your 3 cards were moved over from the previous version of Snap Notes.',
    );
    expect(migrationHeadline(record(1, 1))).toBe(
      'Your card was moved over from the previous version of Snap Notes.',
    );
  });

  it('treats tidying as complete, but left-out entries or lost text as partial', () => {
    const tidying: MigrationIssue[] = [
      { kind: 'filled-timestamp', index: 0, message: '' },
      { kind: 'replaced-id', index: 1, message: '' },
      { kind: 'converted-field', index: 2, field: 'term', message: '' },
    ];
    expect(migrationOutcome(record(3, 3, tidying))).toBe('complete');

    const skipped: MigrationIssue[] = [
      { kind: 'skipped-record', index: 1, reason: 'no-text', message: '' },
    ];
    expect(migrationOutcome(record(3, 2, skipped))).toBe('entries-left-out');
    expect(migrationHeadline(record(3, 2, skipped))).toBe(
      'Moved over 2 of 3 saved entries from the previous version of Snap Notes.',
    );

    const lostText: MigrationIssue[] = [
      { kind: 'dropped-field', index: 1, field: 'definition', message: '' },
    ];
    // Every entry became a card, so the headline must not say otherwise.
    expect(migrationOutcome(record(3, 3, lostText))).toBe('text-lost');
    expect(migrationHeadline(record(3, 3, lostText))).toBe(
      'Your 3 cards were moved over from the previous version of Snap Notes.',
    );
    expect(migrationHeadline(record(1, 0))).toBe(
      'Moved over 0 of 1 saved entry from the previous version of Snap Notes.',
    );
  });

  it('counts skipped entries beyond the recorded issues through the totals', () => {
    expect(migrationOutcome({ ...record(60, 59), issues: [], issuesTotal: 60 })).toBe(
      'entries-left-out',
    );
  });
});

describe('describeIssue', () => {
  it('speaks of entries counted from one, in plain words', () => {
    const cases: Array<[MigrationIssue, string]> = [
      [
        { kind: 'skipped-record', index: 0, reason: 'not-an-object', message: 'Record 0.' },
        'Entry 1 was not a card, so it was left out.',
      ],
      [
        { kind: 'skipped-record', index: 4, reason: 'no-text', message: '' },
        'Entry 5 had neither a term nor a definition, so it was left out.',
      ],
      [
        { kind: 'dropped-field', index: 1, field: 'definition', message: '' },
        'Entry 2: its definition could not be read and was left empty.',
      ],
      [
        { kind: 'converted-field', index: 1, field: 'term', message: '' },
        'Entry 2: its term was a number or true/false and was turned into text.',
      ],
      [{ kind: 'replaced-id', index: 2, message: '' }, 'Entry 3 was given a new internal ID.'],
      [
        { kind: 'filled-timestamp', index: 2, message: '' },
        'Entry 3 had no usable creation date, so one was filled in.',
      ],
      [{ kind: 'unreadable-json', message: '' }, 'The saved data was not valid JSON.'],
      [{ kind: 'not-an-array', message: '' }, 'The saved data was not a list of cards.'],
    ];
    for (const [issue, text] of cases) expect(describeIssue(issue)).toBe(text);
  });
});

describe('summarizeIssues', () => {
  it('separates what the user should look at from harmless tidying, and counts the rest', () => {
    const issues: MigrationIssue[] = [
      { kind: 'skipped-record', index: 1, reason: 'no-text', message: '' },
      { kind: 'filled-timestamp', index: 0, message: '' },
    ];

    expect(summarizeIssues({ ...record(2, 1, issues), issuesTotal: 7 })).toEqual({
      significant: ['Entry 2 had neither a term nor a definition, so it was left out.'],
      harmless: ['Entry 1 had no usable creation date, so one was filled in.'],
      notShown: 5,
    });
  });
});
