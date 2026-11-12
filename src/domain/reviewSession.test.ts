import { describe, expect, it } from 'vitest';
import { makeCard } from '../test/renderApp';
import {
  AGAIN_GAP,
  currentReviewCard,
  reviewPhase,
  reviewReducer,
  reviewSummary,
  startReview,
  type ReviewState,
} from './reviewSession';
import type { ReviewGrade } from './srs';

const cards = Array.from({ length: 5 }, (_, index) => makeCard({ id: `card-${index + 1}` }));

function reveal(state: ReviewState): ReviewState {
  return reviewReducer(state, {
    type: 'reveal',
    sessionId: state.sessionId,
    turn: state.turn,
  });
}

function answer(state: ReviewState, grade: ReviewGrade): ReviewState {
  return reviewReducer(reveal(state), {
    type: 'grade',
    sessionId: state.sessionId,
    turn: state.turn,
    grade,
  });
}

describe('startReview', () => {
  it('queues the cards in the order they were given', () => {
    const state = startReview(cards);
    expect(state.queue).toEqual(cards.map((card) => card.id));
    expect(reviewPhase(state)).toBe('prompt');
    expect(currentReviewCard(state)?.id).toBe('card-1');
  });

  it('keeps only the first of any repeated card', () => {
    const state = startReview([cards[0]!, cards[1]!, cards[0]!]);
    expect(state.cards).toHaveLength(2);
  });

  it('is finished straight away when there is nothing to review', () => {
    expect(reviewPhase(startReview([]))).toBe('finished');
    expect(currentReviewCard(startReview([]))).toBeUndefined();
  });
});

describe('answering', () => {
  it('reveals the definition before a grade is accepted', () => {
    const state = startReview(cards);
    const graded = reviewReducer(state, {
      type: 'grade',
      sessionId: state.sessionId,
      turn: state.turn,
      grade: 'good',
    });
    expect(graded).toBe(state);
    expect(reviewPhase(reveal(state))).toBe('revealed');
  });

  it('moves on when a card is remembered', () => {
    const state = answer(startReview(cards), 'good');
    expect(state.queue).toEqual(['card-2', 'card-3', 'card-4', 'card-5']);
    expect(state.revealed).toBe(false);
    expect(state.answers).toEqual([{ cardId: 'card-1', grade: 'good' }]);
  });

  it('brings a forgotten card back a few cards later', () => {
    const state = answer(startReview(cards), 'again');
    expect(state.queue).toEqual(['card-2', 'card-3', 'card-4', 'card-1', 'card-5']);
    expect(state.queue[AGAIN_GAP]).toBe('card-1');
  });

  it('puts a forgotten card at the end when the queue is short', () => {
    const state = answer(startReview([cards[0]!, cards[1]!]), 'again');
    expect(state.queue).toEqual(['card-2', 'card-1']);
  });

  it('ignores an answer aimed at a turn that has passed', () => {
    const first = answer(startReview(cards), 'good');
    const stale = reviewReducer(reveal(first), {
      type: 'grade',
      sessionId: first.sessionId,
      turn: first.turn - 1,
      grade: 'again',
    });
    expect(stale.answers).toHaveLength(1);
  });

  it('ignores an answer from an earlier session', () => {
    const restarted = reviewReducer(startReview(cards), { type: 'restart', cards });
    const stale = reviewReducer(reveal(restarted), {
      type: 'grade',
      sessionId: restarted.sessionId - 1,
      turn: restarted.turn,
      grade: 'good',
    });
    expect(stale.answers).toHaveLength(0);
  });

  it('finishes once every card has been remembered', () => {
    let state = startReview([cards[0]!, cards[1]!]);
    state = answer(state, 'good');
    state = answer(state, 'easy');
    expect(reviewPhase(state)).toBe('finished');
    expect(state.ended).toBe(false);
  });
});

describe('ending early', () => {
  it('stops the session and leaves the rest of the queue', () => {
    const state = reviewReducer(answer(startReview(cards), 'good'), {
      type: 'end',
      sessionId: 1,
    });
    expect(reviewPhase(state)).toBe('finished');
    expect(state.ended).toBe(true);
    expect(reviewSummary(state).remaining).toBe(4);
  });

  it('starts a new session on restart, with a new id', () => {
    const ended = reviewReducer(startReview(cards), { type: 'end', sessionId: 1 });
    const restarted = reviewReducer(ended, { type: 'restart', cards: [cards[0]!] });
    expect(restarted.sessionId).toBe(2);
    expect(restarted.cards).toHaveLength(1);
    expect(reviewPhase(restarted)).toBe('prompt');
  });
});

describe('reviewSummary', () => {
  it('counts the grades given and how many cards are done', () => {
    let state = startReview([cards[0]!, cards[1]!, cards[2]!]);
    state = answer(state, 'again');
    state = answer(state, 'good');
    state = answer(state, 'hard');
    state = answer(state, 'easy');

    const summary = reviewSummary(state);
    expect(summary.graded).toBe(4);
    expect(summary.byGrade).toEqual({ again: 1, hard: 1, good: 1, easy: 1 });
    expect(summary.correct).toBe(3);
    expect(summary.again).toBe(1);
    expect(summary.accuracy).toBeCloseTo(0.75);
    expect(summary.total).toBe(3);
    // The forgotten card came back and was answered again, so all three are done.
    expect(summary.completed).toBe(3);
  });

  it('reports nothing graded for a session that has not started', () => {
    expect(reviewSummary(startReview(cards))).toMatchObject({
      graded: 0,
      accuracy: 0,
      completed: 0,
    });
  });
});
