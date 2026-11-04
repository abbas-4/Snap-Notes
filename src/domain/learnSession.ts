import { hasBothSides } from './cardText';
import type { RandomFn } from './random';
import { shuffle } from './shuffle';
import type { Card } from './types';

/**
 * State for a guided Learn session.
 *
 * Cards wait in a queue. The card at the front is on screen: its term shows
 * first, the user reveals the definition, then says whether they knew it.
 * A known card is mastered and leaves the queue. A card the user is still
 * learning goes back into the queue a few cards later, so it comes round again
 * soon but not straight away.
 *
 * The queue position of a card is not stable, so actions name the `turn` they
 * were taken on instead of an index. Each grade starts a new turn, and anything
 * aimed at an earlier turn or an earlier (restarted) session is ignored.
 */
export interface LearnState {
  /** Changes on every restart, so actions from an earlier run are ignored. */
  sessionId: number;
  /** The cards in this session, in the order they were first queued. */
  cards: readonly Card[];
  /** IDs of cards still to learn. The first one is on screen. */
  queue: readonly string[];
  /** Goes up by one with every grade. */
  turn: number;
  /** Whether the definition of the card on screen is showing. */
  revealed: boolean;
  /** IDs of mastered cards, in the order they were mastered. */
  mastered: readonly string[];
  /** How many times each card was marked "still learning". */
  misses: ReadonlyMap<string, number>;
  /** Set when the user ends the session before every card is mastered. */
  ended: boolean;
  /** The most recent grade, so the screen can confirm it. Null before the first. */
  lastGrade: { cardId: string; knew: boolean } | null;
}

export type LearnAction =
  | { type: 'reveal'; sessionId: number; turn: number }
  | { type: 'grade'; sessionId: number; turn: number; knew: boolean }
  | { type: 'end'; sessionId: number }
  /** Starts a new run. Cards are chosen and ordered by the caller so the reducer stays pure. */
  | { type: 'restart'; cards: readonly Card[] };

/** `prompt`: term only. `revealed`: definition showing, waiting for a grade. */
export type LearnPhase = 'prompt' | 'revealed' | 'finished';

/** How many other cards are shown before a missed card comes back. */
export const REQUEUE_GAP = 3;

/** A card can be learned only when both sides have visible text. */
export const isLearnEligible = hasBothSides;

/** The eligible cards in a random order, ready for `startLearn`. */
export function prepareLearnCards(cards: readonly Card[], random: RandomFn = Math.random): Card[] {
  return shuffle(cards.filter(isLearnEligible), random);
}

export function startLearn(cards: readonly Card[], sessionId = 1): LearnState {
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
    mastered: [],
    misses: new Map(),
    ended: false,
    lastGrade: null,
  };
}

export function learnPhase(state: LearnState): LearnPhase {
  if (state.ended || state.queue.length === 0) return 'finished';
  return state.revealed ? 'revealed' : 'prompt';
}

export function currentLearnCard(state: LearnState): Card | undefined {
  if (learnPhase(state) === 'finished') return undefined;
  const id = state.queue[0];
  return state.cards.find((card) => card.id === id);
}

export interface LearnResults {
  total: number;
  /** Mastered without ever being marked "still learning". */
  knownFirstTry: Card[];
  /** Cards marked "still learning" at least once, with how many times. */
  struggled: { card: Card; misses: number; mastered: boolean }[];
  /** Cards not yet mastered when the session ended. */
  unfinished: Card[];
}

export function learnResults(state: LearnState): LearnResults {
  const mastered = new Set(state.mastered);
  return {
    total: state.cards.length,
    knownFirstTry: state.cards.filter(
      (card) => mastered.has(card.id) && !state.misses.has(card.id),
    ),
    struggled: state.cards.flatMap((card) => {
      const misses = state.misses.get(card.id);
      return misses ? [{ card, misses, mastered: mastered.has(card.id) }] : [];
    }),
    unfinished: state.cards.filter((card) => !mastered.has(card.id)),
  };
}

function isCurrent(state: LearnState, action: { sessionId: number; turn: number }): boolean {
  return action.sessionId === state.sessionId && action.turn === state.turn;
}

export function learnReducer(state: LearnState, action: LearnAction): LearnState {
  switch (action.type) {
    case 'reveal':
      if (!isCurrent(state, action) || learnPhase(state) !== 'prompt') return state;
      return { ...state, revealed: true };
    case 'grade': {
      if (!isCurrent(state, action) || learnPhase(state) !== 'revealed') return state;
      const [id, ...rest] = state.queue;
      if (id === undefined) return state;
      const next = {
        ...state,
        turn: state.turn + 1,
        revealed: false,
        lastGrade: { cardId: id, knew: action.knew },
      };
      if (action.knew) {
        return { ...next, queue: rest, mastered: [...state.mastered, id] };
      }
      const at = Math.min(REQUEUE_GAP, rest.length);
      const misses = new Map(state.misses).set(id, (state.misses.get(id) ?? 0) + 1);
      return { ...next, queue: [...rest.slice(0, at), id, ...rest.slice(at)], misses };
    }
    case 'end':
      if (action.sessionId !== state.sessionId || learnPhase(state) === 'finished') return state;
      return { ...state, ended: true, revealed: false };
    case 'restart':
      return startLearn(action.cards, state.sessionId + 1);
  }
}
