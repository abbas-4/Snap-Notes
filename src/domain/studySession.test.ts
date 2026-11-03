import { describe, expect, it } from 'vitest';
import { DEFAULT_DECK_ID } from './appData';
import {
  currentStudyCard,
  isFirstStudyCard,
  isLastStudyCard,
  startStudy,
  studyReducer,
  type StudyAction,
  type StudyState,
} from './studySession';
import type { Card } from './types';

function card(id: string): Card {
  return {
    id,
    deckId: DEFAULT_DECK_ID,
    term: `term ${id}`,
    definition: `def ${id}`,
    createdAt: 1,
    updatedAt: 1,
  };
}

const cards = [card('a'), card('b'), card('c')];

function run(state: StudyState, ...actions: StudyAction[]): StudyState {
  return actions.reduce(studyReducer, state);
}

describe('studyReducer', () => {
  it('starts on the first card with the definition hidden', () => {
    const state = startStudy(cards);

    expect(currentStudyCard(state)).toBe(cards[0]);
    expect(state.revealed).toBe(false);
    expect(isFirstStudyCard(state)).toBe(true);
    expect(isLastStudyCard(state)).toBe(false);
  });

  it('reveals and hides the definition of the current card', () => {
    const shown = run(startStudy(cards), { type: 'toggle', index: 0 });
    expect(shown.revealed).toBe(true);

    expect(run(shown, { type: 'toggle', index: 0 }).revealed).toBe(false);
  });

  it('moves forward and back, hiding the definition each time', () => {
    let state = run(startStudy(cards), { type: 'toggle', index: 0 }, { type: 'next', index: 0 });
    expect(state.index).toBe(1);
    expect(state.revealed).toBe(false);

    state = run(state, { type: 'toggle', index: 1 }, { type: 'previous', index: 1 });
    expect(state.index).toBe(0);
    expect(state.revealed).toBe(false);
  });

  it('never moves before the first card or past the last', () => {
    const start = startStudy(cards);
    expect(run(start, { type: 'previous', index: 0 })).toBe(start);

    const end = run(start, { type: 'next', index: 0 }, { type: 'next', index: 1 });
    expect(isLastStudyCard(end)).toBe(true);
    expect(run(end, { type: 'next', index: 2 })).toBe(end);
  });

  it('ignores actions aimed at a card that is no longer on screen', () => {
    // Two "next" events queued from the same render both name card 0.
    const state = run(startStudy(cards), { type: 'next', index: 0 }, { type: 'next', index: 0 });
    expect(state.index).toBe(1);

    // A late toggle for card 0 does not reveal card 1.
    expect(run(state, { type: 'toggle', index: 0 }).revealed).toBe(false);
    expect(run(state, { type: 'previous', index: 0 })).toBe(state);
  });

  it('handles a single card: no navigation and no shuffle', () => {
    const state = startStudy([card('only')]);

    expect(isFirstStudyCard(state) && isLastStudyCard(state)).toBe(true);
    expect(run(state, { type: 'next', index: 0 })).toBe(state);
    expect(run(state, { type: 'previous', index: 0 })).toBe(state);
    expect(run(state, { type: 'shuffle', cards: [card('only')] })).toBe(state);
    expect(run(state, { type: 'toggle', index: 0 }).revealed).toBe(true);
  });

  it('handles no cards without failing', () => {
    const state = startStudy([]);

    expect(currentStudyCard(state)).toBeUndefined();
    expect(run(state, { type: 'toggle', index: 0 })).toBe(state);
    expect(run(state, { type: 'next', index: 0 })).toBe(state);
  });

  it('shuffles back to the first card and can restore the original order', () => {
    const reordered = [cards[2]!, cards[0]!, cards[1]!];
    const shuffled = run(
      startStudy(cards),
      { type: 'next', index: 0 },
      { type: 'toggle', index: 1 },
      { type: 'shuffle', cards: reordered },
    );

    expect(shuffled.cards).toEqual(reordered);
    expect(shuffled).toMatchObject({ index: 0, revealed: false, shuffled: true });

    const restored = run(shuffled, { type: 'next', index: 0 }, { type: 'unshuffle' });
    expect(restored.cards).toEqual(cards);
    expect(restored).toMatchObject({ index: 0, shuffled: false });
  });

  it('rejects a "shuffle" that is not a reordering of the same cards', () => {
    const state = startStudy(cards);

    expect(run(state, { type: 'shuffle', cards: cards.slice(0, 2) })).toBe(state);
    expect(run(state, { type: 'shuffle', cards: [cards[0]!, cards[0]!, cards[1]!] })).toBe(state);
    expect(run(state, { type: 'shuffle', cards: [...cards.slice(0, 2), card('x')] })).toBe(state);
  });

  it('starts over from the first card, keeping the order', () => {
    const reordered = [cards[1]!, cards[2]!, cards[0]!];
    const state = run(
      startStudy(cards),
      { type: 'shuffle', cards: reordered },
      { type: 'next', index: 0 },
      { type: 'next', index: 1 },
      { type: 'toggle', index: 2 },
      { type: 'restart' },
    );

    expect(state).toMatchObject({ index: 0, revealed: false, shuffled: true, cards: reordered });
  });
});
