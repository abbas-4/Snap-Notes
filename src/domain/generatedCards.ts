import {
  BLANK,
  type CardKind,
  type GeneratedCard,
} from '../../supabase/functions/_shared/flashcards/contract.ts';
import { textKey } from './cardText';
import { createDeck, type DeckOpOptions } from './deckOps';
import { createId, isValidId } from './ids';
import type { AppData, Card } from './types';

/**
 * Generated cards on their way into the collection. Snap Notes has one kind
 * of card, with a term and a definition; every generated kind is written as
 * one, so a saved card works everywhere an ordinary card does (Review, Study,
 * Quiz, Learn, Match, sync, analytics) and can be edited like any other.
 */

const CHOICE_LETTERS = 'ABCDE';

/** The term and definition a generated card is saved as. */
export function toCardText(card: GeneratedCard): { term: string; definition: string } {
  const question = card.question.trim();
  const answer = card.answer.trim();
  if (card.kind !== 'multiple-choice') return { term: question, definition: answer };

  // The options go on the front; the back names the right one by letter and text.
  const choices = card.choices.map((choice) => choice.trim());
  const lines = choices.map((choice, i) => `${CHOICE_LETTERS[i]}. ${choice}`);
  const correct = choices.indexOf(answer);
  return {
    term: `${question}\n\n${lines.join('\n')}`,
    definition: correct === -1 ? answer : `${CHOICE_LETTERS[correct]}. ${answer}`,
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The same card as another kind, keeping as much as can be kept. Converting
 * to multiple choice keeps the answer as the first option and leaves the
 * other options for the user to write; converting to fill-in-the-blank blanks
 * out the answer where the question contains it.
 */
export function convertKind(card: GeneratedCard, kind: CardKind): GeneratedCard {
  if (card.kind === kind) return card;
  const base = { ...card, kind };
  if (kind === 'multiple-choice') {
    return { ...base, choices: [card.answer.trim(), '', '', ''] };
  }
  const next = { ...base, choices: [] };
  if (kind === 'fill-blank' && !card.question.includes(BLANK) && card.answer.trim() !== '') {
    const pattern = new RegExp(escapeRegExp(card.answer.trim()), 'i');
    if (pattern.test(card.question))
      return { ...next, question: card.question.replace(pattern, BLANK) };
  }
  return next;
}

/** Where saved cards go: a deck that exists, or a new one created in the same write. */
export type SaveTarget = { deckId: string } | { newDeckName: string };

export interface CardText {
  term: string;
  definition: string;
}

export type AddCardsResult =
  | {
      ok: true;
      data: AppData;
      /** The deck the cards went into; for a new deck, its new ID. */
      deckId: string;
      /** One entry per input: the new card's ID, or null when it was already in the deck. */
      cardIds: (string | null)[];
    }
  | { ok: false; message: string };

function cardKey(deckId: string, card: CardText): string {
  return `${deckId}\u0000${textKey(card.term)}\u0000${textKey(card.definition)}`;
}

/**
 * Adds several cards to one deck in a single result, creating the deck first
 * when asked to. Nothing is half-done: if the deck cannot be created, no card
 * is added.
 *
 * A card the deck already holds (same term and definition, ignoring case and
 * spacing; the rule import uses) is skipped rather than added twice, so saving
 * again after a failed or interrupted save never duplicates a card.
 */
export function addCards(
  data: AppData,
  target: SaveTarget,
  inputs: readonly CardText[],
  options: DeckOpOptions = {},
): AddCardsResult {
  const now = options.now ?? Date.now();
  const newId = options.createId ?? createId;

  let next = data;
  let deckId: string;
  if ('newDeckName' in target) {
    const created = createDeck(data, target.newDeckName, { now, createId: newId });
    if (!created.ok) return created;
    next = created.data;
    deckId = next.decks[next.decks.length - 1]!.id;
  } else {
    if (!data.decks.some((deck) => deck.id === target.deckId)) {
      return { ok: false, message: 'That deck no longer exists. Choose another one.' };
    }
    deckId = target.deckId;
  }

  const known = new Set(
    next.cards.filter((c) => c.deckId === deckId).map((c) => cardKey(deckId, c)),
  );
  const usedIds = new Set(next.cards.map((card) => card.id));
  const added: Card[] = [];
  const cardIds = inputs.map((input) => {
    const key = cardKey(deckId, input);
    if (known.has(key)) return null;
    known.add(key);
    let id = newId();
    while (usedIds.has(id) || !isValidId(id)) id = newId();
    usedIds.add(id);
    added.push({
      id,
      deckId,
      term: input.term,
      definition: input.definition,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  });

  return { ok: true, data: { ...next, cards: [...next.cards, ...added] }, deckId, cardIds };
}
