import { describe, expect, it } from 'vitest';
import type { GeneratedCard } from '../../../supabase/functions/_shared/flashcards/contract.ts';
import { makeGeneratedCard } from '../../test/fakeGeneration';
import {
  buildRequest,
  countDrafts,
  describeOutcome,
  describeWait,
  generatorReducer,
  initialGeneratorState,
  type GenerationSettings,
  type GeneratorState,
  type PendingRequest,
} from './generatorState';

const settings: GenerationSettings = {
  material: 'Some study material about cells and their parts.',
  topic: ' Cells ',
  cardType: 'mixed',
  difficulty: 'hard',
  count: 10,
};

const none = { invalid: 0, ungrounded: 0, duplicate: 0 };

function pending(kind: 'initial' | 'more' = 'initial'): PendingRequest {
  return {
    purpose: { kind },
    request: { action: 'generate', material: 'm', count: 2, cardType: 'qa', difficulty: 'easy' },
  };
}

function withCards(cards: GeneratedCard[]): GeneratorState {
  const started = generatorReducer(initialGeneratorState, {
    type: 'start',
    pending: pending(),
    now: 1,
  });
  return generatorReducer(started, {
    type: 'success',
    cards,
    requested: cards.length,
    discarded: none,
  });
}

describe('the review list', () => {
  it('adds generated cards, all selected', () => {
    const state = withCards([makeGeneratedCard(), makeGeneratedCard()]);
    expect(state.drafts.map((d) => [d.id, d.selected, d.saved])).toEqual([
      ['draft-1', true, null],
      ['draft-2', true, null],
    ]);
    expect(state.pending).toBeNull();
    expect(countDrafts(state.drafts)).toEqual({ generated: 2, selected: 2, saved: 0, unsaved: 2 });
  });

  it('runs one request at a time', () => {
    const started = generatorReducer(initialGeneratorState, {
      type: 'start',
      pending: pending(),
      now: 1,
    });
    expect(generatorReducer(started, { type: 'start', pending: pending('more'), now: 2 })).toBe(
      started,
    );
  });

  it('edits questions and answers, and marks the card edited', () => {
    const state = withCards([makeGeneratedCard({ question: 'Old?', answer: 'old' })]);
    const draft = state.drafts[0]!;
    const edited = generatorReducer(state, {
      type: 'edit',
      draftId: draft.id,
      card: { ...draft.card, question: 'New?', answer: 'new' },
    });
    expect(edited.drafts[0]).toMatchObject({
      edited: true,
      card: { question: 'New?', answer: 'new' },
    });
  });

  it('changes a card’s type', () => {
    const state = withCards([makeGeneratedCard({ answer: 'Right' })]);
    const next = generatorReducer(state, {
      type: 'set-kind',
      draftId: 'draft-1',
      kind: 'multiple-choice',
    });
    expect(next.drafts[0]!.card).toMatchObject({
      kind: 'multiple-choice',
      choices: ['Right', '', '', ''],
    });
  });

  it('selects, deselects and removes cards', () => {
    let state = withCards([makeGeneratedCard(), makeGeneratedCard(), makeGeneratedCard()]);
    state = generatorReducer(state, { type: 'toggle', draftId: 'draft-2', selected: false });
    expect(countDrafts(state.drafts).selected).toBe(2);
    state = generatorReducer(state, { type: 'select-all', selected: false });
    expect(countDrafts(state.drafts).selected).toBe(0);
    state = generatorReducer(state, { type: 'select-all', selected: true });
    expect(countDrafts(state.drafts).selected).toBe(3);
    state = generatorReducer(state, { type: 'remove', draftId: 'draft-1' });
    expect(state.drafts.map((d) => d.id)).toEqual(['draft-2', 'draft-3']);
  });

  it('replaces one card in place when it is regenerated', () => {
    const state = withCards([makeGeneratedCard(), makeGeneratedCard({ question: 'Replace me?' })]);
    const deselected = generatorReducer(state, {
      type: 'toggle',
      draftId: 'draft-2',
      selected: false,
    });
    const started = generatorReducer(deselected, {
      type: 'start',
      pending: { purpose: { kind: 'single', draftId: 'draft-2' }, request: pending().request },
      now: 1,
    });
    const replacement = makeGeneratedCard({ question: 'A better question?' });
    const done = generatorReducer(started, {
      type: 'success',
      cards: [replacement],
      requested: 1,
      discarded: none,
    });
    expect(done.drafts.map((d) => d.card.question)).toEqual([
      state.drafts[0]!.card.question,
      'A better question?',
    ]);
    expect(done.drafts[1]).toMatchObject({ id: 'draft-2', selected: true, edited: false });
  });

  it('appends more cards, and replaces the list with a new set', () => {
    const state = withCards([makeGeneratedCard()]);
    const more = generatorReducer(
      generatorReducer(state, { type: 'start', pending: pending('more'), now: 1 }),
      { type: 'success', cards: [makeGeneratedCard()], requested: 1, discarded: none },
    );
    expect(more.drafts.map((d) => d.id)).toEqual(['draft-1', 'draft-2']);
    const fresh = generatorReducer(
      generatorReducer(more, { type: 'start', pending: pending('initial'), now: 1 }),
      { type: 'success', cards: [makeGeneratedCard()], requested: 1, discarded: none },
    );
    expect(fresh.drafts.map((d) => d.id)).toEqual(['draft-3']);
  });

  it('keeps a failure with the request that failed, for retrying', () => {
    const started = generatorReducer(initialGeneratorState, {
      type: 'start',
      pending: pending(),
      now: 1,
    });
    const failed = generatorReducer(started, {
      type: 'failure',
      failure: { ok: false, code: 'timeout', message: 'Too slow.' },
    });
    expect(failed.pending).toBeNull();
    expect(failed.error).toEqual({
      failure: { ok: false, code: 'timeout', message: 'Too slow.' },
      retry: pending(),
    });
    // Starting again clears it.
    expect(
      generatorReducer(failed, { type: 'start', pending: pending(), now: 2 }).error,
    ).toBeNull();
  });

  it('locks saved cards: no more edits, selection or second save', () => {
    let state = withCards([makeGeneratedCard(), makeGeneratedCard()]);
    state = generatorReducer(state, {
      type: 'saved',
      results: [{ draftId: 'draft-1', cardId: 'card-9' }],
    });
    expect(state.drafts[0]).toMatchObject({ saved: { cardId: 'card-9' }, selected: false });
    const edited = generatorReducer(state, {
      type: 'edit',
      draftId: 'draft-1',
      card: makeGeneratedCard({ question: 'changed' }),
    });
    expect(edited.drafts[0]!.card.question).not.toBe('changed');
    expect(
      generatorReducer(state, { type: 'select-all', selected: true }).drafts[0]!.selected,
    ).toBe(false);
    expect(countDrafts(state.drafts)).toEqual({ generated: 2, selected: 1, saved: 1, unsaved: 1 });
  });
});

describe('building requests', () => {
  it('sends the settings for a new set, without an avoid list', () => {
    expect(buildRequest(settings, { kind: 'initial' }, [], 5)).toEqual({
      action: 'generate',
      material: settings.material,
      topic: 'Cells',
      count: 10,
      cardType: 'mixed',
      difficulty: 'hard',
      avoid: [],
    });
  });

  it('asks for more cards that avoid the questions already listed', () => {
    const state = withCards([
      makeGeneratedCard({ question: 'One?' }),
      makeGeneratedCard({ question: 'Two?' }),
    ]);
    expect(buildRequest(settings, { kind: 'more' }, state.drafts, 5)).toMatchObject({
      count: 5,
      avoid: ['One?', 'Two?'],
    });
  });

  it('regenerates one card with its own type and difficulty', () => {
    const state = withCards([
      makeGeneratedCard({ kind: 'term', difficulty: 'easy', question: 'Cell' }),
    ]);
    expect(
      buildRequest(settings, { kind: 'single', draftId: 'draft-1' }, state.drafts, 5),
    ).toMatchObject({
      count: 1,
      cardType: 'term',
      difficulty: 'easy',
      avoid: ['Cell'],
    });
  });
});

describe('describing what came back', () => {
  it('says nothing when every card arrived', () => {
    expect(
      describeOutcome({ purpose: 'initial', requested: 5, received: 5, discarded: none }),
    ).toBeNull();
  });

  it('explains fewer cards and why the rest were left out', () => {
    expect(
      describeOutcome({
        purpose: 'initial',
        requested: 10,
        received: 7,
        discarded: { invalid: 1, ungrounded: 2, duplicate: 1 },
      }),
    ).toBe(
      'Wrote 7 of the 10 cards asked for: the material did not support more. Left out: 2 were not supported by your material, 1 repeated another card, 1 was incomplete.',
    );
  });

  it('explains an empty result', () => {
    expect(
      describeOutcome({ purpose: 'initial', requested: 5, received: 0, discarded: none }),
    ).toMatch(/^No cards could be written from this material/);
    expect(
      describeOutcome({ purpose: 'more', requested: 5, received: 0, discarded: none }),
    ).toMatch(/already be covered/);
    expect(
      describeOutcome({ purpose: 'single', requested: 1, received: 0, discarded: none }),
    ).toMatch(/could not be written for this one/);
  });

  it('describes waits in words', () => {
    expect(describeWait(20)).toBe('under a minute');
    expect(describeWait(61)).toBe('about 2 minutes');
    expect(describeWait(3 * 3600)).toBe('about 3 hours');
  });
});
