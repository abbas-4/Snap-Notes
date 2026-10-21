import type { RandomFn } from './random';
import { shuffle } from './shuffle';
import type { Card } from './types';

export interface QuizChoice {
  text: string;
  isCorrect: boolean;
}

export interface QuizQuestion {
  cardId: string;
  prompt: string;
  choices: QuizChoice[];
}

export interface QuizOptions {
  /** Maximum choices per question, including the correct one. Defaults to 4. */
  choiceCount?: number;
  random?: RandomFn;
}

export const DEFAULT_CHOICE_COUNT = 4;

/** A card can be quizzed only when both sides have visible text. */
export function isQuizEligible(card: Card): boolean {
  return card.term.trim() !== '' && card.definition.trim() !== '';
}

/**
 * Two definitions that differ only by case or spacing look identical on screen,
 * so they are treated as the same answer.
 */
function answerKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Builds one multiple-choice question per eligible card, in random order.
 *
 * Unlike the legacy quiz, choices never repeat (duplicated cards share a
 * definition) and correctness is stored on the choice instead of being decided
 * by comparing strings, so exactly one choice per question is correct.
 *
 * Returns an empty array when there are fewer than two distinct definitions,
 * because a question needs at least one wrong answer.
 */
export function buildQuizQuestions(
  cards: readonly Card[],
  { choiceCount = DEFAULT_CHOICE_COUNT, random = Math.random }: QuizOptions = {},
): QuizQuestion[] {
  if (!Number.isInteger(choiceCount) || choiceCount < 2) {
    throw new RangeError(`choiceCount must be an integer of at least 2, got ${choiceCount}`);
  }

  const eligible = cards.filter(isQuizEligible);

  // One representative text per distinct answer, in first-seen order.
  const answers = new Map<string, string>();
  for (const card of eligible) {
    const key = answerKey(card.definition);
    if (!answers.has(key)) answers.set(key, card.definition);
  }
  if (answers.size < 2) return [];

  return shuffle(eligible, random).map((card) => {
    const correctKey = answerKey(card.definition);
    const wrongAnswers = [...answers].filter(([key]) => key !== correctKey).map(([, text]) => text);
    const distractors = shuffle(wrongAnswers, random).slice(0, choiceCount - 1);

    const choices = shuffle(
      [
        { text: card.definition, isCorrect: true },
        ...distractors.map((text) => ({ text, isCorrect: false })),
      ],
      random,
    );

    return { cardId: card.id, prompt: card.term, choices };
  });
}
