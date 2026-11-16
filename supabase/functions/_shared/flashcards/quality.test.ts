// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { GeneratedCard } from './contract.ts';
import { indexMaterial, isGrounded, isNearDuplicate, selectCards, similarity } from './quality.ts';

const MATERIAL = `Photosynthesis is the process by which green plants turn light energy into
chemical energy. It takes place in the chloroplasts, which contain the pigment chlorophyll.
The light-dependent reactions happen in the thylakoid membranes and produce ATP and NADPH.
The Calvin cycle, in the stroma, uses ATP and NADPH to fix carbon dioxide into glucose.`;

function card(overrides: Partial<GeneratedCard> = {}): GeneratedCard {
  return {
    kind: 'qa',
    difficulty: 'medium',
    question: 'Where does photosynthesis take place?',
    answer: 'In the chloroplasts.',
    choices: [],
    evidence: 'It takes place in the chloroplasts, which contain the pigment chlorophyll.',
    ...overrides,
  };
}

const options = { material: MATERIAL, avoid: [], count: 10, random: () => 0 };

describe('grounding', () => {
  const index = indexMaterial(MATERIAL);

  it('accepts an exact quote, whatever its case, spacing or punctuation', () => {
    expect(isGrounded('the calvin cycle,   in the STROMA', index)).toBe(true);
    expect(isGrounded('turn light energy into\nchemical energy', index)).toBe(true);
  });

  it('accepts a quote with a small slip, but not invented content', () => {
    expect(
      isGrounded(
        'The light-dependent reactions happen in the thylakoid membranes and make ATP',
        index,
      ),
    ).toBe(true);
    expect(isGrounded('Photosynthesis was discovered by Jan Ingenhousz in 1779.', index)).toBe(
      false,
    );
    expect(isGrounded('Mitochondria are the powerhouse of the cell.', index)).toBe(false);
  });

  it('refuses evidence too short to show where a card came from', () => {
    expect(isGrounded('chloroplasts', index)).toBe(false);
    expect(isGrounded('', index)).toBe(false);
  });
});

describe('duplicates', () => {
  it('scores word overlap', () => {
    expect(similarity('What is ATP?', 'what is atp')).toBe(1);
    expect(similarity('cats and dogs', 'fish or birds')).toBe(0);
    expect(similarity('nucleus', 'ribosome')).toBe(0);
  });

  it('does not treat questions that differ in their subject as repeats', () => {
    expect(
      isNearDuplicate(
        { question: 'What is the function of the nucleus?' },
        { question: 'What is the function of the ribosome?' },
      ),
    ).toBe(false);
  });

  it('treats reworded questions and same-answer near-repeats as one card', () => {
    expect(
      isNearDuplicate(
        { question: 'Where does photosynthesis take place?' },
        { question: 'Where does photosynthesis take place in plants?' },
      ),
    ).toBe(true);
    expect(
      isNearDuplicate(
        { question: 'Which organelle carries out photosynthesis?', answer: 'The chloroplast' },
        {
          question: 'Which organelle carries out photosynthesis in plants?',
          answer: 'the chloroplast.',
        },
      ),
    ).toBe(true);
    expect(
      isNearDuplicate(
        { question: 'What does the Calvin cycle produce?', answer: 'Glucose' },
        { question: 'Where do the light-dependent reactions happen?', answer: 'Thylakoids' },
      ),
    ).toBe(false);
  });
});

describe('selecting cards from a reply', () => {
  it('keeps valid, grounded, distinct cards, tidied', () => {
    const result = selectCards(
      [card({ question: '  Where does photosynthesis   take place? ' })],
      options,
    );
    expect(result.cards).toEqual([card()]);
    expect(result.discarded).toEqual({ invalid: 0, ungrounded: 0, duplicate: 0 });
  });

  it('drops and counts malformed and incomplete cards', () => {
    const result = selectCards(
      [
        null,
        'a string',
        { question: 'missing everything else' },
        card({ kind: 'essay' as GeneratedCard['kind'] }),
        card({ answer: '' }),
        card({ kind: 'multiple-choice', choices: ['A', 'B'] }),
        card({ kind: 'fill-blank', question: 'No blank here.' }),
      ],
      options,
    );
    expect(result.cards).toEqual([]);
    expect(result.discarded).toEqual({ invalid: 7, ungrounded: 0, duplicate: 0 });
  });

  it('drops cards not grounded in the material', () => {
    const result = selectCards(
      [
        card({
          question: 'Who discovered photosynthesis?',
          evidence: 'Jan Ingenhousz discovered it in 1779.',
        }),
      ],
      options,
    );
    expect(result.cards).toEqual([]);
    expect(result.discarded.ungrounded).toBe(1);
  });

  it('drops repeats of each other and of questions the user already has', () => {
    const calvin = card({
      question: 'What does the Calvin cycle fix carbon dioxide into?',
      answer: 'Glucose',
      evidence: 'uses ATP and NADPH to fix carbon dioxide into glucose',
    });
    const result = selectCards(
      [card(), card({ question: 'Where does photosynthesis take place?' }), calvin],
      { ...options, avoid: ['What does the Calvin cycle fix carbon dioxide into?'] },
    );
    expect(result.cards).toEqual([card()]);
    expect(result.discarded.duplicate).toBe(2);
  });

  it('keeps no more than the number asked for', () => {
    const second = card({
      question: 'What pigment do chloroplasts contain?',
      answer: 'Chlorophyll',
    });
    const result = selectCards([card(), second], { ...options, count: 1 });
    expect(result.cards).toHaveLength(1);
    expect(result.discarded).toEqual({ invalid: 0, ungrounded: 0, duplicate: 0 });
  });

  it('shuffles multiple-choice options so the answer is not always first', () => {
    const mc = card({
      kind: 'multiple-choice',
      question: 'Which pigment do chloroplasts contain?',
      answer: 'Chlorophyll',
      choices: ['Chlorophyll', 'Haemoglobin', 'Melanin', 'Keratin'],
    });
    const result = selectCards([mc], { ...options, random: () => 0 });
    expect(result.cards[0]!.choices).not.toEqual(mc.choices);
    expect([...result.cards[0]!.choices].sort()).toEqual([...mc.choices].sort());
    expect(result.cards[0]!.answer).toBe('Chlorophyll');
  });
});
