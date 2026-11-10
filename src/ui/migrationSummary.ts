import type { MigrationRecord } from '../storage/migrationRecord';
import type { MigrationIssue } from '../storage/migrations';

/** Issues that mean something was left out or lost, as opposed to tidied up. */
export function isSignificantIssue(issue: MigrationIssue): boolean {
  return issue.kind === 'skipped-record' || issue.kind === 'dropped-field';
}

/**
 * `complete`: every entry became a card with its text intact.
 * `entries-left-out`: some entries could not become cards.
 * `text-lost`: every entry became a card, but some text could not be read.
 */
export type MigrationOutcome = 'complete' | 'entries-left-out' | 'text-lost';

export function migrationOutcome(record: MigrationRecord): MigrationOutcome {
  // Counts, not the issue list, decide this: the list is capped, the counts are not.
  if (record.cardsMigrated < record.recordsFound) return 'entries-left-out';
  return record.issues.some(isSignificantIssue) ? 'text-lost' : 'complete';
}

export function migrationHeadline(record: MigrationRecord): string {
  const { cardsMigrated, recordsFound } = record;
  if (migrationOutcome(record) === 'entries-left-out') {
    const entries = recordsFound === 1 ? 'entry' : 'entries';
    return `Moved over ${cardsMigrated} of ${recordsFound} saved ${entries} from the previous version of Snap Notes.`;
  }
  return cardsMigrated === 1
    ? 'Your card was moved over from the previous version of Snap Notes.'
    : `Your ${cardsMigrated} cards were moved over from the previous version of Snap Notes.`;
}

/** One issue in words a user can act on. "Entry N" counts from 1, as a person would. */
export function describeIssue(issue: MigrationIssue): string {
  const entry = issue.index === undefined ? 'An entry' : `Entry ${issue.index + 1}`;
  switch (issue.kind) {
    case 'skipped-record':
      return issue.reason === 'no-text'
        ? `${entry} had neither a term nor a definition, so it was left out.`
        : `${entry} was not a card, so it was left out.`;
    case 'dropped-field':
      return `${entry}: its ${issue.field ?? 'text'} could not be read and was left empty.`;
    case 'converted-field':
      return `${entry}: its ${issue.field ?? 'text'} was a number or true/false and was turned into text.`;
    case 'replaced-id':
      return `${entry} was given a new internal ID.`;
    case 'filled-timestamp':
      return `${entry} had no usable creation date, so one was filled in.`;
    case 'unreadable-json':
      return 'The saved data was not valid JSON.';
    case 'not-an-array':
      return 'The saved data was not a list of cards.';
  }
}

export interface IssueSummary {
  /** Entries left out or text lost: the user should look at these. */
  significant: string[];
  /** Tidying that lost nothing: filled dates, new IDs, numbers turned into text. */
  harmless: string[];
  /** Issues beyond the ones the record kept. */
  notShown: number;
}

export function summarizeIssues(record: MigrationRecord): IssueSummary {
  const significant: string[] = [];
  const harmless: string[] = [];
  for (const issue of record.issues) {
    (isSignificantIssue(issue) ? significant : harmless).push(describeIssue(issue));
  }
  return { significant, harmless, notShown: record.issuesTotal - record.issues.length };
}
