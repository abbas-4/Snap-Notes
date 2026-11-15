import { describe, expect, it } from 'vitest';
import {
  GOAL_DEFINITIONS,
  isGoalKind,
  MAX_GOAL_CHANGES,
  mergeGoal,
  parseGoalTarget,
  setGoal,
  targetAt,
  type StudyGoal,
} from './studyGoals';

const T = 1_800_000_000_000;

describe('goal targets typed into the form', () => {
  it('accepts whole numbers within each kind’s range', () => {
    expect(parseGoalTarget('cards-per-day', ' 30 ')).toEqual({ ok: true, target: 30 });
    expect(parseGoalTarget('days-per-week', '7')).toEqual({ ok: true, target: 7 });
  });

  it('refuses anything else, saying what is allowed', () => {
    expect(parseGoalTarget('cards-per-day', '')).toMatchObject({ ok: false });
    expect(parseGoalTarget('cards-per-day', '2.5')).toMatchObject({ ok: false });
    expect(parseGoalTarget('cards-per-day', '-3')).toMatchObject({ ok: false });
    expect(parseGoalTarget('days-per-week', '8')).toEqual({
      ok: false,
      message: 'Choose between 1 and 7 days.',
    });
    expect(parseGoalTarget('minutes-per-day', '0')).toMatchObject({ ok: false });
  });

  it('knows the goal kinds', () => {
    expect(isGoalKind('sessions-per-week')).toBe(true);
    expect(isGoalKind('pages-per-day')).toBe(false);
    expect(GOAL_DEFINITIONS['days-per-week'].period).toBe('week');
  });
});

describe('setting goals', () => {
  it('records every change with its time, and switching off keeps the history', () => {
    let goals = setGoal([], 'cards-per-day', 20, T);
    goals = setGoal(goals, 'cards-per-day', 30, T + 1000);
    goals = setGoal(goals, 'cards-per-day', null, T + 2000);
    expect(goals).toEqual([
      {
        id: 'cards-per-day',
        target: null,
        updatedAt: T + 2000,
        changes: [
          { at: T, target: 20 },
          { at: T + 1000, target: 30 },
          { at: T + 2000, target: null },
        ],
      },
    ]);
  });

  it('treats setting the same target as no change', () => {
    const goals = setGoal([], 'cards-per-day', 20, T);
    expect(setGoal(goals, 'cards-per-day', 20, T + 5)).toEqual(goals);
    expect(setGoal([], 'cards-per-day', null, T)).toEqual([]);
  });

  it('never dates a change before the last one, even when the clock went back', () => {
    const goals = setGoal(setGoal([], 'cards-per-day', 20, T), 'cards-per-day', 25, T - 50);
    expect(goals[0]?.updatedAt).toBe(T);
  });

  it('keeps goals in a fixed order and at most the newest changes', () => {
    let goals = setGoal([], 'days-per-week', 3, T);
    goals = setGoal(goals, 'cards-per-day', 5, T);
    expect(goals.map((g) => g.id)).toEqual(['cards-per-day', 'days-per-week']);
    for (let i = 0; i < MAX_GOAL_CHANGES + 10; i += 1) {
      goals = setGoal(goals, 'cards-per-day', 10 + i, T + i + 1);
    }
    const changes = goals[0]?.changes ?? [];
    expect(changes).toHaveLength(MAX_GOAL_CHANGES);
    expect(changes[changes.length - 1]?.target).toBe(10 + MAX_GOAL_CHANGES + 9);
  });
});

describe('the target at a moment', () => {
  const goal: StudyGoal = {
    id: 'cards-per-day',
    target: 40,
    updatedAt: T + 200,
    changes: [
      { at: T, target: 20 },
      { at: T + 100, target: null },
      { at: T + 200, target: 40 },
    ],
  };

  it('is the target in force then', () => {
    expect(targetAt(goal, T - 1)).toBeNull();
    expect(targetAt(goal, T)).toBe(20);
    expect(targetAt(goal, T + 150)).toBeNull();
    expect(targetAt(goal, T + 999)).toBe(40);
    expect(targetAt(undefined, T)).toBeNull();
  });
});

describe('merging a goal changed on two devices', () => {
  const here: StudyGoal = {
    id: 'cards-per-day',
    target: 15,
    updatedAt: T + 10,
    changes: [
      { at: T, target: 10 },
      { at: T + 10, target: 15 },
    ],
  };
  const there: StudyGoal = {
    id: 'cards-per-day',
    target: 25,
    updatedAt: T + 20,
    changes: [
      { at: T, target: 10 },
      { at: T + 20, target: 25 },
    ],
  };

  it('takes the later target and keeps both histories', () => {
    const merged = mergeGoal(here, there);
    expect(merged.target).toBe(25);
    expect(merged.updatedAt).toBe(T + 20);
    expect(merged.changes).toEqual([
      { at: T, target: 10 },
      { at: T + 10, target: 15 },
      { at: T + 20, target: 25 },
    ]);
    expect(mergeGoal(there, here)).toEqual(merged);
  });

  it('chooses the same side on a tie on every device', () => {
    const tie = { ...here, updatedAt: there.updatedAt };
    expect(mergeGoal(tie, there).target).toBe(25);
  });
});
