import { describe, expect, it } from 'vitest';
import {
  addDays,
  cardState,
  clampEase,
  clampInterval,
  dayKey,
  daysBetween,
  daysOverdue,
  describeDue,
  gradeProgress,
  isDifficult,
  isDue,
  mastery,
  MASTERED_INTERVAL_DAYS,
  MAX_EASE,
  MAX_INTERVAL_DAYS,
  MIN_EASE,
  nextInterval,
  RELEARN_MINUTES,
  retention,
  stageForInterval,
  START_EASE,
  startOfDay,
  type CardProgress,
} from './srs';

/** A Tuesday at 10:00 local time, so "start of day" is unambiguous. */
const NOON = new Date(2025, 2, 11, 10, 0, 0).getTime();
const DAY = 86_400_000;

const context = { cardId: 'card-1', deckId: 'default', now: NOON };

/** Grades a card from new through a list of answers, returning the record each time. */
function sequence(grades: Parameters<typeof gradeProgress>[1][], startAt = NOON): CardProgress[] {
  const records: CardProgress[] = [];
  let current: CardProgress | undefined;
  let at = startAt;
  for (const grade of grades) {
    current = gradeProgress(current, grade, { ...context, now: at });
    records.push(current);
    // The next review happens exactly when it falls due.
    at = current.dueAt;
  }
  return records;
}

describe('day arithmetic', () => {
  it('starts a day at local midnight', () => {
    const start = new Date(startOfDay(NOON));
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getDate()).toBe(new Date(NOON).getDate());
  });

  it('adds whole calendar days, landing on midnight', () => {
    const tomorrow = new Date(addDays(NOON, 1));
    expect(tomorrow.getDate()).toBe(12);
    expect(tomorrow.getHours()).toBe(0);
  });

  it('crosses a month boundary', () => {
    const endOfMonth = new Date(2025, 0, 30, 23, 30).getTime();
    const later = new Date(addDays(endOfMonth, 3));
    expect(later.getMonth()).toBe(1);
    expect(later.getDate()).toBe(2);
  });

  it('counts a day as one day even when the clocks change', () => {
    // In many zones the last Sunday of March is 23 hours long.
    const beforeChange = new Date(2025, 2, 29, 12, 0).getTime();
    expect(daysBetween(beforeChange, addDays(beforeChange, 1))).toBe(1);
    expect(daysBetween(beforeChange, addDays(beforeChange, 2))).toBe(2);
    expect(new Date(addDays(beforeChange, 1)).getHours()).toBe(0);
  });

  it('writes a day key as YYYY-MM-DD in local time', () => {
    expect(dayKey(new Date(2025, 0, 5, 23, 59).getTime())).toBe('2025-01-05');
    expect(dayKey(new Date(2025, 11, 31, 0, 1).getTime())).toBe('2025-12-31');
  });

  it('falls back to now rather than producing an invalid date', () => {
    expect(Number.isNaN(startOfDay(Number.NaN))).toBe(false);
    expect(dayKey(-1)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('interval growth', () => {
  it('follows 1, 3 then 7 days for the first three successes', () => {
    const [first, second, third] = sequence(['good', 'good', 'good']);
    expect(first?.intervalDays).toBe(1);
    expect(second?.intervalDays).toBe(3);
    expect(third?.intervalDays).toBe(7);
  });

  it('keeps growing after the ladder, by the ease', () => {
    const records = sequence(['good', 'good', 'good', 'good', 'good']);
    const intervals = records.map((record) => record.intervalDays);
    expect(intervals).toEqual([1, 3, 7, 18, 45]);
  });

  it('reaches further for easy than for good', () => {
    const [easy] = sequence(['easy']);
    const [good] = sequence(['good']);
    expect(easy?.intervalDays).toBeGreaterThan(good?.intervalDays ?? 0);
  });

  it('keeps hard answers on a short schedule', () => {
    const [first, second] = sequence(['good', 'hard']);
    expect(first?.intervalDays).toBe(1);
    expect(second?.intervalDays).toBe(1);
  });

  it('keeps hard below good and easy above it, whatever the history', () => {
    for (const previous of [0, 1, 3, 7, 18, 60, 300]) {
      for (const streak of [1, 2, 3, 4, 8]) {
        for (const ease of [MIN_EASE, START_EASE, MAX_EASE]) {
          const hard = nextInterval(previous, streak, ease, 'hard');
          const good = nextInterval(previous, streak, ease, 'good');
          const easy = nextInterval(previous, streak, ease, 'easy');
          expect(hard).toBeLessThanOrEqual(good);
          expect(good).toBeLessThanOrEqual(easy);
          expect(hard).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('never shortens an interval after a correct answer', () => {
    expect(nextInterval(40, 5, START_EASE, 'hard')).toBeGreaterThanOrEqual(40);
    expect(nextInterval(40, 5, MIN_EASE, 'good')).toBeGreaterThanOrEqual(40);
  });

  it('never schedules a card in the past or further than a year out', () => {
    expect(clampInterval(-5)).toBe(1);
    expect(clampInterval(10_000)).toBe(MAX_INTERVAL_DAYS);
    expect(nextInterval(Number.NaN, 1, START_EASE, 'good')).toBe(1);
    expect(nextInterval(300, 9, MAX_EASE, 'easy')).toBe(MAX_INTERVAL_DAYS);
  });

  it('starts the ladder again for a card with no history', () => {
    expect(nextInterval(0, 1, START_EASE, 'good')).toBe(1);
  });
});

describe('grading a card', () => {
  it('creates a record on the first review', () => {
    const progress = gradeProgress(undefined, 'good', context);
    expect(progress).toMatchObject({
      cardId: 'card-1',
      deckId: 'default',
      reviews: 1,
      correct: 1,
      incorrect: 0,
      streak: 1,
      intervalDays: 1,
      stage: 'review',
      lastReviewedAt: NOON,
    });
    expect(progress.dueAt).toBe(addDays(NOON, 1));
  });

  it('leaves the previous record untouched', () => {
    const first = gradeProgress(undefined, 'good', context);
    const snapshot = { ...first };
    gradeProgress(first, 'again', context);
    expect(first).toEqual(snapshot);
  });

  it('counts reviews, correct and incorrect answers', () => {
    const records = sequence(['good', 'again', 'good', 'hard']);
    const last = records[records.length - 1] as CardProgress;
    expect(last.reviews).toBe(4);
    expect(last.correct).toBe(3);
    expect(last.incorrect).toBe(1);
  });

  it('brings a forgotten card back within minutes and clears the streak', () => {
    const known = gradeProgress(undefined, 'good', context);
    // The same card, answered at the same moment, but forgotten.
    const forgotten = gradeProgress(known, 'again', { ...context, now: known.dueAt });
    expect(forgotten.streak).toBe(0);
    expect(forgotten.intervalDays).toBe(0);
    expect(forgotten.stage).toBe('learning');
    expect(forgotten.dueAt - forgotten.lastReviewedAt).toBe(RELEARN_MINUTES * 60_000);
    // Back today, rather than days away as a correct answer would have been.
    expect(forgotten.dueAt).toBeLessThan(addDays(known.dueAt, 1));
  });

  it('starts the ladder again after a card is forgotten', () => {
    const records = sequence(['good', 'good', 'again', 'good']);
    expect(records[1]?.intervalDays).toBe(3);
    expect(records[3]?.intervalDays).toBe(1);
  });

  it('lowers the ease when a card is missed and raises it when it is easy', () => {
    const missed = gradeProgress(undefined, 'again', context);
    const easy = gradeProgress(undefined, 'easy', context);
    const good = gradeProgress(undefined, 'good', context);
    expect(missed.ease).toBeLessThan(START_EASE);
    expect(easy.ease).toBeGreaterThan(START_EASE);
    expect(good.ease).toBe(START_EASE);
  });

  it('keeps the ease inside its bounds', () => {
    let progress = gradeProgress(undefined, 'again', context);
    for (let i = 0; i < 20; i++) progress = gradeProgress(progress, 'again', context);
    expect(progress.ease).toBe(MIN_EASE);

    let easy = gradeProgress(undefined, 'easy', context);
    for (let i = 0; i < 20; i++)
      easy = gradeProgress(easy, 'easy', { ...context, now: easy.dueAt });
    expect(easy.ease).toBe(MAX_EASE);
    expect(clampEase(Number.NaN)).toBe(START_EASE);
  });

  it('moves a card to mastered once it is scheduled three weeks out', () => {
    const records = sequence(['good', 'good', 'good', 'good', 'good']);
    expect(records.map((record) => record.stage)).toEqual([
      'review',
      'review',
      'review',
      'review',
      'mastered',
    ]);
    expect(records[3]?.intervalDays).toBeLessThan(MASTERED_INTERVAL_DAYS);
    expect(records[4]?.intervalDays).toBeGreaterThanOrEqual(MASTERED_INTERVAL_DAYS);
    expect(stageForInterval(0)).toBe('learning');
  });

  it('follows the card when it moves to another deck', () => {
    const first = gradeProgress(undefined, 'good', context);
    const moved = gradeProgress(first, 'good', { ...context, deckId: 'biology' });
    expect(moved.deckId).toBe('biology');
  });

  it('never writes an invalid timestamp', () => {
    const progress = gradeProgress(undefined, 'good', { ...context, now: Number.NaN });
    expect(Number.isSafeInteger(progress.dueAt)).toBe(true);
    expect(progress.dueAt).toBeGreaterThan(0);
    expect(Number.isSafeInteger(progress.lastReviewedAt)).toBe(true);
  });

  it('schedules against the calendar day, not the hour of the answer', () => {
    const lateNight = new Date(2025, 2, 11, 23, 50).getTime();
    const progress = gradeProgress(undefined, 'good', { ...context, now: lateNight });
    const due = new Date(progress.dueAt);
    expect(due.getDate()).toBe(12);
    expect(due.getHours()).toBe(0);
    // Due ten minutes later, not a full day later: "tomorrow" is a day, not 24 hours.
    expect(progress.dueAt - lateNight).toBeLessThan(DAY);
  });
});

describe('when a card is due', () => {
  const scheduled = gradeProgress(undefined, 'good', context);

  it('treats a card with no record as new', () => {
    expect(cardState(undefined, NOON)).toBe('new');
    expect(isDue(undefined, NOON)).toBe(false);
    expect(retention(undefined)).toBe(0);
    expect(mastery(undefined)).toBe(0);
    expect(describeDue(undefined, NOON)).toBe('New card');
  });

  it('is not due before its day', () => {
    expect(cardState(scheduled, NOON)).toBe('scheduled');
    expect(isDue(scheduled, NOON)).toBe(false);
    expect(describeDue(scheduled, NOON)).toBe('Due tomorrow');
  });

  it('is due from the first moment of the day it falls on', () => {
    expect(isDue(scheduled, scheduled.dueAt)).toBe(true);
    expect(cardState(scheduled, scheduled.dueAt)).toBe('due');
    expect(cardState(scheduled, scheduled.dueAt + 12 * 3_600_000)).toBe('due');
  });

  it('is overdue once its day has passed', () => {
    const later = scheduled.dueAt + 2 * DAY;
    expect(cardState(scheduled, later)).toBe('overdue');
    expect(daysOverdue(scheduled, later)).toBe(2);
    expect(describeDue(scheduled, later)).toBe('Due for 2 days');
  });

  it('describes a card waiting since yesterday', () => {
    expect(describeDue(scheduled, scheduled.dueAt + DAY)).toBe('Due since yesterday');
    expect(describeDue(scheduled, scheduled.dueAt)).toBe('Due now');
  });

  it('describes a card due later the same day', () => {
    const relearning = gradeProgress(undefined, 'again', context);
    expect(describeDue(relearning, NOON)).toBe('Due later today');
    expect(cardState(relearning, NOON)).toBe('scheduled');
    expect(cardState(relearning, relearning.dueAt)).toBe('due');
  });
});

describe('how well a card is known', () => {
  it('reports the share of answers remembered', () => {
    const records = sequence(['good', 'again', 'good', 'good']);
    expect(retention(records[3])).toBeCloseTo(3 / 4);
  });

  it('measures mastery by how far ahead the card is scheduled', () => {
    const records = sequence(['good', 'good', 'good', 'good', 'good']);
    expect(mastery(records[0])).toBeCloseTo(1 / MASTERED_INTERVAL_DAYS);
    expect(mastery(records[3])).toBeCloseTo(18 / MASTERED_INTERVAL_DAYS);
    // Capped at 1: a card scheduled a year out is no more than mastered.
    expect(mastery(records[4])).toBe(1);
  });

  it('calls a card difficult once it is missed twice or its ease falls', () => {
    const fresh = gradeProgress(undefined, 'good', context);
    expect(isDifficult(fresh)).toBe(false);

    const missedTwice = sequence(['again', 'good', 'again'])[2];
    expect(isDifficult(missedTwice)).toBe(true);

    let hard = gradeProgress(undefined, 'hard', context);
    for (let i = 0; i < 4; i++) hard = gradeProgress(hard, 'hard', { ...context, now: hard.dueAt });
    expect(hard.ease).toBeLessThanOrEqual(2);
    expect(isDifficult(hard)).toBe(true);
  });
});
