import { describe, expect, it } from 'vitest';
import type { CardProgress } from '../domain/srs';
import type { Card, Deck } from '../domain/types';
import { mergeHistory, mergeProgress, mergeRecord } from './merge';

const card = (overrides: Partial<Card> = {}): Card => ({
  id: 'c1',
  deckId: 'default',
  term: 'term',
  definition: 'definition',
  createdAt: 1_000,
  updatedAt: 1_000,
  ...overrides,
});

const deck = (overrides: Partial<Deck> = {}): Deck => ({
  id: 'd1',
  name: 'Spanish',
  createdAt: 1_000,
  updatedAt: 1_000,
  ...overrides,
});

const progress = (overrides: Partial<CardProgress> = {}): CardProgress => ({
  cardId: 'c1',
  deckId: 'default',
  reviews: 2,
  correct: 2,
  incorrect: 0,
  stage: 'learning',
  intervalDays: 3,
  ease: 2.5,
  lastReviewedAt: 10_000,
  dueAt: 20_000,
  streak: 2,
  ...overrides,
});

describe('mergeRecord: one side changed', () => {
  it('takes the remote version when only the remote changed', () => {
    const base = card();
    const remote = card({ term: 'new', updatedAt: 2_000 });
    expect(mergeRecord('card', base, base, remote, 'c1')).toEqual({
      value: remote,
      conflict: null,
    });
  });

  it('keeps the local version when only this device changed', () => {
    const base = card();
    const local = card({ term: 'new', updatedAt: 2_000 });
    expect(mergeRecord('card', base, local, base, 'c1')).toEqual({ value: local, conflict: null });
  });

  it('has nothing to decide when both made the same change', () => {
    const base = card();
    const local = card({ term: 'same', updatedAt: 2_000 });
    const remote = card({ term: 'same', updatedAt: 2_000 });
    expect(mergeRecord('card', base, local, remote, 'c1').conflict).toBeNull();
  });

  it('applies a remote deletion when nothing changed here', () => {
    const base = card();
    expect(mergeRecord('card', base, base, null, 'c1')).toEqual({ value: null, conflict: null });
  });
});

describe('mergeRecord: both changed', () => {
  it('keeps edits to different fields from both devices', () => {
    const base = card();
    const local = card({ term: 'local term', updatedAt: 2_000 });
    const remote = card({ definition: 'remote definition', updatedAt: 3_000 });
    const merged = mergeRecord('card', base, local, remote, 'c1');
    expect(merged.conflict).toBeNull();
    expect(merged.value).toMatchObject({
      term: 'local term',
      definition: 'remote definition',
      updatedAt: 3_000,
    });
  });

  it('chooses the later edit for a field both changed, and keeps the other as a conflict', () => {
    const base = card();
    const local = card({ term: 'from here', updatedAt: 5_000 });
    const remote = card({ term: 'from there', updatedAt: 4_000 });
    const merged = mergeRecord('card', base, local, remote, 'c1');
    expect(merged.value?.term).toBe('from here');
    expect(merged.conflict).toMatchObject({
      kind: 'card',
      recordId: 'c1',
      reason: 'both-changed',
      other: { term: 'from there' },
    });
  });

  it('lets the server version win a tie, so every device chooses the same', () => {
    const base = card();
    const local = card({ term: 'here', updatedAt: 5_000 });
    const remote = card({ term: 'there', updatedAt: 5_000 });
    expect(mergeRecord('card', base, local, remote, 'c1').value?.term).toBe('there');
  });

  it('merges a deck rename made on two devices the same way', () => {
    const base = deck();
    const local = deck({ name: 'Español', updatedAt: 2_000 });
    const remote = deck({ name: 'Spanish 101', updatedAt: 3_000 });
    const merged = mergeRecord('deck', base, local, remote, 'd1');
    expect(merged.value?.name).toBe('Spanish 101');
    expect(merged.conflict?.other).toMatchObject({ name: 'Español' });
  });

  it('treats records that differ only in their timestamps as the same', () => {
    const local = deck({ id: 'default', name: 'My Cards', createdAt: 9_000, updatedAt: 9_000 });
    const remote = deck({ id: 'default', name: 'My Cards' });
    expect(mergeRecord('deck', null, local, remote, 'default')).toEqual({
      value: remote,
      conflict: null,
    });
  });

  it('marks a difference found while linking as a link conflict', () => {
    const merged = mergeRecord('card', null, card({ term: 'a' }), card({ term: 'b' }), 'c1');
    expect(merged.conflict?.reason).toBe('linked');
  });
});

describe('mergeRecord: editing beats deleting', () => {
  it('keeps a card deleted elsewhere when it was edited here', () => {
    const base = card();
    const local = card({ term: 'edited', updatedAt: 2_000 });
    const merged = mergeRecord('card', base, local, null, 'c1');
    expect(merged.value).toEqual(local);
    expect(merged.conflict).toMatchObject({ reason: 'deleted-elsewhere', kept: local });
  });

  it('brings back a card deleted here when it was edited elsewhere', () => {
    const base = card();
    const remote = card({ term: 'edited', updatedAt: 2_000 });
    const merged = mergeRecord('card', base, null, remote, 'c1');
    expect(merged.value).toEqual(remote);
    expect(merged.conflict).toMatchObject({ reason: 'deleted-here', kept: remote });
  });

  it('records no conflict for learning progress, which has nothing to restore', () => {
    const merged = mergeRecord('progress', progress(), null, progress({ reviews: 3 }), 'c1');
    expect(merged.value?.reviews).toBe(3);
    expect(merged.conflict).toBeNull();
  });
});

describe('mergeProgress', () => {
  it('counts the reviews made on both devices since the shared version', () => {
    const base = progress({ reviews: 2, correct: 2, incorrect: 0 });
    const local = progress({ reviews: 4, correct: 3, incorrect: 1, lastReviewedAt: 30_000 });
    const remote = progress({ reviews: 5, correct: 5, incorrect: 0, lastReviewedAt: 20_000 });
    const merged = mergeProgress(base, local, remote);
    expect(merged).toMatchObject({ reviews: 7, correct: 6, incorrect: 1 });
  });

  it('takes the schedule from the most recent review', () => {
    const local = progress({ lastReviewedAt: 30_000, dueAt: 99_000, intervalDays: 7, streak: 3 });
    const remote = progress({ lastReviewedAt: 20_000, dueAt: 50_000, intervalDays: 1, streak: 0 });
    expect(mergeProgress(progress(), local, remote)).toMatchObject({
      dueAt: 99_000,
      intervalDays: 7,
      streak: 3,
    });
  });

  it('never counts reviews twice when there is no shared version', () => {
    const local = progress({ reviews: 4, correct: 4 });
    const remote = progress({ reviews: 3, correct: 2, incorrect: 1 });
    const merged = mergeProgress(null, local, remote);
    expect(merged.correct).toBe(4);
    expect(merged.incorrect).toBe(1);
    expect(merged.reviews).toBe(5);
  });
});

describe('mergeHistory', () => {
  it('adds the reviews made on each device that day', () => {
    const base = { day: '2026-11-12', reviews: 3, correct: 2 };
    const local = { day: '2026-11-12', reviews: 5, correct: 4 };
    const remote = { day: '2026-11-12', reviews: 6, correct: 3 };
    expect(mergeHistory(base, local, remote)).toEqual({
      day: '2026-11-12',
      reviews: 8,
      correct: 5,
    });
  });

  it('takes the larger day when there is no shared version', () => {
    expect(
      mergeHistory(
        null,
        { day: '2026-11-12', reviews: 5, correct: 4 },
        { day: '2026-11-12', reviews: 3, correct: 3 },
      ),
    ).toEqual({ day: '2026-11-12', reviews: 5, correct: 4 });
  });
});
