// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BLANK,
  cardProblem,
  containsPhrase,
  generateRequestSchema,
  LIMITS,
  materialProblem,
  requestSchema,
  tidyCard,
  type GeneratedCard,
} from './contract.ts';

const qa: GeneratedCard = {
  kind: 'qa',
  difficulty: 'easy',
  question: 'What do mitochondria produce?',
  answer: 'ATP',
  choices: [],
  evidence: 'Mitochondria produce ATP.',
};

const valid = {
  action: 'generate',
  material: 'x'.repeat(100),
  count: 10,
  cardType: 'mixed',
  difficulty: 'mixed',
};

describe('generation requests', () => {
  it('accepts every card type and difficulty, and defaults the avoid list', () => {
    for (const cardType of ['qa', 'term', 'multiple-choice', 'fill-blank', 'mixed']) {
      for (const difficulty of ['easy', 'medium', 'hard', 'mixed']) {
        const parsed = generateRequestSchema.safeParse({ ...valid, cardType, difficulty });
        expect(parsed.success).toBe(true);
        expect(parsed.data?.avoid).toEqual([]);
      }
    }
  });

  it('refuses invalid settings', () => {
    const bad = [
      { ...valid, count: 0 },
      { ...valid, count: LIMITS.countMax + 1 },
      { ...valid, count: 2.5 },
      { ...valid, cardType: 'essay' },
      { ...valid, difficulty: 'impossible' },
      { ...valid, topic: 'x'.repeat(LIMITS.topicMaxChars + 1) },
      { ...valid, avoid: Array(LIMITS.avoidMax + 1).fill('q') },
      { ...valid, avoid: ['x'.repeat(LIMITS.avoidItemMaxChars + 1)] },
      { ...valid, material: 42 },
      { ...valid, extra: 'field' },
      { ...valid, action: 'delete' },
    ];
    for (const request of bad) expect(requestSchema.safeParse(request).success).toBe(false);
  });

  it('explains material that cannot be sent', () => {
    expect(materialProblem('')).toBe('Add some study material first.');
    expect(materialProblem('   \n ')).toBe('Add some study material first.');
    expect(materialProblem('too short')).toMatch(/at least 40 characters/);
    expect(materialProblem('x'.repeat(LIMITS.materialMaxChars + 1))).toMatch(/30,000 or fewer/);
    expect(materialProblem('x'.repeat(LIMITS.materialMaxChars))).toBeNull();
  });
});

describe('card rules', () => {
  it('accepts a complete card of each kind', () => {
    expect(cardProblem(qa)).toBeNull();
    expect(cardProblem({ ...qa, kind: 'term', question: 'Mitochondrion' })).toBeNull();
    expect(
      cardProblem({
        ...qa,
        kind: 'fill-blank',
        question: `Mitochondria produce ${BLANK}.`,
      }),
    ).toBeNull();
    expect(
      cardProblem({ ...qa, kind: 'multiple-choice', choices: ['ATP', 'DNA', 'RNA', 'Glucose'] }),
    ).toBeNull();
  });

  it('needs a question and an answer within the limits', () => {
    expect(cardProblem({ ...qa, question: ' ' })).toBe('Write a question.');
    expect(cardProblem({ ...qa, answer: '' })).toBe('Write an answer.');
    expect(cardProblem({ ...qa, question: 'q'.repeat(LIMITS.questionMaxChars + 1) })).toMatch(
      /under 500/,
    );
    expect(cardProblem({ ...qa, answer: 'a'.repeat(LIMITS.answerMaxChars + 1) })).toMatch(
      /under 800/,
    );
    expect(cardProblem({ ...qa, choices: ['ATP'] })).toBe(
      'Only multiple-choice cards have choices.',
    );
  });

  it('needs exactly one blank that does not give the answer away', () => {
    const blank = { ...qa, kind: 'fill-blank' as const };
    expect(cardProblem({ ...blank, question: 'Mitochondria produce energy.' })).toMatch(
      /one blank/,
    );
    expect(cardProblem({ ...blank, question: `${BLANK} and ${BLANK}` })).toMatch(/one blank/);
    expect(cardProblem({ ...blank, question: `${BLANK} is ATP, the energy molecule.` })).toBe(
      'The question gives the answer away.',
    );
    // A whole-word match only: "ATPase" does not give away "ATP".
    expect(cardProblem({ ...blank, question: `ATPase uses ${BLANK}.` })).toBeNull();
  });

  it('needs distinct choices with exactly one correct', () => {
    const mc = { ...qa, kind: 'multiple-choice' as const };
    expect(cardProblem({ ...mc, choices: ['ATP', 'DNA'] })).toMatch(/between 3 and 5/);
    expect(cardProblem({ ...mc, choices: ['ATP', 'DNA', 'RNA', 'a', 'b', 'c'] })).toMatch(
      /between 3 and 5/,
    );
    expect(cardProblem({ ...mc, choices: ['ATP', 'DNA', ''] })).toBe('Fill in every choice.');
    expect(cardProblem({ ...mc, choices: ['ATP', 'atp', 'RNA'] })).toBe(
      'Each choice must be different.',
    );
    expect(cardProblem({ ...mc, choices: ['ADP', 'DNA', 'RNA'] })).toBe(
      'Mark which choice is correct.',
    );
  });

  it('tidies spacing and writes every blank the same way', () => {
    expect(
      tidyCard({
        ...qa,
        kind: 'fill-blank',
        question: '  Mitochondria   produce ___ .',
        answer: ' ATP\n',
        choices: ['stray'],
      }),
    ).toEqual({
      ...qa,
      kind: 'fill-blank',
      question: `Mitochondria produce ${BLANK} .`,
      answer: 'ATP',
      choices: [],
    });
  });

  it('matches phrases by whole words, ignoring case and punctuation', () => {
    expect(containsPhrase('The Krebs cycle, in short.', 'krebs CYCLE')).toBe(true);
    expect(containsPhrase('Krebsian cycles', 'krebs cycle')).toBe(false);
    expect(containsPhrase('anything', '...')).toBe(false);
  });
});
