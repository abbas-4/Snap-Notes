import { z } from 'zod';

/**
 * The contract between the browser and the `generate-flashcards` Edge
 * Function: what may be asked for, what comes back, and the rules a generated
 * card must meet. Both sides import this one file, so the limits the page
 * shows are exactly the limits the server enforces.
 *
 * Only `zod` is imported, so this file runs unchanged in Deno (the Edge
 * Function) and in the Vite build (the app).
 */

/** The kinds of card the generator writes. Each is saved as an ordinary term/definition card. */
export const CARD_KINDS = ['qa', 'term', 'multiple-choice', 'fill-blank'] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** What the user can ask for: one kind, or a mix of all of them. */
export const CARD_TYPE_CHOICES = [...CARD_KINDS, 'mixed'] as const;
export type CardTypeChoice = (typeof CARD_TYPE_CHOICES)[number];

export const CARD_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type CardDifficulty = (typeof CARD_DIFFICULTIES)[number];

export const DIFFICULTY_CHOICES = [...CARD_DIFFICULTIES, 'mixed'] as const;
export type DifficultyChoice = (typeof DIFFICULTY_CHOICES)[number];

export const CARD_KIND_LABELS: Record<CardKind, string> = {
  qa: 'Question and answer',
  term: 'Term and definition',
  'multiple-choice': 'Multiple choice',
  'fill-blank': 'Fill in the blank',
};

export const LIMITS = {
  /** Shorter than this, there is too little to write useful cards from. */
  materialMinChars: 40,
  /** About 7,500 words: enough for a chapter, small enough to keep each request affordable. */
  materialMaxChars: 30_000,
  topicMaxChars: 120,
  countMin: 1,
  countMax: 30,
  /** Questions already in the review list, sent so new cards do not repeat them. */
  avoidMax: 120,
  avoidItemMaxChars: 300,
  questionMaxChars: 500,
  answerMaxChars: 800,
  choiceMaxChars: 200,
  choicesMin: 3,
  choicesMax: 5,
  evidenceMaxChars: 400,
  /** The whole request body, in bytes, checked before it is parsed. */
  requestMaxBytes: 200_000,
} as const;

/** How a blank is written in a fill-in-the-blank card. */
export const BLANK = '_____';
const BLANK_PATTERN = /_{3,}/g;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const generateRequestSchema = z.strictObject({
  action: z.literal('generate'),
  material: z.string(),
  topic: z.string().max(LIMITS.topicMaxChars).optional(),
  count: z.number().int().min(LIMITS.countMin).max(LIMITS.countMax),
  cardType: z.enum(CARD_TYPE_CHOICES),
  difficulty: z.enum(DIFFICULTY_CHOICES),
  /** Questions the new cards must not repeat. */
  avoid: z.array(z.string().max(LIMITS.avoidItemMaxChars)).max(LIMITS.avoidMax).default([]),
});
export type GenerateRequest = z.input<typeof generateRequestSchema>;
export type ParsedGenerateRequest = z.output<typeof generateRequestSchema>;

export const statusRequestSchema = z.strictObject({ action: z.literal('status') });

export const requestSchema = z.discriminatedUnion('action', [
  generateRequestSchema,
  statusRequestSchema,
]);

/** A problem with the material itself, in words for the user; null when it can be sent. */
export function materialProblem(material: string): string | null {
  const length = material.trim().length;
  if (length === 0) return 'Add some study material first.';
  if (length < LIMITS.materialMinChars) {
    return `Add a little more material: at least ${LIMITS.materialMinChars} characters.`;
  }
  if (material.length > LIMITS.materialMaxChars) {
    return `The material is ${material.length.toLocaleString('en')} characters long. Shorten it to ${LIMITS.materialMaxChars.toLocaleString('en')} or fewer, or generate from one part at a time.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Generated cards
// ---------------------------------------------------------------------------

/**
 * One generated card, before it is saved. Every kind has a question and an
 * answer; a multiple-choice card also lists its choices, one of which is the
 * answer. `evidence` is the passage of the material the card is based on.
 */
export interface GeneratedCard {
  kind: CardKind;
  difficulty: CardDifficulty;
  question: string;
  answer: string;
  /** Only for multiple choice: every option, the answer among them. Empty otherwise. */
  choices: string[];
  evidence: string;
}

export const generatedCardSchema = z.object({
  kind: z.enum(CARD_KINDS),
  difficulty: z.enum(CARD_DIFFICULTIES),
  question: z.string(),
  answer: z.string(),
  choices: z.array(z.string()),
  evidence: z.string(),
});

/** Collapses runs of spaces, trims, and writes every blank the same way. */
export function tidyText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function tidyQuestion(kind: CardKind, question: string): string {
  const tidy = tidyText(question);
  return kind === 'fill-blank' ? tidy.replace(BLANK_PATTERN, BLANK) : tidy;
}

/** Trims every field and normalizes blanks, without judging the card. */
export function tidyCard(card: GeneratedCard): GeneratedCard {
  return {
    kind: card.kind,
    difficulty: card.difficulty,
    question: tidyQuestion(card.kind, card.question),
    answer: tidyText(card.answer),
    choices: card.kind === 'multiple-choice' ? card.choices.map(tidyText) : [],
    evidence: tidyText(card.evidence),
  };
}

function lower(text: string): string {
  return text.toLocaleLowerCase('en');
}

/** The words of a text, lower-cased, without punctuation. Letters and digits in any script count. */
export function words(text: string): string[] {
  return lower(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Whether `phrase` appears in `text` as whole words, ignoring case and punctuation. */
export function containsPhrase(text: string, phrase: string): boolean {
  const needle = words(phrase).join(' ');
  return needle !== '' && ` ${words(text).join(' ')} `.includes(` ${needle} `);
}

/**
 * What is wrong with a card, in words for the user, or null when it can be
 * saved. The server drops cards that fail this; the review screen uses it to
 * explain why an edited card cannot be saved yet.
 */
export function cardProblem(card: GeneratedCard): string | null {
  const question = card.question.trim();
  const answer = card.answer.trim();
  if (question === '') return 'Write a question.';
  if (answer === '') return 'Write an answer.';
  if (question.length > LIMITS.questionMaxChars) {
    return `Keep the question under ${LIMITS.questionMaxChars} characters.`;
  }
  if (answer.length > LIMITS.answerMaxChars) {
    return `Keep the answer under ${LIMITS.answerMaxChars} characters.`;
  }

  if (card.kind === 'fill-blank') {
    const blanks = question.match(BLANK_PATTERN)?.length ?? 0;
    if (blanks !== 1) return `Mark the missing word with one blank (${BLANK}).`;
    // A blank that leaves the answer in plain sight tests nothing.
    if (containsPhrase(question, answer)) return 'The question gives the answer away.';
  }

  if (card.kind === 'multiple-choice') {
    const choices = card.choices.map((choice) => choice.trim());
    if (choices.length < LIMITS.choicesMin || choices.length > LIMITS.choicesMax) {
      return `Give between ${LIMITS.choicesMin} and ${LIMITS.choicesMax} choices.`;
    }
    if (choices.some((choice) => choice === '')) return 'Fill in every choice.';
    if (choices.some((choice) => choice.length > LIMITS.choiceMaxChars)) {
      return `Keep each choice under ${LIMITS.choiceMaxChars} characters.`;
    }
    if (new Set(choices.map(lower)).size !== choices.length)
      return 'Each choice must be different.';
    if (choices.filter((choice) => choice === answer).length !== 1) {
      return 'Mark which choice is correct.';
    }
  } else if (card.choices.length > 0) {
    return 'Only multiple-choice cards have choices.';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  /** No valid session: sign in again. */
  'unauthenticated',
  /** The request broke the contract above. */
  'invalid-request',
  /** The material or request is over the size limits. */
  'input-too-long',
  /** This account has used its allowance for now. */
  'rate-limited',
  /** The server has no AI provider configured. */
  'not-configured',
  /** The provider is busy, overloaded or unreachable. */
  'provider-unavailable',
  /** The provider took too long. */
  'timeout',
  /** The provider's reply could not be used. */
  'malformed-response',
  /** The provider declined to process the material. */
  'refused',
  /** Anything else on the server. */
  'internal',
] as const;
export type GenerationErrorCode = (typeof ERROR_CODES)[number];

/** Why cards the provider wrote were not passed on. */
export interface DiscardCounts {
  /** Missing fields, a blank that gives the answer away, a wrong choice list… */
  invalid: number;
  /** The quoted evidence could not be found in the material. */
  ungrounded: number;
  /** The same as, or nearly the same as, another card. */
  duplicate: number;
}

export interface Quota {
  remainingHour: number;
  remainingDay: number;
}

export const generateReplySchema = z.object({
  ok: z.literal(true),
  cards: z.array(generatedCardSchema),
  requested: z.number().int().nonnegative(),
  discarded: z.object({
    invalid: z.number().int().nonnegative(),
    ungrounded: z.number().int().nonnegative(),
    duplicate: z.number().int().nonnegative(),
  }),
  quota: z.object({
    remainingHour: z.number().int().nonnegative(),
    remainingDay: z.number().int().nonnegative(),
  }),
});
export type GenerateReply = z.infer<typeof generateReplySchema>;

export const statusReplySchema = z.object({
  ok: z.literal(true),
  configured: z.boolean(),
  /** The provider's name, to tell the user where their material is sent. Null when not configured. */
  provider: z.string().nullable(),
});
export type StatusReply = z.infer<typeof statusReplySchema>;

export const errorReplySchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    retryAfterSeconds: z.number().int().positive().optional(),
  }),
});
export type ErrorReply = z.infer<typeof errorReplySchema>;
