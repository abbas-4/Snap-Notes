import { describe, expect, it } from 'vitest';
import { createEmptyAppData, DEFAULT_DECK_ID } from '../domain/appData';
import type { AppData, Card } from '../domain/types';
import legacyExport from './__fixtures__/legacy-v1-export.json';
import {
  exportFileName,
  MAX_IMPORT_CHARACTERS,
  mergeImportedData,
  parseImportFile,
  serializeExport,
} from './importExport';
import { appDataSchema } from './schemas';

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);

function card(id: string, term: string, definition: string, deckId = DEFAULT_DECK_ID): Card {
  return { id, deckId, term, definition, createdAt: NOW, updatedAt: NOW };
}

function appData(cards: Card[], extraDecks: AppData['decks'] = []): AppData {
  const empty = createEmptyAppData(NOW);
  return { ...empty, decks: [...empty.decks, ...extraDecks], cards };
}

function sequentialIds() {
  let n = 0;
  return () => `gen-${++n}`;
}

describe('serializeExport', () => {
  it('writes a labelled, versioned file', () => {
    const file = JSON.parse(serializeExport(appData([card('a', 'T', 'D')]), NOW));

    expect(file).toMatchObject({
      format: 'snap-notes',
      schemaVersion: 2,
      exportedAt: '2026-10-21T12:00:00.000Z',
    });
    expect(file.cards).toHaveLength(1);
  });

  it('names files by date', () => {
    expect(exportFileName(NOW)).toBe('snap-notes-2026-10-21.json');
  });
});

describe('parseImportFile', () => {
  it('rejects text that is not JSON', () => {
    for (const text of ['', 'not json', '{"cards": [', "{'single': 'quotes'}"]) {
      expect(parseImportFile(text)).toMatchObject({ ok: false, error: 'invalid-json' });
    }
  });

  it('rejects files that are too large before parsing them', () => {
    const text = ' '.repeat(MAX_IMPORT_CHARACTERS + 1);
    expect(parseImportFile(text)).toMatchObject({ ok: false, error: 'too-large' });
  });

  it('rejects JSON that is not a Snap Notes export', () => {
    for (const text of [
      '"hello"',
      '42',
      'null',
      'true',
      '{"cards": []}',
      '{"format": "anki", "schemaVersion": 2}',
    ]) {
      expect(parseImportFile(text)).toMatchObject({ ok: false, error: 'unrecognized-format' });
    }
  });

  it('rejects files from a newer version', () => {
    const text = JSON.stringify({ format: 'snap-notes', schemaVersion: 3, decks: [], cards: [] });
    expect(parseImportFile(text)).toMatchObject({ ok: false, error: 'newer-version' });
  });

  describe('legacy array format', () => {
    it('imports a legacy export through the migration', () => {
      const result = parseImportFile(JSON.stringify(legacyExport), { now: NOW });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.format).toBe('v1-array');
      expect(result.data.cards.map((c) => c.term)).toEqual(legacyExport.map((c) => c.term));
      expect(result.migration).toMatchObject({ recordsFound: 5, cardsMigrated: 5 });
    });

    it('repairs wrong types and duplicate IDs instead of rejecting the file', () => {
      const text = JSON.stringify([
        { id: 'x', term: 3.14, definition: 'Pi' },
        { id: 'x', term: 'Tau', definition: 6.28 },
      ]);

      const result = parseImportFile(text, { now: NOW, createId: sequentialIds() });

      expect(result.ok && result.data.cards.map((c) => [c.id, c.term, c.definition])).toEqual([
        ['x', '3.14', 'Pi'],
        ['gen-1', 'Tau', '6.28'],
      ]);
    });

    it('rejects an empty list or a list with no usable cards', () => {
      expect(parseImportFile('[]')).toMatchObject({ ok: false, error: 'empty' });
      expect(parseImportFile('[null, 1, {"term": "", "definition": " "}]')).toMatchObject({
        ok: false,
        error: 'invalid-data',
      });
    });
  });

  describe('versioned format', () => {
    it('round-trips an export exactly', () => {
      const data = appData(
        [card('a', 'Term', 'Definition', 'bio'), card('b', '', 'Only a definition')],
        [{ id: 'bio', name: 'Biology', createdAt: NOW, updatedAt: NOW }],
      );

      const result = parseImportFile(serializeExport(data, NOW));

      expect(result).toEqual({ ok: true, format: 'v2', data });
    });

    it('accepts a copy of stored data without the format label', () => {
      const data = appData([card('a', 'T', 'D')]);
      expect(parseImportFile(JSON.stringify(data))).toEqual({ ok: true, format: 'v2', data });
    });

    it('rejects wrong data types and points to the field', () => {
      const file = JSON.parse(serializeExport(appData([card('a', 'T', 'D')]), NOW));
      file.cards[0].term = 123;

      const result = parseImportFile(JSON.stringify(file));

      expect(result).toMatchObject({ ok: false, error: 'invalid-data' });
      expect(!result.ok && result.message).toMatch(/^cards\.0\.term: /);
    });

    it('rejects duplicate IDs, unknown decks, unsafe IDs, and cards with no text', () => {
      const cases: Card[][] = [
        [card('a', 'T', 'D'), card('a', 'T2', 'D2')],
        [card('a', 'T', 'D', 'missing-deck')],
        [card('"><img>', 'T', 'D')],
        [card('a', ' ', '')],
      ];
      const expected = [
        'duplicate card id',
        'unknown deck',
        'must be 1–64',
        'needs a term or a definition',
      ];

      cases.forEach((cards, i) => {
        const result = parseImportFile(serializeExport(appData(cards), NOW));
        expect(result).toMatchObject({ ok: false, error: 'invalid-data' });
        expect(!result.ok && result.message).toContain(expected[i]);
      });
    });

    it('rejects missing timestamps', () => {
      const file = JSON.parse(serializeExport(appData([card('a', 'T', 'D')]), NOW));
      delete file.cards[0].createdAt;

      expect(parseImportFile(JSON.stringify(file))).toMatchObject({
        ok: false,
        error: 'invalid-data',
      });
    });

    it('rejects an export with no cards', () => {
      expect(parseImportFile(serializeExport(appData([]), NOW))).toMatchObject({
        ok: false,
        error: 'empty',
      });
    });
  });

  it('keeps HTML-like content as plain text in both formats', () => {
    const term = '<script>alert(1)</script>';
    const definition = 'a &lt; b && "c" <img src=x onerror=alert(1)>';

    const v1 = parseImportFile(JSON.stringify([{ id: 'h', term, definition }]), { now: NOW });
    const v2 = parseImportFile(serializeExport(appData([card('h', term, definition)]), NOW));

    for (const result of [v1, v2]) {
      expect(result.ok && result.data.cards[0]).toMatchObject({ term, definition });
    }
  });
});

describe('mergeImportedData', () => {
  it('skips cards that are already present, so importing twice does not duplicate', () => {
    const existing = appData([card('a', 'T', 'D'), card('b', 'T2', 'D2')]);

    const { data, report } = mergeImportedData(existing, existing);

    expect(data.cards).toEqual(existing.cards);
    expect(report).toEqual({
      cardsAdded: 0,
      decksAdded: 0,
      duplicatesSkipped: 2,
      idsReassigned: 0,
    });
  });

  it('gives a new ID to a different card that reuses an existing ID', () => {
    const existing = appData([card('a', 'Original', 'D')]);
    const incoming = appData([card('a', 'Different', 'D')]);

    const { data, report } = mergeImportedData(existing, incoming, { createId: sequentialIds() });

    expect(data.cards.map((c) => [c.id, c.term])).toEqual([
      ['a', 'Original'],
      ['gen-1', 'Different'],
    ]);
    expect(report).toMatchObject({ cardsAdded: 1, idsReassigned: 1 });
  });

  it('adds legacy imports to the existing default deck and adds new decks', () => {
    const existing = appData([card('a', 'T', 'D')]);
    const incoming = appData(
      [card('b', 'New', 'Card'), card('c', 'Bio', 'Card', 'bio')],
      [{ id: 'bio', name: 'Biology', createdAt: NOW, updatedAt: NOW }],
    );

    const { data, report } = mergeImportedData(existing, incoming);

    expect(data.decks.map((d) => d.id)).toEqual([DEFAULT_DECK_ID, 'bio']);
    expect(data.cards.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(report).toEqual({
      cardsAdded: 2,
      decksAdded: 1,
      duplicatesSkipped: 0,
      idsReassigned: 0,
    });
    expect(appDataSchema.safeParse(data).success).toBe(true);
  });

  it('does not modify the existing or incoming data', () => {
    const existing = appData([card('a', 'T', 'D')]);
    const incoming = appData([card('a', 'Other', 'D'), card('b', 'T', 'D')]);
    const before = structuredClone({ existing, incoming });

    mergeImportedData(existing, incoming);

    expect({ existing, incoming }).toEqual(before);
  });
});
