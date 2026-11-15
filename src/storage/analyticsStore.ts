import { z } from 'zod';
import { ID_PATTERN } from '../domain/ids';
import {
  dedupeSessions,
  MAX_SESSION_CARDS,
  STUDY_MODES,
  type StudySession,
} from '../domain/studySessions';
import {
  GOAL_KINDS,
  MAX_GOAL_CHANGES,
  MAX_GOAL_TARGET,
  mergeGoal,
  normalizeChanges,
  sortGoals,
  type StudyGoal,
} from '../domain/studyGoals';
import { isQuotaError, type SaveResult } from './localStore';

/**
 * Where the study log and study goals are saved.
 *
 * Kept under their own key, apart from the cards and the learning progress,
 * for the same reasons progress is: an unreadable study log must never put
 * cards or progress at risk, and the formats saved by earlier milestones (and
 * their export files) stay exactly as they were. A build from before this
 * key existed simply never reads it.
 *
 * Validated on the way in and out, one record at a time, so a single damaged
 * session costs that session and nothing else.
 */

/** Namespaced, because every project on the same origin shares one localStorage. */
export const ANALYTICS_STORAGE_KEY = 'snapnotes.analytics.v1';

export const ANALYTICS_VERSION = 1;

export interface AnalyticsData {
  version: typeof ANALYTICS_VERSION;
  /** Oldest first. */
  sessions: StudySession[];
  goals: StudyGoal[];
}

const idSchema = z.string().regex(ID_PATTERN);
const timestampSchema = z.number().int().positive();
const countSchema = z.number().int().nonnegative();
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * The rules here and in `snapnotes_private.apply_session` (supabase/migrations)
 * must agree: anything the server stores, every device must be able to read.
 */
export const studySessionSchema = z
  .object({
    id: idSchema,
    mode: z.enum(STUDY_MODES),
    deckId: idSchema.nullable(),
    day: daySchema,
    startedAt: timestampSchema,
    endedAt: timestampSchema,
    durationMs: countSchema,
    answered: countSchema,
    correct: countSchema,
    responseMs: countSchema,
    timedAnswers: countSchema,
    results: z
      .array(z.object({ cardId: idSchema, correct: countSchema, incorrect: countSchema }))
      .max(MAX_SESSION_CARDS),
  })
  .refine((s) => s.endedAt >= s.startedAt, { message: 'endedAt cannot be before startedAt' })
  .refine((s) => s.correct <= s.answered, { message: 'correct cannot exceed answered' })
  .refine((s) => s.timedAnswers <= s.answered, {
    message: 'timedAnswers cannot exceed answered',
  }) satisfies z.ZodType<StudySession>;

const targetSchema = z.number().int().min(1).max(MAX_GOAL_TARGET).nullable();

export const studyGoalSchema = z.object({
  id: z.enum(GOAL_KINDS),
  target: targetSchema,
  updatedAt: timestampSchema,
  changes: z.array(z.object({ at: timestampSchema, target: targetSchema })).max(MAX_GOAL_CHANGES),
}) satisfies z.ZodType<StudyGoal>;

const analyticsFileSchema = z.object({
  version: z.number().int().positive(),
  sessions: z.array(z.unknown()).optional(),
  goals: z.array(z.unknown()).optional(),
});

export function emptyAnalytics(): AnalyticsData {
  return { version: ANALYTICS_VERSION, sessions: [], goals: [] };
}

/** One goal per kind; two copies of a kind (only from hand-edited storage) are merged. */
export function dedupeGoals(goals: readonly StudyGoal[]): {
  goals: StudyGoal[];
  duplicates: number;
} {
  const byKind = new Map<string, StudyGoal>();
  let duplicates = 0;
  for (const goal of goals) {
    const seen = byKind.get(goal.id);
    if (seen) duplicates += 1;
    const kept = seen ? mergeGoal(seen, goal) : goal;
    byKind.set(goal.id, { ...kept, changes: normalizeChanges(kept.changes) });
  }
  return { goals: sortGoals([...byKind.values()]), duplicates };
}

export type AnalyticsLoad =
  | {
      ok: true;
      data: AnalyticsData;
      /** True when nothing could be read and the log starts again from empty. */
      reset: boolean;
      /** Sessions and goals that were damaged (or repeated) and left out. */
      dropped: number;
    }
  | {
      ok: false;
      /** `unavailable`: no storage. `newer-version`: written by a newer version of the app. */
      error: 'unavailable' | 'newer-version';
      message: string;
      /** Empty, so the app still runs. Nothing is written in this state. */
      data: AnalyticsData;
    };

function readStored(raw: string): AnalyticsLoad {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: true, data: emptyAnalytics(), reset: true, dropped: 0 };
  }
  const file = analyticsFileSchema.safeParse(json);
  if (!file.success) return { ok: true, data: emptyAnalytics(), reset: true, dropped: 0 };
  if (file.data.version > ANALYTICS_VERSION) {
    return {
      ok: false,
      error: 'newer-version',
      message: `Saved study history uses format version ${file.data.version}, which this version of Snap Notes cannot read.`,
      data: emptyAnalytics(),
    };
  }

  let dropped = 0;
  const sessions: StudySession[] = [];
  for (const value of file.data.sessions ?? []) {
    const parsed = studySessionSchema.safeParse(value);
    if (parsed.success) sessions.push(parsed.data);
    else dropped += 1;
  }
  const goals: StudyGoal[] = [];
  for (const value of file.data.goals ?? []) {
    const parsed = studyGoalSchema.safeParse(value);
    if (parsed.success) goals.push(parsed.data);
    else dropped += 1;
  }

  const uniqueSessions = dedupeSessions(sessions);
  const uniqueGoals = dedupeGoals(goals);
  return {
    ok: true,
    data: {
      version: ANALYTICS_VERSION,
      sessions: uniqueSessions.sessions,
      goals: uniqueGoals.goals,
    },
    reset: false,
    dropped: dropped + uniqueSessions.duplicates + uniqueGoals.duplicates,
  };
}

/** Reads the saved study log and goals. Never throws. */
export function loadAnalytics(storage: Storage | null): AnalyticsLoad {
  if (!storage) {
    return {
      ok: false,
      error: 'unavailable',
      message: 'Browser storage is not available.',
      data: emptyAnalytics(),
    };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(ANALYTICS_STORAGE_KEY);
  } catch (error) {
    return { ok: false, error: 'unavailable', message: String(error), data: emptyAnalytics() };
  }
  if (raw === null) return { ok: true, data: emptyAnalytics(), reset: false, dropped: 0 };
  return readStored(raw);
}

const analyticsDataSchema = z.object({
  version: z.literal(ANALYTICS_VERSION),
  sessions: z.array(studySessionSchema),
  goals: z.array(studyGoalSchema),
});

/** Writes the study log and goals, confirming they landed. Nothing else is touched. */
export function saveAnalytics(storage: Storage | null, data: AnalyticsData): SaveResult {
  if (!storage) {
    return { ok: false, error: 'unavailable', message: 'Browser storage is not available.' };
  }
  const parsed = analyticsDataSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: 'invalid-data', message: 'Study history could not be saved.' };
  }
  const serialized = JSON.stringify(parsed.data);
  try {
    storage.setItem(ANALYTICS_STORAGE_KEY, serialized);
  } catch (error) {
    if (isQuotaError(error)) {
      return { ok: false, error: 'quota-exceeded', message: 'Browser storage is full.' };
    }
    return { ok: false, error: 'write-failed', message: String(error) };
  }
  let readBack: string | null;
  try {
    readBack = storage.getItem(ANALYTICS_STORAGE_KEY);
  } catch (error) {
    return {
      ok: false,
      error: 'write-failed',
      message: `Saved study history could not be read back: ${String(error)}`,
    };
  }
  if (readBack !== serialized) {
    return { ok: false, error: 'write-failed', message: 'Saved study history did not read back.' };
  }
  return { ok: true };
}
