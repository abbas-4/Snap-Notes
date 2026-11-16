import {
  cardProblem,
  generatedCardSchema,
  LIMITS,
  tidyCard,
  words,
  type DiscardCounts,
  type GeneratedCard,
} from './contract.ts';

/**
 * The checks every generated card passes before anyone sees it. The model is
 * asked for grounded, distinct cards; these rules make sure of it, because a
 * prompt alone cannot. Pure functions, used by the Edge Function on the model's
 * reply and by the review screen to spot repeats of cards already saved.
 */

function bigrams(tokens: readonly string[]): string[] {
  const pairs: string[] = [];
  for (let i = 1; i < tokens.length; i += 1) pairs.push(`${tokens[i - 1]} ${tokens[i]}`);
  return pairs;
}

/** Evidence shorter than this many words cannot show where a card came from. */
const MIN_EVIDENCE_WORDS = 3;
/** Share of the evidence's word pairs that must appear in the material when it is not an exact quote. */
const MIN_EVIDENCE_OVERLAP = 0.75;

/**
 * A view of the material prepared once, so each card's evidence is checked
 * without re-reading the whole text.
 */
export interface MaterialIndex {
  joined: string;
  pairs: Set<string>;
}

export function indexMaterial(material: string): MaterialIndex {
  const tokens = words(material);
  return { joined: ` ${tokens.join(' ')} `, pairs: new Set(bigrams(tokens)) };
}

/**
 * Whether a card's evidence really comes from the material: an exact quote
 * (ignoring case, spacing and punctuation), or a close one, where at least
 * three in four of its word pairs appear in the material. A card the model
 * based on anything else, such as its own general knowledge, fails.
 */
export function isGrounded(evidence: string, material: MaterialIndex): boolean {
  const tokens = words(evidence);
  if (tokens.length < MIN_EVIDENCE_WORDS) return false;
  if (material.joined.includes(` ${tokens.join(' ')} `)) return true;
  const pairs = bigrams(tokens);
  const found = pairs.filter((pair) => material.pairs.has(pair)).length;
  return found / pairs.length >= MIN_EVIDENCE_OVERLAP;
}

/**
 * Words that carry no meaning of their own in a question. Two questions that
 * differ only in a content word ("the function of the nucleus" and "the
 * function of the ribosome") are different questions, so similarity is
 * measured on the remaining words. Material in other languages keeps every word.
 */
const FUNCTION_WORDS = new Set(
  (
    'a an the and or but of in on at to for from by with into onto about as is are was were be ' +
    'been being do does did has have had it its this that these those there their they them ' +
    'what which who whom whose when where why how can could would should will may might must ' +
    'not no out up so than then if each any some all one'
  ).split(' '),
);

function contentWords(text: string): Set<string> {
  const all = words(text);
  const content = all.filter((word) => !FUNCTION_WORDS.has(word));
  return new Set(content.length > 0 ? content : all);
}

/**
 * Jaccard similarity of two texts' content words: 1 for the same words, 0 for
 * none shared. Word order, case, punctuation and function words are ignored.
 */
export function similarity(a: string, b: string): number {
  const left = contentWords(a);
  const right = contentWords(b);
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Questions this alike ask the same thing, even with words swapped or added. */
const SAME_QUESTION = 0.75;
/** With the same answer, questions need only be this alike to count as one card. */
const SAME_QUESTION_SAME_ANSWER = 0.5;

export interface CardText {
  question: string;
  /** Left out when only the question is known, as for questions the user already has. */
  answer?: string;
}

/** Whether two cards test the same thing, so keeping both would only repeat it. */
export function isNearDuplicate(a: CardText, b: CardText): boolean {
  const questionSimilarity = similarity(a.question, b.question);
  if (questionSimilarity >= SAME_QUESTION) return true;
  if (a.answer === undefined || b.answer === undefined) return false;
  const answerA = words(a.answer).join(' ');
  return (
    answerA !== '' &&
    answerA === words(b.answer).join(' ') &&
    questionSimilarity >= SAME_QUESTION_SAME_ANSWER
  );
}

export interface SelectOptions {
  material: string;
  /** Questions the user already has; a card repeating one is dropped. */
  avoid: readonly string[];
  /** At most this many cards are kept; extra ones are not counted as discarded. */
  count: number;
  /** For shuffling multiple-choice options. Defaults to `Math.random`. */
  random?: () => number;
}

export interface Selection {
  cards: GeneratedCard[];
  discarded: DiscardCounts;
}

/** Moves the correct option to a random place, so it is not always first. */
function shuffleChoices(card: GeneratedCard, random: () => number): GeneratedCard {
  if (card.kind !== 'multiple-choice') return card;
  const choices = [...card.choices];
  for (let i = choices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [choices[i], choices[j]] = [choices[j]!, choices[i]!];
  }
  return { ...card, choices };
}

/**
 * Turns the cards in a model's reply into the cards the user sees: each one
 * well-formed, grounded in the material, and different from the others and
 * from the questions in `avoid`. Anything else is dropped and counted.
 */
export function selectCards(raw: readonly unknown[], options: SelectOptions): Selection {
  const random = options.random ?? Math.random;
  const index = indexMaterial(options.material);
  const discarded: DiscardCounts = { invalid: 0, ungrounded: 0, duplicate: 0 };
  const kept: GeneratedCard[] = [];
  const avoid: CardText[] = options.avoid.map((question) => ({ question }));

  for (const item of raw) {
    if (kept.length >= options.count) break;
    const parsed = generatedCardSchema.safeParse(item);
    if (!parsed.success) {
      discarded.invalid += 1;
      continue;
    }
    const card = tidyCard(parsed.data);
    card.evidence = card.evidence.slice(0, LIMITS.evidenceMaxChars);
    if (cardProblem(card) !== null) {
      discarded.invalid += 1;
      continue;
    }
    if (!isGrounded(card.evidence, index)) {
      discarded.ungrounded += 1;
      continue;
    }
    if ([...avoid, ...kept].some((other) => isNearDuplicate(card, other))) {
      discarded.duplicate += 1;
      continue;
    }
    kept.push(shuffleChoices(card, random));
  }

  return { cards: kept, discarded };
}
