import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  makeAppData,
  makeCard,
  makeDeck,
  makeProgress,
  renderApp,
  storageWithProgress,
  storedCards,
  storedDecks,
  storedProgress,
} from '../test/renderApp';

const DAY = 86_400_000;
const now = Date.now();

const myCards = makeDeck({ id: 'default', name: 'My Cards' });
const biology = makeDeck({ id: 'biology', name: 'Biology' });

const kept = makeCard({ id: 'kept', deckId: 'default', term: 'Mitosis', definition: 'Division' });
const other = makeCard({ id: 'other', deckId: 'biology', term: 'Osmosis', definition: 'Water' });

function twoDecks() {
  return makeAppData([kept, other], [myCards, biology]);
}

function records() {
  return [
    makeProgress({ cardId: 'kept', reviews: 5, correct: 4, incorrect: 1, dueAt: now - DAY }),
    makeProgress({ cardId: 'other', deckId: 'biology', reviews: 2, dueAt: now + DAY }),
  ];
}

describe('progress follows the cards', () => {
  it('survives editing a card', async () => {
    const user = userEvent.setup();
    const storage = storageWithProgress(twoDecks(), records());
    renderApp({ storage, route: '/edit/kept' });

    await user.clear(screen.getByLabelText('Definition'));
    await user.type(screen.getByLabelText('Definition'), 'Cell division');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(storedCards(storage).find((card) => card.id === 'kept')?.definition).toBe(
      'Cell division',
    );
    expect(storedProgress(storage).records.find((r) => r.cardId === 'kept')).toMatchObject({
      reviews: 5,
      correct: 4,
    });
  });

  it('follows a card moved to another deck', async () => {
    const user = userEvent.setup();
    const storage = storageWithProgress(twoDecks(), records());
    renderApp({ storage, route: '/edit/kept' });

    await user.selectOptions(screen.getByLabelText('Deck'), 'biology');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const record = storedProgress(storage).records.find((r) => r.cardId === 'kept');
    expect(record).toMatchObject({ deckId: 'biology', reviews: 5 });
  });

  it('is cleaned up when the card is deleted', async () => {
    const user = userEvent.setup();
    const storage = storageWithProgress(twoDecks(), records());
    renderApp({ storage, route: '/list' });

    await user.click(screen.getByRole('button', { name: 'Delete Mitosis' }));
    await user.click(screen.getByRole('button', { name: 'Delete card' }));

    expect(storedCards(storage).map((card) => card.id)).toEqual(['other']);
    expect(storedProgress(storage).records.map((r) => r.cardId)).toEqual(['other']);
  });

  it('is kept when a deck is deleted and its cards move', async () => {
    const user = userEvent.setup();
    const storage = storageWithProgress(twoDecks(), records());
    renderApp({ storage, route: '/decks/biology' });

    await user.click(screen.getByRole('button', { name: 'Delete deck' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete deck' }),
    );

    expect(storedDecks(storage).map((deck) => deck.id)).toEqual(['default']);
    const record = storedProgress(storage).records.find((r) => r.cardId === 'other');
    // The card moved to the remaining deck, and its history moved with it.
    expect(record).toMatchObject({ deckId: 'default', reviews: 2 });
  });
});

describe('resetting a single card', () => {
  it('shows what reviewing knows about the card', () => {
    renderApp({ storage: storageWithProgress(twoDecks(), records()), route: '/edit/kept' });

    expect(screen.getByRole('heading', { name: 'Learning progress' })).toBeInTheDocument();
    expect(screen.getByText('5 reviews')).toBeInTheDocument();
    expect(screen.getByText('80% (4 of 5)')).toBeInTheDocument();
    expect(screen.getByText('Due since yesterday')).toBeInTheDocument();
  });

  it('forgets the card’s history but keeps the card', async () => {
    const user = userEvent.setup();
    const storage = storageWithProgress(twoDecks(), records());
    renderApp({ storage, route: '/edit/kept' });

    await user.click(screen.getByRole('button', { name: "Reset this card's progress" }));
    await user.click(screen.getByRole('button', { name: 'Yes, reset progress' }));

    expect(storedProgress(storage).records.map((r) => r.cardId)).toEqual(['other']);
    expect(storedCards(storage).map((card) => card.id)).toEqual(['kept', 'other']);
    expect(
      screen.getByText('This card has not been reviewed yet, so it counts as new.'),
    ).toBeInTheDocument();
  });

  it('has nothing to reset for a card that was never reviewed', () => {
    renderApp({ storage: storageWithProgress(twoDecks()), route: '/edit/kept' });
    expect(screen.getByText('There is no progress to reset yet.')).toBeInTheDocument();
  });
});

describe('deck-level progress', () => {
  it('shows a deck’s learning progress and what is due', () => {
    renderApp({ storage: storageWithProgress(twoDecks(), records()), route: '/decks/default' });

    expect(screen.getByRole('heading', { name: 'Learning progress' })).toBeInTheDocument();
    expect(screen.getByText('1 due')).toBeInTheDocument();
    expect(screen.getByText('1 of 1 reviewed at least once · 0 mastered')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review 1 due' })).toHaveAttribute(
      'href',
      '/review?mode=due&deck=default',
    );
  });

  it('shows every deck’s progress on the deck list', () => {
    renderApp({ storage: storageWithProgress(twoDecks(), records()), route: '/decks' });

    const biologyItem = screen.getByRole('link', { name: 'Biology' }).closest('li') as HTMLElement;
    expect(within(biologyItem).getByText('Reviewing 1')).toBeInTheDocument();
    expect(within(biologyItem).getByRole('link', { name: 'Review Biology' })).toBeInTheDocument();

    const mine = screen.getByRole('link', { name: 'My Cards' }).closest('li') as HTMLElement;
    expect(within(mine).getByText('1 due')).toBeInTheDocument();
  });

  it('resets a deck without touching its cards or the other decks', async () => {
    const user = userEvent.setup();
    const storage = storageWithProgress(twoDecks(), records());
    renderApp({ storage, route: '/decks/default' });

    await user.click(screen.getByRole('button', { name: "Reset this deck's progress" }));
    expect(
      screen.getByRole('alertdialog', {
        name: 'Reset the learning progress for every card in “My Cards”?',
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes, reset progress' }));

    expect(storedProgress(storage).records.map((r) => r.cardId)).toEqual(['other']);
    expect(storedCards(storage)).toHaveLength(2);
    expect(storedDecks(storage)).toHaveLength(2);
  });

  it('says a deck has nothing to reset before it has been reviewed', () => {
    renderApp({ storage: storageWithProgress(twoDecks()), route: '/decks/default' });
    expect(screen.getByText('No card in this deck has been reviewed yet.')).toBeInTheDocument();
  });
});

describe('the home page', () => {
  it('points at what is due', () => {
    renderApp({ storage: storageWithProgress(twoDecks(), records()), route: '/' });

    expect(screen.getByRole('heading', { name: '1 card due for review' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review 1 now' })).toHaveAttribute('href', '/review');
  });

  it('says when everything is done, and when the next card is due', () => {
    const records = [makeProgress({ cardId: 'kept', dueAt: now + 2 * DAY })];
    renderApp({ storage: storageWithProgress(makeAppData([kept]), records), route: '/' });

    expect(screen.getByRole('heading', { name: 'You’re all caught up!' })).toBeInTheDocument();
    expect(screen.getByText('Your next card is due in 2 days.')).toBeInTheDocument();
  });
});

describe('duplicate and stray records', () => {
  it('keeps one record per card, and drops records for cards that are gone', () => {
    const storage = storageWithProgress(makeAppData([kept]), [
      makeProgress({ cardId: 'kept', reviews: 1 }),
      makeProgress({ cardId: 'kept', reviews: 8, correct: 8 }),
      makeProgress({ cardId: 'deleted-long-ago', reviews: 3 }),
    ]);
    renderApp({ storage, route: '/stats' });

    const saved = storedProgress(storage).records;
    expect(saved.map((r) => r.cardId)).toEqual(['kept']);
    expect(saved[0]?.reviews).toBe(8);
    expect(screen.getByText('8')).toBeInTheDocument();
  });
});
