import type { Timestamp } from './types';

/**
 * Study goals: targets the user sets for themselves, such as "30 cards a day".
 *
 * Each kind of goal is one record, so goals sync like everything else and two
 * devices changing different goals never meet. A goal is never deleted, only
 * switched off (`target: null`), so its history survives: every change is
 * kept with the time it was made, and past days and weeks are judged against
 * the target that applied then rather than today's.
 */

export const GOAL_KINDS = [
  'cards-per-day',
  'minutes-per-day',
  'sessions-per-week',
  'days-per-week',
] as const;

export type GoalKind = (typeof GOAL_KINDS)[number];

/** Whether a goal is met day by day or week by week. */
export type GoalPeriod = 'day' | 'week';

export interface GoalChange {
  at: Timestamp;
  /** The new target, or null when the goal was switched off. */
  target: number | null;
}

export interface StudyGoal {
  id: GoalKind;
  /** The current target, or null when the goal is off. */
  target: number | null;
  updatedAt: Timestamp;
  /** Every change, oldest first, at most {@link MAX_GOAL_CHANGES}. */
  changes: GoalChange[];
}

export interface GoalDefinition {
  kind: GoalKind;
  period: GoalPeriod;
  label: string;
  /** The unit, for "12 of 30 cards". */
  unit: (count: number) => string;
  min: number;
  max: number;
  /** A sensible starting value for the form. */
  suggested: number;
}

const plural = (one: string, many: string) => (count: number) => (count === 1 ? one : many);

export const GOAL_DEFINITIONS: Record<GoalKind, GoalDefinition> = {
  'cards-per-day': {
    kind: 'cards-per-day',
    period: 'day',
    label: 'Cards reviewed per day',
    unit: plural('card', 'cards'),
    min: 1,
    max: 1000,
    suggested: 20,
  },
  'minutes-per-day': {
    kind: 'minutes-per-day',
    period: 'day',
    label: 'Study time per day',
    unit: plural('minute', 'minutes'),
    min: 1,
    max: 600,
    suggested: 15,
  },
  'sessions-per-week': {
    kind: 'sessions-per-week',
    period: 'week',
    label: 'Study sessions per week',
    unit: plural('session', 'sessions'),
    min: 1,
    max: 100,
    suggested: 5,
  },
  'days-per-week': {
    kind: 'days-per-week',
    period: 'week',
    label: 'Study days per week',
    unit: plural('day', 'days'),
    min: 1,
    max: 7,
    suggested: 5,
  },
};

/** The most changes a goal remembers. */
export const MAX_GOAL_CHANGES = 50;

/** The widest target storage accepts, whatever the kind. The form keeps to each kind's range. */
export const MAX_GOAL_TARGET = 100_000;

export function isGoalKind(value: unknown): value is GoalKind {
  return typeof value === 'string' && (GOAL_KINDS as readonly string[]).includes(value);
}

/** Checks a target typed into the form. Returns the whole number, or a message. */
export function parseGoalTarget(
  kind: GoalKind,
  text: string,
): { ok: true; target: number } | { ok: false; message: string } {
  const definition = GOAL_DEFINITIONS[kind];
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return { ok: false, message: 'Enter a whole number.' };
  const target = Number(trimmed);
  if (target < definition.min || target > definition.max) {
    return {
      ok: false,
      message: `Choose between ${definition.min} and ${definition.max} ${definition.unit(definition.max)}.`,
    };
  }
  return { ok: true, target };
}

/** Sorted oldest first, one change per moment, at most {@link MAX_GOAL_CHANGES}. */
export function normalizeChanges(changes: readonly GoalChange[]): GoalChange[] {
  const byKey = new Map<string, GoalChange>();
  for (const change of changes) byKey.set(`${change.at}:${change.target}`, change);
  return [...byKey.values()]
    .sort((a, b) => a.at - b.at || (a.target ?? -1) - (b.target ?? -1))
    .slice(-MAX_GOAL_CHANGES);
}

/**
 * Sets (or with `null`, switches off) one goal. A change to the same target is
 * not a change, and returns the goals untouched.
 */
export function setGoal(
  goals: readonly StudyGoal[],
  kind: GoalKind,
  target: number | null,
  now: Timestamp,
): StudyGoal[] {
  const existing = goals.find((goal) => goal.id === kind);
  if (existing ? existing.target === target : target === null) return [...goals];
  // A change never goes back in time, even when the clock has.
  const at = Math.max(now, existing?.updatedAt ?? 0);
  const goal: StudyGoal = {
    id: kind,
    target,
    updatedAt: at,
    changes: normalizeChanges([...(existing?.changes ?? []), { at, target }]),
  };
  return sortGoals([...goals.filter((g) => g.id !== kind), goal]);
}

/** Goals in the order the page shows them. */
export function sortGoals(goals: readonly StudyGoal[]): StudyGoal[] {
  return [...goals].sort((a, b) => GOAL_KINDS.indexOf(a.id) - GOAL_KINDS.indexOf(b.id));
}

/** The target that applied at `at`, or null when the goal was off (or not yet set). */
export function targetAt(goal: StudyGoal | undefined, at: Timestamp): number | null {
  if (!goal) return null;
  let target: number | null = null;
  let found = false;
  for (const change of goal.changes) {
    if (change.at > at) break;
    target = change.target;
    found = true;
  }
  // Changes are trimmed to the most recent ones; before the oldest kept change
  // nothing is known, so nothing is claimed.
  return found ? target : null;
}

/**
 * Two versions of one goal, combined. The later change decides the current
 * target (on a tie, `remote`, so every device chooses alike), and the history
 * of changes from both sides is kept.
 */
export function mergeGoal(local: StudyGoal, remote: StudyGoal): StudyGoal {
  const winner = local.updatedAt > remote.updatedAt ? local : remote;
  return {
    id: remote.id,
    target: winner.target,
    updatedAt: winner.updatedAt,
    changes: normalizeChanges([...local.changes, ...remote.changes]),
  };
}
