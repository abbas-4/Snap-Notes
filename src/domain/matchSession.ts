import type { MatchRound, MatchTile } from './match';
import type { Timestamp } from './types';

/**
 * State for one Match round.
 *
 * The user selects a tile, then a tile from the other list. A matching pair is
 * locked in; a wrong pair is recorded as a mistake and stays marked until the
 * next selection. Nothing happens on a timer, so feedback can't be cut short
 * and clicks are never dropped while it shows.
 *
 * Time comes in on each action (`at`) instead of being read here, so the
 * reducer stays pure and the clock can be controlled in tests.
 */
export interface MatchState {
  /** Changes on every restart, so actions from an earlier round are ignored. */
  sessionId: number;
  round: MatchRound;
  /** The tile waiting for a partner, if any. */
  selected: string | null;
  /** Pair IDs matched so far, in order. */
  matched: readonly string[];
  /** Every attempted pair, right or wrong. */
  attempts: readonly MatchAttempt[];
  /** The attempt just made, kept until the next selection so it can be shown. */
  lastAttempt: MatchAttempt | null;
  /** When the first tile was selected. */
  startedAt: Timestamp | null;
  /** When the last pair was matched. */
  finishedAt: Timestamp | null;
}

export interface MatchAttempt {
  termId: string;
  definitionId: string;
  correct: boolean;
}

export type MatchAction =
  | { type: 'select'; sessionId: number; tileId: string; at: Timestamp }
  /** Starts a new round. The round is built by the caller so the reducer stays pure. */
  | { type: 'restart'; round: MatchRound };

export type MatchPhase = 'playing' | 'finished';

export function startMatch(round: MatchRound, sessionId = 1): MatchState {
  return {
    sessionId,
    round,
    selected: null,
    matched: [],
    attempts: [],
    lastAttempt: null,
    startedAt: null,
    finishedAt: null,
  };
}

export function pairCount(state: MatchState): number {
  return state.round.terms.length;
}

export function matchPhase(state: MatchState): MatchPhase {
  return state.matched.length >= pairCount(state) ? 'finished' : 'playing';
}

export function mistakeCount(state: MatchState): number {
  return state.attempts.filter((attempt) => !attempt.correct).length;
}

/** Share of attempts that were correct, from 0 to 1. 1 before any attempt. */
export function matchAccuracy(state: MatchState): number {
  if (state.attempts.length === 0) return 1;
  return state.matched.length / state.attempts.length;
}

/** Milliseconds since the first selection, frozen once the round is finished. */
export function elapsedMs(state: MatchState, now: Timestamp): number {
  if (state.startedAt === null) return 0;
  return Math.max(0, (state.finishedAt ?? now) - state.startedAt);
}

export function findTile(state: MatchState, tileId: string): MatchTile | undefined {
  return (
    state.round.terms.find((tile) => tile.id === tileId) ??
    state.round.definitions.find((tile) => tile.id === tileId)
  );
}

export function isTileMatched(state: MatchState, tile: MatchTile): boolean {
  return state.matched.includes(tile.pairId);
}

export function matchReducer(state: MatchState, action: MatchAction): MatchState {
  switch (action.type) {
    case 'select': {
      if (action.sessionId !== state.sessionId || matchPhase(state) === 'finished') return state;
      const tile = findTile(state, action.tileId);
      if (!tile || isTileMatched(state, tile)) return state;

      const started = { ...state, startedAt: state.startedAt ?? action.at, lastAttempt: null };
      const partner = state.selected === null ? undefined : findTile(state, state.selected);

      // Nothing selected yet, or a different tile on the same side: (re)select.
      if (!partner || (partner.side === tile.side && partner.id !== tile.id)) {
        return { ...started, selected: tile.id };
      }
      // The selected tile again: deselect.
      if (partner.id === tile.id) return { ...started, selected: null };

      const [term, definition] = tile.side === 'term' ? [tile, partner] : [partner, tile];
      const attempt = {
        termId: term.id,
        definitionId: definition.id,
        correct: term.pairId === definition.pairId,
      };
      const matched = attempt.correct ? [...state.matched, term.pairId] : state.matched;
      return {
        ...started,
        selected: null,
        matched,
        attempts: [...state.attempts, attempt],
        lastAttempt: attempt,
        finishedAt: matched.length >= pairCount(state) ? action.at : null,
      };
    }
    case 'restart':
      return startMatch(action.round, state.sessionId + 1);
  }
}
