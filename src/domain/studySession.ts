import type { Card } from './types';

/**
 * State for flipping through cards one at a time.
 *
 * Every action that acts on a card names the position it was taken at, so an
 * event that arrives after the view has moved on (a second key press, a click
 * queued before a re-render) is ignored instead of acting on another card.
 */
export interface StudyState {
  /** The cards in the order they are being studied. */
  cards: readonly Card[];
  /** The cards in the order they were given, so a shuffle can be undone. */
  original: readonly Card[];
  index: number;
  /** Whether the definition of the current card is showing. */
  revealed: boolean;
  shuffled: boolean;
}

export type StudyAction =
  | { type: 'toggle'; index: number }
  | { type: 'next'; index: number }
  | { type: 'previous'; index: number }
  /** Back to the first card, keeping the current order. */
  | { type: 'restart' }
  /** `cards` must be a reordering of the original cards, shuffled by the caller. */
  | { type: 'shuffle'; cards: readonly Card[] }
  | { type: 'unshuffle' };

export function startStudy(cards: readonly Card[]): StudyState {
  return { cards, original: cards, index: 0, revealed: false, shuffled: false };
}

export function currentStudyCard(state: StudyState): Card | undefined {
  return state.cards[state.index];
}

export function isFirstStudyCard(state: StudyState): boolean {
  return state.index <= 0;
}

export function isLastStudyCard(state: StudyState): boolean {
  return state.index >= state.cards.length - 1;
}

function isReorderingOf(cards: readonly Card[], original: readonly Card[]): boolean {
  if (cards.length !== original.length) return false;
  const ids = new Set(original.map((card) => card.id));
  return (
    cards.every((card) => ids.has(card.id)) && new Set(cards.map((c) => c.id)).size === ids.size
  );
}

export function studyReducer(state: StudyState, action: StudyAction): StudyState {
  switch (action.type) {
    case 'toggle':
      if (action.index !== state.index || state.cards.length === 0) return state;
      return { ...state, revealed: !state.revealed };
    case 'next':
      if (action.index !== state.index || isLastStudyCard(state)) return state;
      return { ...state, index: state.index + 1, revealed: false };
    case 'previous':
      if (action.index !== state.index || isFirstStudyCard(state)) return state;
      return { ...state, index: state.index - 1, revealed: false };
    case 'restart':
      if (state.index === 0 && !state.revealed) return state;
      return { ...state, index: 0, revealed: false };
    case 'shuffle':
      if (state.cards.length < 2 || !isReorderingOf(action.cards, state.original)) return state;
      return { ...state, cards: action.cards, index: 0, revealed: false, shuffled: true };
    case 'unshuffle':
      if (!state.shuffled) return state;
      return { ...state, cards: state.original, index: 0, revealed: false, shuffled: false };
  }
}
