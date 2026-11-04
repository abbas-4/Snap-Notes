import { describe, expect, it } from 'vitest';
import type { MatchRound, MatchSide, MatchTile } from './match';
import {
  elapsedMs,
  matchAccuracy,
  matchPhase,
  matchReducer,
  mistakeCount,
  startMatch,
  type MatchAction,
  type MatchState,
} from './matchSession';

function tile(side: MatchSide, pairId: string): MatchTile {
  return { id: `${side}:${pairId}`, pairId, side, text: `${side} ${pairId}` };
}

function round(...pairIds: string[]): MatchRound {
  return {
    terms: pairIds.map((id) => tile('term', id)),
    definitions: [...pairIds].reverse().map((id) => tile('definition', id)),
  };
}

const T = (id: string) => `term:${id}`;
const D = (id: string) => `definition:${id}`;

function select(state: MatchState, tileId: string, at = 1000): MatchAction {
  return { type: 'select', sessionId: state.sessionId, tileId, at };
}

/** Selects each tile in turn, at one-second intervals starting from `from`. */
function pick(state: MatchState, tileIds: string[], from = 1000): MatchState {
  return tileIds.reduce((s, id, i) => matchReducer(s, select(s, id, from + i * 1000)), state);
}

describe('matchReducer', () => {
  it('starts with nothing selected, no score and no time', () => {
    const state = startMatch(round('a', 'b', 'c'));

    expect(matchPhase(state)).toBe('playing');
    expect(state.selected).toBeNull();
    expect(mistakeCount(state)).toBe(0);
    expect(elapsedMs(state, 99_999)).toBe(0);
  });

  it('selects a tile and starts the clock on the first selection', () => {
    const state = pick(startMatch(round('a', 'b')), [T('a')], 5000);

    expect(state.selected).toBe(T('a'));
    expect(state.startedAt).toBe(5000);
    expect(elapsedMs(state, 8000)).toBe(3000);
  });

  it('matches a term with its definition, from either side', () => {
    let state = pick(startMatch(round('a', 'b', 'c')), [T('a'), D('a')]);
    expect(state.matched).toEqual(['a']);
    expect(state.selected).toBeNull();
    expect(state.lastAttempt).toEqual({ termId: T('a'), definitionId: D('a'), correct: true });

    state = pick(state, [D('b'), T('b')]);
    expect(state.matched).toEqual(['a', 'b']);
    expect(mistakeCount(state)).toBe(0);
  });

  it('records a wrong pair as a mistake and keeps it marked until the next selection', () => {
    let state = pick(startMatch(round('a', 'b', 'c')), [T('a'), D('b')]);

    expect(state.matched).toEqual([]);
    expect(state.selected).toBeNull();
    expect(mistakeCount(state)).toBe(1);
    expect(state.lastAttempt).toEqual({ termId: T('a'), definitionId: D('b'), correct: false });

    state = pick(state, [T('c')]);
    expect(state.lastAttempt).toBeNull();
    expect(state.selected).toBe(T('c'));
  });

  it('switches the selection within a side without counting a mistake', () => {
    const state = pick(startMatch(round('a', 'b')), [T('a'), T('b')]);

    expect(state.selected).toBe(T('b'));
    expect(state.attempts).toEqual([]);
  });

  it('deselects a tile selected twice', () => {
    const state = pick(startMatch(round('a', 'b')), [D('a'), D('a')]);

    expect(state.selected).toBeNull();
    expect(state.attempts).toEqual([]);
  });

  it('ignores matched tiles and tiles that do not exist', () => {
    const state = pick(startMatch(round('a', 'b', 'c')), [T('a'), D('a')]);

    expect(matchReducer(state, select(state, T('a')))).toBe(state);
    expect(matchReducer(state, select(state, D('a')))).toBe(state);
    expect(matchReducer(state, select(state, 'term:zzz'))).toBe(state);
  });

  it('finishes on the last match, stopping the clock', () => {
    const state = pick(startMatch(round('a', 'b')), [
      T('a'),
      D('b'),
      T('a'),
      D('a'),
      T('b'),
      D('b'),
    ]);

    expect(matchPhase(state)).toBe('finished');
    expect(state.startedAt).toBe(1000);
    expect(state.finishedAt).toBe(6000);
    expect(elapsedMs(state, 60_000)).toBe(5000);
    expect(mistakeCount(state)).toBe(1);
    expect(matchAccuracy(state)).toBeCloseTo(2 / 3);

    // Nothing more can be selected.
    expect(matchReducer(state, select(state, T('a')))).toBe(state);
  });

  it('restarts with a new round that ignores actions from the old one', () => {
    const old = pick(startMatch(round('a', 'b')), [T('a')]);
    const restarted = matchReducer(old, { type: 'restart', round: round('a', 'b') });

    expect(restarted.sessionId).not.toBe(old.sessionId);
    expect(restarted).toMatchObject({ selected: null, matched: [], attempts: [], startedAt: null });
    // A click queued against the old round is dropped, even though the tile exists.
    expect(matchReducer(restarted, select(old, D('a')))).toBe(restarted);
  });

  it('reports full accuracy before any attempt', () => {
    expect(matchAccuracy(startMatch(round('a', 'b')))).toBe(1);
  });
});
