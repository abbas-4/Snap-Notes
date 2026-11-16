import { describe, expect, it } from 'vitest';
import type { GeneratedCard } from '../../supabase/functions/_shared/flashcards/contract.ts';
import { appDataSchema } from '../storage/schemas';
import { makeAppData, makeCard, makeDeck } from '../test/renderApp';
import { addCards, convertKind, toCardText } from './generatedCards';

const qa: GeneratedCard = {
  kind: 'qa',
  difficulty: 'medium',
  question: 'What do ribosomes make?',
  answer: 'Proteins',
  choices: [],
  evidence: 'Ribosomes make proteins.',
};

function counter() {
  let n = 0;
  return () => `new-${++n}`;
}

describe('saving a generated card as an ordinary card', () => {
  it('writes question and answer as term and definition', () => {
    expect(toCardText(qa)).toEqual({ term: 'What do ribosomes make?', definition: 'Proteins' });
    expect(
      toCardText({ ...qa, kind: 'term', question: ' Ribosome ', answer: ' Makes proteins ' }),
    ).toEqual({ term: 'Ribosome', definition: 'Makes proteins' });
    expect(toCardText({ ...qa, kind: 'fill-blank', question: 'Ribosomes make _____.' })).toEqual({
      term: 'Ribosomes make _____.',
      definition: 'Proteins',
    });
  });

  it('puts multiple-choice options on the front and the lettered answer on the back', () => {
    const mc = {
      ...qa,
      kind: 'multiple-choice' as const,
      choices: ['Lipids', 'Proteins', 'Sugars', 'DNA'],
    };
    expect(toCardText(mc)).toEqual({
      term: 'What do ribosomes make?\n\nA. Lipids\nB. Proteins\nC. Sugars\nD. DNA',
      definition: 'B. Proteins',
    });
  });
});

describe('changing a card’s type', () => {
  it('keeps the answer as the first option when becoming multiple choice', () => {
    expect(convertKind(qa, 'multiple-choice')).toMatchObject({
      kind: 'multiple-choice',
      choices: ['Proteins', '', '', ''],
      answer: 'Proteins',
    });
  });

  it('drops the options when leaving multiple choice', () => {
    const mc = { ...qa, kind: 'multiple-choice' as const, choices: ['Proteins', 'Lipids', 'DNA'] };
    expect(convertKind(mc, 'qa')).toEqual({ ...qa, choices: [] });
  });

  it('blanks out the answer when becoming fill-in-the-blank, where it can', () => {
    const sentence = { ...qa, question: 'Ribosomes make proteins from amino acids.' };
    expect(convertKind(sentence, 'fill-blank').question).toBe(
      'Ribosomes make _____ from amino acids.',
    );
    expect(convertKind(qa, 'fill-blank').question).toBe('What do ribosomes make?');
  });

  it('changes nothing when the type is the same', () => {
    expect(convertKind(qa, 'qa')).toBe(qa);
  });
});

describe('adding generated cards to a deck', () => {
  const deck = makeDeck({ id: 'bio', name: 'Biology' });
  const existing = makeCard({
    id: 'old',
    deckId: 'bio',
    term: 'What do ribosomes make?',
    definition: 'Proteins',
  });
  const data = makeAppData([existing], [makeDeck({ id: 'default', name: 'My Cards' }), deck]);

  it('adds every card to an existing deck in one valid result', () => {
    const result = addCards(
      data,
      { deckId: 'bio' },
      [
        { term: 'Nucleus', definition: 'Holds DNA' },
        { term: 'Mitochondrion', definition: 'Makes ATP' },
      ],
      { now: 5_000_000_000_000, createId: counter() },
    );
    expect(result).toMatchObject({ ok: true, deckId: 'bio', cardIds: ['new-1', 'new-2'] });
    if (!result.ok) return;
    expect(result.data.cards.slice(1)).toEqual([
      {
        id: 'new-1',
        deckId: 'bio',
        term: 'Nucleus',
        definition: 'Holds DNA',
        createdAt: 5e12,
        updatedAt: 5e12,
      },
      {
        id: 'new-2',
        deckId: 'bio',
        term: 'Mitochondrion',
        definition: 'Makes ATP',
        createdAt: 5e12,
        updatedAt: 5e12,
      },
    ]);
    expect(appDataSchema.safeParse(result.data).success).toBe(true);
  });

  it('creates a new deck in the same result', () => {
    const result = addCards(
      data,
      { newDeckName: ' Cells ' },
      [{ term: 'Cell', definition: 'Unit of life' }],
      {
        createId: counter(),
      },
    );
    expect(result).toMatchObject({ ok: true, deckId: 'new-1', cardIds: ['new-2'] });
    if (!result.ok) return;
    expect(result.data.decks.at(-1)).toMatchObject({ id: 'new-1', name: 'Cells' });
    expect(result.data.cards.at(-1)).toMatchObject({ deckId: 'new-1' });
  });

  it('adds nothing when the new deck cannot be created', () => {
    expect(addCards(data, { newDeckName: 'biology' }, [{ term: 'a', definition: 'b' }])).toEqual({
      ok: false,
      message: 'A deck called “biology” already exists.',
    });
    expect(addCards(data, { newDeckName: '  ' }, [{ term: 'a', definition: 'b' }])).toEqual({
      ok: false,
      message: 'A deck needs a name.',
    });
  });

  it('refuses a deck that no longer exists', () => {
    expect(addCards(data, { deckId: 'gone' }, [{ term: 'a', definition: 'b' }])).toMatchObject({
      ok: false,
    });
  });

  it('skips cards the deck already holds, so saving twice never duplicates', () => {
    const inputs = [
      { term: '  what do RIBOSOMES make? ', definition: 'proteins' },
      { term: 'Nucleus', definition: 'Holds DNA' },
      { term: 'Nucleus', definition: 'Holds  DNA' },
    ];
    const first = addCards(data, { deckId: 'bio' }, inputs, { createId: counter() });
    expect(first).toMatchObject({ ok: true, cardIds: [null, 'new-1', null] });
    if (!first.ok) return;
    const again = addCards(first.data, { deckId: 'bio' }, inputs, { createId: counter() });
    expect(again).toMatchObject({ ok: true, cardIds: [null, null, null] });
    expect(again.ok && again.data.cards).toHaveLength(2);
  });

  it('never reuses an ID already in the collection', () => {
    const ids = ['old', 'bad id!', 'fresh'];
    const result = addCards(data, { deckId: 'default' }, [{ term: 'x', definition: 'y' }], {
      createId: () => ids.shift()!,
    });
    expect(result).toMatchObject({ ok: true, cardIds: ['fresh'] });
  });
});
