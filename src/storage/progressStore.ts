import { z } from 'zod';
import { ID_PATTERN } from '../domain/ids';
import type { DailyActivity } from '../domain/progressStats';
import { dayKey, type CardProgress, type LearningStage } from '../domain/srs';
import type { AppData, Timestamp } from '../domain/types';
import { isQuotaError, type SaveResult } from './localStore';

/**
 * Where learning progress is saved.
 *
 * Progress is kept under its own key, apart from the cards and decks. Three
 * reasons: a card's content and how well it is known change for different
 * reasons and at different times; unreadable progress must never put the
 * user's cards at risk; and the export format from earlier milestones keeps
 * working unchanged, so old backups still import and old exports still load.
 *
 * The file is versioned and validated on the way in and out. Records are read
 * one by one, so a single damaged record costs that card's history and nothing
 * else.
 */

/** Namespaced, because every project on the same origin shares one localStorage. */
export const PROGRESS_STORAGE_KEY = 'snapnotes.progress.v1';

export const PROGRESS_VERSION = 1;

/** How much of the day-by-day activity log is kept. A year covers every streak worth showing. */
export const MAX_HISTORY_DAYS = 365;

export interface ProgressData {
  version: typeof PROGRESS_VERSION;
  records: CardProgress[];
  /** One entry per day studied, oldest first. */
  history: DailyActivity[];
}

const idSchema = z.string().regex(ID_PATTERN);
const timestampSchema = z.number().int().positive();
const stageSchema = z.enum(['learning', 'review', 'mastered']) satisfies z.ZodType<LearningStage>;

export const cardProgressSchema = z.object({
  cardId: idSchema,
  deckId: idSchema,
  reviews: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  incorrect: z.number().int().nonnegative(),
  stage: stageSchema,
  intervalDays: z.number().nonnegative().finite(),
  ease: z.number().positive().finite(),
  lastReviewedAt: timestampSchema,
  dueAt: timestampSchema,
  streak: z.number().int().nonnegative(),
}) satisfies z.ZodType<CardProgress>;

export const dailyActivitySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reviews: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
}) satisfies z.ZodType<DailyActivity>;

/** Records and history are read item by item, so one bad entry cannot lose the rest. */
const progressFileSchema = z.object({
  version: z.number().int().positive(),
  records: z.array(z.unknown()).optional(),
  history: z.array(z.unknown()).optional(),
});

export function emptyProgress(): ProgressData {
  return { version: PROGRESS_VERSION, records: [], history: [] };
}

export type ProgressLoad =
  | {
      ok: true;
      data: ProgressData;
      /** True when nothing could be read and the progress starts again from empty. */
      reset: boolean;
      /** Records and history entries that were damaged and left out. */
      dropped: number;
    }
  | {
      ok: false;
      /** `unavailable`: no storage. `newer-version`: written by a newer version of the app. */
      error: 'unavailable' | 'newer-version';
      message: string;
      /** Empty progress, so the app still runs. Nothing is written in this state. */
      data: ProgressData;
    };

/** Of two records for the same card, the one that has seen more reviewing wins. */
function better(a: CardProgress, b: CardProgress): CardProgress {
  if (a.reviews !== b.reviews) return a.reviews > b.reviews ? a : b;
  return a.lastReviewedAt >= b.lastReviewedAt ? a : b;
}

/** Keeps one record per card. Duplicates can only come from hand-edited or merged storage. */
export function dedupeRecords(records: readonly CardProgress[]): {
  records: CardProgress[];
  duplicates: number;
} {
  const byCard = new Map<string, CardProgress>();
  let duplicates = 0;
  for (const record of records) {
    const current = byCard.get(record.cardId);
    if (current) duplicates += 1;
    byCard.set(record.cardId, current ? better(current, record) : record);
  }
  return { records: [...byCard.values()], duplicates };
}

/** One entry per day, oldest first, trimmed to the days worth keeping. */
export function normalizeHistory(
  history: readonly DailyActivity[],
  maxDays = MAX_HISTORY_DAYS,
): DailyActivity[] {
  const byDay = new Map<string, DailyActivity>();
  for (const entry of history) {
    const current = byDay.get(entry.day);
    byDay.set(
      entry.day,
      current
        ? {
            day: entry.day,
            reviews: current.reviews + entry.reviews,
            correct: current.correct + entry.correct,
          }
        : entry,
    );
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-maxDays);
}

function readStored(raw: string): ProgressLoad {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: true, data: emptyProgress(), reset: true, dropped: 0 };
  }

  const file = progressFileSchema.safeParse(json);
  if (!file.success) return { ok: true, data: emptyProgress(), reset: true, dropped: 0 };

  if (file.data.version > PROGRESS_VERSION) {
    return {
      ok: false,
      error: 'newer-version',
      message: `Saved progress uses format version ${file.data.version}, which this version of Snap Notes cannot read.`,
      data: emptyProgress(),
    };
  }

  let dropped = 0;
  const records: CardProgress[] = [];
  for (const value of file.data.records ?? []) {
    const parsed = cardProgressSchema.safeParse(value);
    if (parsed.success) records.push(parsed.data);
    else dropped += 1;
  }

  const history: DailyActivity[] = [];
  for (const value of file.data.history ?? []) {
    const parsed = dailyActivitySchema.safeParse(value);
    if (parsed.success) history.push(parsed.data);
    else dropped += 1;
  }

  const deduped = dedupeRecords(records);
  return {
    ok: true,
    data: {
      version: PROGRESS_VERSION,
      records: deduped.records,
      history: normalizeHistory(history),
    },
    reset: false,
    dropped: dropped + deduped.duplicates,
  };
}

/** Reads saved progress. Never throws: unreadable progress starts again from empty. */
export function loadProgress(storage: Storage | null): ProgressLoad {
  if (!storage) {
    return {
      ok: false,
      error: 'unavailable',
      message: 'Browser storage is not available.',
      data: emptyProgress(),
    };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(PROGRESS_STORAGE_KEY);
  } catch (error) {
    return {
      ok: false,
      error: 'unavailable',
      message: String(error),
      data: emptyProgress(),
    };
  }

  if (raw === null) return { ok: true, data: emptyProgress(), reset: false, dropped: 0 };
  return readStored(raw);
}

/** Writes progress, confirming it landed. Cards and decks are never touched here. */
export function saveProgress(storage: Storage | null, data: ProgressData): SaveResult {
  if (!storage) {
    return { ok: false, error: 'unavailable', message: 'Browser storage is not available.' };
  }

  const parsed = z
    .object({
      version: z.literal(PROGRESS_VERSION),
      records: z.array(cardProgressSchema),
      history: z.array(dailyActivitySchema),
    })
    .safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: 'invalid-data', message: 'Progress could not be saved.' };
  }

  const serialized = JSON.stringify(parsed.data);
  try {
    storage.setItem(PROGRESS_STORAGE_KEY, serialized);
  } catch (error) {
    if (isQuotaError(error)) {
      return { ok: false, error: 'quota-exceeded', message: 'Browser storage is full.' };
    }
    return { ok: false, error: 'write-failed', message: String(error) };
  }

  let readBack: string | null;
  try {
    readBack = storage.getItem(PROGRESS_STORAGE_KEY);
  } catch (error) {
    return {
      ok: false,
      error: 'write-failed',
      message: `Saved progress could not be read back: ${String(error)}`,
    };
  }
  if (readBack !== serialized) {
    return { ok: false, error: 'write-failed', message: 'Saved progress did not read back.' };
  }
  return { ok: true };
}

/**
 * Brings records into line with the cards that exist.
 *
 * A record for a card that is gone is dropped, which is how deleting a card or
 * importing over a collection cleans up after itself. A record whose card has
 * moved deck follows it, so deck statistics always match where the cards are.
 */
export function reconcileProgress(
  records: readonly CardProgress[],
  data: AppData,
): { records: CardProgress[]; changed: boolean } {
  const decks = new Set(data.decks.map((deck) => deck.id));
  const deckByCard = new Map(data.cards.map((card) => [card.id, card.deckId]));

  let changed = false;
  const kept: CardProgress[] = [];
  for (const record of records) {
    const deckId = deckByCard.get(record.cardId);
    if (deckId === undefined) {
      changed = true;
      continue;
    }
    // A deck that no longer exists cannot be written back, so the card's own deck wins.
    if (record.deckId !== deckId || !decks.has(record.deckId)) {
      changed = true;
      kept.push({ ...record, deckId });
    } else {
      kept.push(record);
    }
  }

  const deduped = dedupeRecords(kept);
  return { records: deduped.records, changed: changed || deduped.duplicates > 0 };
}

/** Adds one answer to the day it was given on. */
export function recordActivity(
  history: readonly DailyActivity[],
  now: Timestamp,
  correct: boolean,
): DailyActivity[] {
  const day = dayKey(now);
  const existing = history.find((entry) => entry.day === day);
  const updated: DailyActivity = existing
    ? { day, reviews: existing.reviews + 1, correct: existing.correct + (correct ? 1 : 0) }
    : { day, reviews: 1, correct: correct ? 1 : 0 };
  return normalizeHistory([...history.filter((entry) => entry.day !== day), updated]);
}

/** Records as a map, for looking up one card's progress. */
export function recordsById(records: readonly CardProgress[]): Map<string, CardProgress> {
  return new Map(records.map((record) => [record.cardId, record]));
}
