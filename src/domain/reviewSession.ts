import type { ReviewGrade } from './srs';
import type { Card } from './types';

/**
 * State for one review session.
 *
 * The cards come from `buildReviewQueue`, already in priority order. The card
 * at the front of the queue is on screen: the term shows first, the user
 * reveals the definition, then grades their recall. Every grade but "again"
 * takes the card out of the session; "again" puts it back a few cards later so
 * it is seen again before the session ends, which is also what the scheduler
 * does with it in the long run.
 *
 * Like the Learn session, actions name the turn they were taken on, so a click
 * or key press that arrives after the screen has moved on is ignored instead
 * of landing on the next card.
 */

export interface ReviewAnswer {
  cardId: string;
  grade: ReviewGrade;
}

export interface ReviewState {
  /** Changes on every restart, so actions from an earlier run are ignored. */
  sessionId: number;
  /** The cards in this session, in the order they were queued. */
  cards: readonly Card[];
  /** IDs still to answer. The first one is on screen. */
  queue: readonly string[];
  /** Goes up by one with every grade. */
  turn: number;
  revealed: boolean;
  /** Every grade given this session, in order. */
  answers: readonly ReviewAnswer[];
  /** Set when the user ends the session early. */
  ended: boolean;
}

export type ReviewAction =
  | { type: 'reveal'; sessionId: number; turn: number }
  | { type: 'grade'; sessionId: number; turn: number; grade: ReviewGrade }
  | { type: 'end'; sessionId: number }
  /** Starts a new run over the given cards, chosen by the caller. */
  | { type: 'restart'; cards: readonly Card[] };

export type ReviewPhase = 'prompt' | 'revealed' | 'finished';

/** How many other cards are shown before a forgotten card comes back. */
export const AGAIN_GAP = 3;

export function startReview(cards: readonly Card[], sessionId = 1): ReviewState {
  // Duplicate IDs would make the queue ambiguous, so only the first copy is kept.
  const seen = new Set<string>();
  const unique = cards.filter((card) => {
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });
  return {
    sessionId,
    cards: unique,
    queue: unique.map((card) => card.id),
    turn: 0,
    revealed: false,
    answers: [],
    ended: false,
  };
}

export function reviewPhase(state: ReviewState): ReviewPhase {
  if (state.ended || state.queue.length === 0) return 'finished';
  return state.revealed ? 'revealed' : 'prompt';
}

export function currentReviewCard(state: ReviewState): Card | undefined {
  if (reviewPhase(state) === 'finished') return undefined;
  const id = state.queue[0];
  return state.cards.find((card) => card.id === id);
}

export interface ReviewSummary {
  /** Cards in the session. */
  total: number;
  /** Cards answered at least once without needing another look. */
  completed: number;
  /** Grades given, which can exceed `total` when cards came back. */
  graded: number;
  byGrade: Record<ReviewGrade, number>;
  correct: number;
  again: number;
  /** Correct answers as a share of the grades given, from 0 to 1. */
  accuracy: number;
  /** Cards still in the queue when the session ended. */
  remaining: number;
}

export function reviewSummary(state: ReviewState): ReviewSummary {
  const byGrade: Record<ReviewGrade, number> = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const answer of state.answers) byGrade[answer.grade] += 1;

  const graded = state.answers.length;
  const again = byGrade.again;
  const correct = graded - again;
  return {
    total: state.cards.length,
    completed: state.cards.length - state.queue.length,
    graded,
    byGrade,
    correct,
    again,
    accuracy: graded === 0 ? 0 : correct / graded,
    remaining: state.queue.length,
  };
}

function isCurrent(state: ReviewState, action: { sessionId: number; turn: number }): boolean {
  return action.sessionId === state.sessionId && action.turn === state.turn;
}

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'reveal':
      if (!isCurrent(state, action) || reviewPhase(state) !== 'prompt') return state;
      return { ...state, revealed: true };
    case 'grade': {
      if (!isCurrent(state, action) || reviewPhase(state) !== 'revealed') return state;
      const [id, ...rest] = state.queue;
      if (id === undefined) return state;
      const next = {
        ...state,
        turn: state.turn + 1,
        revealed: false,
        answers: [...state.answers, { cardId: id, grade: action.grade }],
      };
      if (action.grade !== 'again') return { ...next, queue: rest };
      const at = Math.min(AGAIN_GAP, rest.length);
      return { ...next, queue: [...rest.slice(0, at), id, ...rest.slice(at)] };
    }
    case 'end':
      if (action.sessionId !== state.sessionId || reviewPhase(state) === 'finished') return state;
      return { ...state, ended: true, revealed: false };
    case 'restart':
      return startReview(action.cards, state.sessionId + 1);
  }
}
