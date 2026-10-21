import { describe, expect, it } from 'vitest';
import { DEFAULT_DECK_ID } from './appData';
import { buildQuizQuestions, isQuizEligible } from './quiz';
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
];

function normalized(text: string) {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

describe('buildQuizQuestions', () => {
  it('creates one question per card with exactly one correct choice', () => {
    const questions = buildQuizQuestions(capitals, { random: createSeededRandom(1) });

    expect(questions.map((q) => q.cardId).sort()).toEqual(['de', 'es', 'fr', 'it', 'pt']);
    for (const question of questions) {
      const source = capitals.find((c) => c.id === question.cardId)!;
      const correct = question.choices.filter((c) => c.isCorrect);

      expect(question.prompt).toBe(source.term);
      expect(question.choices).toHaveLength(4);
      expect(correct).toEqual([{ text: source.definition, isCorrect: true }]);
    }
  });

  it('never repeats a choice, even when cards were duplicated', () => {
    const withCopies = [
      ...capitals.slice(0, 3),
      card('fr-copy', 'France (copy)', 'Paris'),
      card('fr-spaced', 'France again', '  paris '),
    ];

    const questions = buildQuizQuestions(withCopies, { random: createSeededRandom(5) });

    for (const question of questions) {
      const keys = question.choices.map((c) => normalized(c.text));
      expect(new Set(keys).size).toBe(keys.length);
      expect(question.choices.filter((c) => c.isCorrect)).toHaveLength(1);
    }
  });

  it('uses fewer choices when there are not enough distinct answers', () => {
    const questions = buildQuizQuestions(capitals.slice(0, 2), { random: createSeededRandom(2) });

    expect(questions).toHaveLength(2);
    for (const question of questions) expect(question.choices).toHaveLength(2);
  });

  it('respects a custom choice count', () => {
    const questions = buildQuizQuestions(capitals, {
      choiceCount: 3,
      random: createSeededRandom(3),
    });

    for (const question of questions) expect(question.choices).toHaveLength(3);
  });

  it('returns no questions when there are fewer than two distinct answers', () => {
    expect(buildQuizQuestions([])).toEqual([]);
    expect(buildQuizQuestions([capitals[0]!])).toEqual([]);
    expect(buildQuizQuestions([card('a', 'One', 'Same'), card('b', 'Two', 'same')])).toEqual([]);
  });

  it('skips cards with an empty term or definition', () => {
    const cards = [
      ...capitals.slice(0, 2),
      card('blank-def', 'Empty', '   '),
      card('blank-term', '', 'Oslo'),
    ];

    const questions = buildQuizQuestions(cards, { random: createSeededRandom(4) });

    expect(questions.map((q) => q.cardId).sort()).toEqual(['de', 'fr']);
    for (const question of questions) {
      expect(question.choices.map((c) => c.text)).not.toContain('Oslo');
    }
  });

  it('keeps HTML-like text exactly as written', () => {
    const cards = [
      card('x', '<b>bold</b>', '<img src=x onerror=alert(1)>'),
      card('y', 'Ampersand', 'Tom &amp; Jerry'),
    ];

    const questions = buildQuizQuestions(cards, { random: createSeededRandom(6) });
    const texts = questions.flatMap((q) => [q.prompt, ...q.choices.map((c) => c.text)]);

    expect(texts).toContain('<b>bold</b>');
    expect(texts).toContain('<img src=x onerror=alert(1)>');
    expect(texts).toContain('Tom &amp; Jerry');
  });

  it('is reproducible with the same seed', () => {
    expect(buildQuizQuestions(capitals, { random: createSeededRandom(9) })).toEqual(
      buildQuizQuestions(capitals, { random: createSeededRandom(9) }),
    );
  });

  it('rejects an invalid choice count', () => {
    expect(() => buildQuizQuestions(capitals, { choiceCount: 1 })).toThrow(RangeError);
    expect(() => buildQuizQuestions(capitals, { choiceCount: 2.5 })).toThrow(RangeError);
  });
});

describe('isQuizEligible', () => {
  it('requires visible text on both sides', () => {
    expect(isQuizEligible(card('a', 'Term', 'Definition'))).toBe(true);
    expect(isQuizEligible(card('b', ' ', 'Definition'))).toBe(false);
    expect(isQuizEligible(card('c', 'Term', '\n\t'))).toBe(false);
  });
});
