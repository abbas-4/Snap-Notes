import { describe, expect, it } from 'vitest';
import { DEFAULT_DECK_ID } from './appData';
import {
  currentLearnCard,
  learnPhase,
  learnReducer,
  learnResults,
  prepareLearnCards,
  REQUEUE_GAP,
  startLearn,
  type LearnAction,
  type LearnState,
} from './learnSession';
import { createSeededRandom } from './random';
import type { Card } from './types';

function card(id: string, term = `term ${id}`, definition = `def ${id}`): Card {
  return { id, deckId: DEFAULT_DECK_ID, term, definition, createdAt: 1, updatedAt: 1 };
}

const cards = ['a', 'b', 'c', 'd', 'e'].map((id) => card(id));

function run(state: LearnState, ...actions: LearnAction[]): LearnState {
  return actions.reduce(learnReducer, state);
}

function reveal(state: LearnState, turn = state.turn): LearnAction {
  return { type: 'reveal', sessionId: state.sessionId, turn };
}

function grade(state: LearnState, knew: boolean, turn = state.turn): LearnAction {
  return { type: 'grade', sessionId: state.sessionId, turn, knew };
}

/** Reveals the card on screen, then grades it. */
function answer(state: LearnState, knew: boolean): LearnState {
  const revealed = run(state, reveal(state));
  return run(revealed, grade(revealed, knew));
}

describe('learnReducer', () => {
  it('starts on the first card with only the term showing', () => {
    const state = startLearn(cards);

    expect(currentLearnCard(state)).toBe(cards[0]);
    expect(learnPhase(state)).toBe('prompt');
    expect(state.queue).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('reveals the definition, then waits for a grade', () => {
    const start = startLearn(cards);
    const state = run(start, reveal(start));

    expect(learnPhase(state)).toBe('revealed');
    expect(currentLearnCard(state)).toBe(cards[0]);
    // Revealing again changes nothing.
    expect(run(state, reveal(state))).toBe(state);
  });

  it('ignores a grade before the definition is revealed', () => {
    const start = startLearn(cards);

    expect(run(start, grade(start, true))).toBe(start);
  });

  it('masters a known card and moves to the next one', () => {
    const state = answer(startLearn(cards), true);

    expect(state.mastered).toEqual(['a']);
    expect(state.queue).toEqual(['b', 'c', 'd', 'e']);
    expect(currentLearnCard(state)).toBe(cards[1]);
    expect(learnPhase(state)).toBe('prompt');
    expect(state.turn).toBe(1);
  });

  it(`brings a missed card back after ${REQUEUE_GAP} other cards`, () => {
    const state = answer(startLearn(cards), false);

    expect(state.queue).toEqual(['b', 'c', 'd', 'a', 'e']);
    expect(state.misses.get('a')).toBe(1);
    expect(state.mastered).toEqual([]);
  });

  it('puts a missed card at the end when fewer cards are left than the gap', () => {
    const state = answer(startLearn(cards.slice(0, 2)), false);

    expect(state.queue).toEqual(['b', 'a']);
  });

  it('shows a single missed card again until it is known', () => {
    let state = startLearn([card('only')]);
    state = answer(state, false);
    state = answer(state, false);

    expect(currentLearnCard(state)?.id).toBe('only');
    expect(state.misses.get('only')).toBe(2);

    state = answer(state, true);
    expect(learnPhase(state)).toBe('finished');
  });

  it('accepts only the first of several grades for the same card', () => {
    const start = startLearn(cards);
    const revealed = run(start, reveal(start));
    // Three clicks queued from the same render all name turn 0.
    const state = run(
      revealed,
      grade(revealed, true),
      grade(revealed, false),
      grade(revealed, true),
    );

    expect(state.mastered).toEqual(['a']);
    expect(state.misses.size).toBe(0);
    expect(state.turn).toBe(1);
  });

  it('ignores a reveal aimed at an earlier turn', () => {
    const state = answer(startLearn(cards), true);

    expect(run(state, reveal(state, 0))).toBe(state);
  });

  it('finishes once every card is mastered and then ignores everything but restart', () => {
    let state = startLearn(cards.slice(0, 3));
    state = answer(state, true);
    state = answer(state, false);
    while (learnPhase(state) !== 'finished') state = answer(state, true);

    expect(state.mastered).toEqual(['a', 'c', 'b']);
    expect(currentLearnCard(state)).toBeUndefined();
    expect(run(state, reveal(state), grade(state, true))).toBe(state);
    expect(run(state, { type: 'end', sessionId: state.sessionId })).toBe(state);
  });

  it('can end early, leaving the rest unfinished', () => {
    let state = answer(startLearn(cards), true);
    state = run(state, reveal(state), { type: 'end', sessionId: state.sessionId });

    expect(learnPhase(state)).toBe('finished');
    expect(state.ended).toBe(true);
    expect(learnResults(state).unfinished.map((c) => c.id)).toEqual(['b', 'c', 'd', 'e']);
  });

  it('restarts with a new session that ignores actions from the old one', () => {
    const old = run(startLearn(cards), reveal(startLearn(cards)));
    const restarted = run(old, { type: 'restart', cards: [card('x'), card('y')] });

    expect(restarted.sessionId).not.toBe(old.sessionId);
    expect(restarted).toMatchObject({ queue: ['x', 'y'], turn: 0, revealed: false, mastered: [] });

    // Both of these were valid for the old session at the same turn.
    expect(run(restarted, grade(old, true))).toBe(restarted);
    expect(run(restarted, reveal(old))).toBe(restarted);
    expect(run(restarted, { type: 'end', sessionId: old.sessionId })).toBe(restarted);
  });

  it('treats a session with no cards as already finished', () => {
    const state = startLearn([]);

    expect(learnPhase(state)).toBe('finished');
    expect(run(state, reveal(state))).toBe(state);
  });

  it('keeps only the first copy of a duplicated card ID', () => {
    const state = startLearn([card('a', 'First'), card('a', 'Second'), card('b')]);

    expect(state.queue).toEqual(['a', 'b']);
    expect(state.cards.map((c) => c.term)).toEqual(['First', 'term b']);
  });
});

describe('learnResults', () => {
  it('separates cards known first time from cards that needed review', () => {
    let state = startLearn(cards.slice(0, 3));
    state = answer(state, false); // a missed
    state = answer(state, true); // b
    state = answer(state, false); // c missed
    state = answer(state, false); // a missed again
    while (learnPhase(state) !== 'finished') state = answer(state, true);

    const results = learnResults(state);
    expect(results.total).toBe(3);
    expect(results.knownFirstTry.map((c) => c.id)).toEqual(['b']);
    expect(
      results.struggled.map(({ card, misses, mastered }) => [card.id, misses, mastered]),
    ).toEqual([
      ['a', 2, true],
      ['c', 1, true],
    ]);
    expect(results.unfinished).toEqual([]);
  });
});

describe('prepareLearnCards', () => {
  it('leaves out cards missing a side and shuffles the rest reproducibly', () => {
    const input = [...cards, card('blank', '', 'Oslo'), card('blank2', 'Norway', '  ')];
    const prepared = prepareLearnCards(input, createSeededRandom(3));

    expect(prepared.map((c) => c.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(prepared).toEqual(prepareLearnCards(input, createSeededRandom(3)));
  });
});
