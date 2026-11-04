import { describe, expect, it } from 'vitest';
import { DEFAULT_DECK_ID } from './appData';
import { buildMatchRound, DEFAULT_PAIR_COUNT, matchableCards } from './match';
import { createSeededRandom } from './random';
import type { Card } from './types';

function card(id: string, term: string, definition: string): Card {
  return { id, deckId: DEFAULT_DECK_ID, term, definition, createdAt: 1, updatedAt: 1 };
}

const capitals = [
  card('fr', 'France', 'Paris'),
  card('de', 'Germany', 'Berlin'),
  card('it', 'Italy', 'Rome'),
  card('es', 'Spain', 'Madrid'),
  card('pt', 'Portugal', 'Lisbon'),
  card('at', 'Austria', 'Vienna'),
  card('gr', 'Greece', 'Athens'),
  card('ie', 'Ireland', 'Dublin'),
];

describe('buildMatchRound', () => {
  it(`uses at most ${DEFAULT_PAIR_COUNT} pairs, each term with exactly one partner`, () => {
    const round = buildMatchRound(capitals, { random: createSeededRandom(1) })!;

    expect(round.terms).toHaveLength(DEFAULT_PAIR_COUNT);
    expect(round.definitions).toHaveLength(DEFAULT_PAIR_COUNT);
    for (const term of round.terms) {
      const source = capitals.find((c) => c.id === term.pairId)!;
      const partners = round.definitions.filter((d) => d.pairId === term.pairId);
      expect(term).toMatchObject({ side: 'term', text: source.term });
      expect(partners).toEqual([
        {
          id: `definition:${source.id}`,
          pairId: source.id,
          side: 'definition',
          text: source.definition,
        },
      ]);
    }
    const ids = [...round.terms, ...round.definitions].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses every card when there are fewer than the pair count', () => {
    const round = buildMatchRound(capitals.slice(0, 3), { random: createSeededRandom(2) })!;

    expect(round.terms.map((t) => t.pairId).sort()).toEqual(['de', 'fr', 'it']);
  });

  it('respects a custom pair count', () => {
    const round = buildMatchRound(capitals, { pairCount: 3, random: createSeededRandom(3) })!;

    expect(round.terms).toHaveLength(3);
  });

  it('shuffles the two lists independently and reproducibly', () => {
    const a = buildMatchRound(capitals, { random: createSeededRandom(9) });
    const b = buildMatchRound(capitals, { random: createSeededRandom(9) });
    expect(a).toEqual(b);

    // Over a few seeds, the lists should not always line up row by row.
    const aligned = [1, 2, 3, 4, 5].every((seed) => {
      const round = buildMatchRound(capitals, { random: createSeededRandom(seed) })!;
      return round.terms.every((t, i) => round.definitions[i]?.pairId === t.pairId);
    });
    expect(aligned).toBe(false);
  });

  it('returns null when fewer than two cards can be matched', () => {
    expect(buildMatchRound([])).toBeNull();
    expect(buildMatchRound([capitals[0]!])).toBeNull();
    expect(buildMatchRound([capitals[0]!, card('x', 'Blank', '  ')])).toBeNull();
  });

  it('keeps HTML-like text exactly as written', () => {
    const round = buildMatchRound([
      card('x', '<b>bold</b>', '<img src=x onerror=alert(1)>'),
      card('y', 'Ampersand', 'Tom &amp; Jerry'),
    ])!;
    const texts = [...round.terms, ...round.definitions].map((t) => t.text);

    expect(texts).toContain('<b>bold</b>');
    expect(texts).toContain('<img src=x onerror=alert(1)>');
    expect(texts).toContain('Tom &amp; Jerry');
  });

  it('rejects an invalid pair count', () => {
    expect(() => buildMatchRound(capitals, { pairCount: 1 })).toThrow(RangeError);
    expect(() => buildMatchRound(capitals, { pairCount: 2.5 })).toThrow(RangeError);
  });
});

describe('matchableCards', () => {
  it('skips cards missing a side', () => {
    const cards = [capitals[0]!, card('a', '', 'Oslo'), card('b', 'Norway', '\n')];

    expect(matchableCards(cards).map((c) => c.id)).toEqual(['fr']);
  });

  it('keeps only the first card with a look-alike term or definition', () => {
    const cards = [
      capitals[0]!,
      card('fr-copy', 'France (copy)', ' paris '),
      card('fr-again', 'FRANCE', 'Capital of France'),
      card('fr', 'Same id', 'Different'),
      capitals[1]!,
    ];

    expect(matchableCards(cards).map((c) => c.id)).toEqual(['fr', 'de']);
  });
});
