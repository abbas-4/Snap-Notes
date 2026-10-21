import { describe, expect, it } from 'vitest';
import { DEFAULT_DECK_ID } from '../domain/appData';
import { isValidId } from '../domain/ids';
import legacyExport from './__fixtures__/legacy-v1-export.json';
import { migrateV1, type MigrationIssueKind } from './migrations';
import { appDataSchema } from './schemas';

const NOW = 1_800_000_000_000;

/** Predictable IDs so tests can assert exact values. */
function sequentialIds(prefix = 'new') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function migrate(legacy: unknown) {
  return migrateV1(legacy, { now: NOW, createId: sequentialIds() });
}

function issueKinds(result: ReturnType<typeof migrate>): MigrationIssueKind[] {
  return result.report.issues.map((issue) => issue.kind);
}

describe('migrateV1', () => {
  it('migrates a typical legacy export without losing anything', () => {
    const result = migrate(legacyExport);

    expect(appDataSchema.safeParse(result.data).success).toBe(true);
    expect(result.report).toMatchObject({ recordsFound: 5, cardsMigrated: 5 });
    expect(result.data.decks).toEqual([
      { id: DEFAULT_DECK_ID, name: 'My Cards', createdAt: NOW, updatedAt: NOW },
    ]);
    expect(result.data.cards.map((c) => c.id)).toEqual(legacyExport.map((c) => c.id));
    expect(result.data.cards.map((c) => c.term)).toEqual(legacyExport.map((c) => c.term));
    expect(result.data.cards.map((c) => c.definition)).toEqual(
      legacyExport.map((c) => c.definition),
    );
    expect(result.data.cards.every((c) => c.deckId === DEFAULT_DECK_ID)).toBe(true);
    expect(result.data.cards[1]).toMatchObject({
      createdAt: 1711300100000,
      updatedAt: 1711400000000,
    });
  });

  it('keeps HTML-like content and whitespace exactly as plain text', () => {
    const term = '<script>alert("x")</script>';
    const definition = '  Tom &amp; Jerry <img src=x onerror=alert(1)>\n  — naïve ✓ ';

    const [card] = migrate([{ id: 'a', term, definition, created: 1 }]).data.cards;

    expect(card?.term).toBe(term);
    expect(card?.definition).toBe(definition);
  });

  it('returns empty data without issues when there is no legacy data', () => {
    for (const input of [null, undefined]) {
      const result = migrate(input);
      expect(result.data.cards).toEqual([]);
      expect(result.data.decks).toHaveLength(1);
      expect(result.report.issues).toEqual([]);
    }
  });

  it('reports data that is not an array', () => {
    for (const input of [{ cards: [] }, 'cards', 42, true]) {
      const result = migrate(input);
      expect(result.data.cards).toEqual([]);
      expect(issueKinds(result)).toEqual(['not-an-array']);
    }
  });

  it('skips records that are not card objects', () => {
    const result = migrate([
      null,
      5,
      'text',
      ['a', 'b'],
      { id: 'ok', term: 'T', definition: 'D', created: 1 },
    ]);

    expect(result.data.cards.map((c) => c.id)).toEqual(['ok']);
    expect(result.report).toMatchObject({ recordsFound: 5, cardsMigrated: 1 });
    expect(issueKinds(result)).toEqual(Array(4).fill('skipped-record'));
  });

  it('converts numbers and booleans in text fields, and drops other types', () => {
    const result = migrate([
      { id: 'n', term: 42, definition: true, created: 1 },
      { id: 'o', term: { text: 'x' }, definition: 'Kept', created: 1 },
      { id: 'p', term: ['x'], definition: null, created: 1 },
    ]);

    expect(result.data.cards).toHaveLength(2);
    expect(result.data.cards[0]).toMatchObject({ id: 'n', term: '42', definition: 'true' });
    expect(result.data.cards[1]).toMatchObject({ id: 'o', term: '', definition: 'Kept' });
    expect(issueKinds(result)).toEqual([
      'converted-field',
      'converted-field',
      'dropped-field',
      'dropped-field',
      'skipped-record',
    ]);
  });

  it('keeps cards with one empty side but skips cards with no text at all', () => {
    const result = migrate([
      { id: 'a', term: 'Only a term', definition: '', created: 1 },
      { id: 'b', term: '', definition: 'Only a definition', created: 1 },
      { id: 'c', term: '   ', definition: '\n', created: 1 },
      { id: 'd', created: 1 },
    ]);

    expect(result.data.cards.map((c) => c.id)).toEqual(['a', 'b']);
    expect(issueKinds(result)).toEqual(['skipped-record', 'skipped-record']);
  });

  it('keeps the first of duplicate IDs and replaces the rest', () => {
    const result = migrate([
      { id: 'same', term: 'First', definition: '1', created: 1 },
      { id: 'same', term: 'Second', definition: '2', created: 1 },
      { id: 'same', term: 'Third', definition: '3', created: 1 },
    ]);

    expect(result.data.cards.map((c) => [c.id, c.term])).toEqual([
      ['same', 'First'],
      ['new-1', 'Second'],
      ['new-2', 'Third'],
    ]);
    expect(result.report.issues.map((i) => i.message)).toEqual([
      'Record 1: duplicate id was replaced with "new-1".',
      'Record 2: duplicate id was replaced with "new-2".',
    ]);
  });

  it('replaces missing and unsafe IDs, and converts numeric IDs to text', () => {
    const result = migrate([
      { term: 'Missing', definition: 'x', created: 1 },
      { id: '', term: 'Empty', definition: 'x', created: 1 },
      { id: "x'); alert(1);//", term: 'Injection', definition: 'x', created: 1 },
      { id: '<b>id</b>', term: 'HTML', definition: 'x', created: 1 },
      { id: 'a'.repeat(65), term: 'Too long', definition: 'x', created: 1 },
      { id: { nested: true }, term: 'Object', definition: 'x', created: 1 },
      { id: 7, term: 'Number', definition: 'x', created: 1 },
    ]);

    const ids = result.data.cards.map((c) => c.id);
    expect(ids).toEqual(['new-1', 'new-2', 'new-3', 'new-4', 'new-5', 'new-6', '7']);
    expect(ids.every(isValidId)).toBe(true);
    expect(result.report.issues.map((i) => i.message.match(/: (\w+) id/)?.[1])).toEqual([
      'missing',
      'missing',
      'invalid',
      'invalid',
      'invalid',
      'invalid',
    ]);
  });

  it('never hands out a generated ID that is already in use', () => {
    const ids = ['taken', 'taken', 'fresh'];
    const result = migrateV1(
      [
        { id: 'taken', term: 'A', definition: 'a', created: 1 },
        { id: 'taken', term: 'B', definition: 'b', created: 1 },
      ],
      { now: NOW, createId: () => ids.shift()! },
    );

    expect(result.data.cards.map((c) => c.id)).toEqual(['taken', 'fresh']);
  });

  it('fills in missing or invalid timestamps', () => {
    const result = migrate([
      { id: 'none', term: 'T', definition: 'D' },
      { id: 'only-updated', term: 'T', definition: 'D', updated: 1500 },
      { id: 'bad', term: 'T', definition: 'D', created: '2024-01-01', updated: -5 },
      { id: 'fraction', term: 'T', definition: 'D', created: 1.5 },
      { id: 'backwards', term: 'T', definition: 'D', created: 2000, updated: 1000 },
      { id: 'good', term: 'T', definition: 'D', created: 1000, updated: 2000 },
    ]);

    expect(result.data.cards.map((c) => [c.id, c.createdAt, c.updatedAt])).toEqual([
      ['none', NOW, NOW],
      ['only-updated', 1500, 1500],
      ['bad', NOW, NOW],
      ['fraction', NOW, NOW],
      ['backwards', 2000, 2000],
      ['good', 1000, 2000],
    ]);
    expect(issueKinds(result)).toEqual(Array(4).fill('filled-timestamp'));
  });

  it('does not modify its input', () => {
    const input = structuredClone(legacyExport);
    migrate(input);
    expect(input).toEqual(legacyExport);
  });

  it('always produces valid v2 data, even from very messy input', () => {
    const messy = [
      { id: 'dup', term: 1, definition: 2 },
      { id: 'dup', term: 'x', definition: 'y', created: 'yesterday' },
      null,
      { id: '"><svg onload=alert(1)>', term: '<svg>', definition: '' },
      { term: false, definition: false, updated: 5 },
      {},
    ];

    const result = migrateV1(messy, { now: NOW });

    expect(appDataSchema.safeParse(result.data).success).toBe(true);
    expect(result.data.cards).toHaveLength(4);
  });
});
