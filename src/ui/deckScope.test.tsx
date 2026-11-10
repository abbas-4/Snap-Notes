import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeAppData, makeCard, makeDeck, renderApp, storageWithData } from '../test/renderApp';
import { withDeck } from './deckScope';

const myCards = makeDeck({ id: 'default', name: 'My Cards' });
const biology = makeDeck({ id: 'biology', name: 'Biology' });

/** Three cards in "My Cards", two in "Biology". */
function twoDecks() {
  return makeAppData(
    [
      makeCard({ deckId: 'default', term: 'Alpha', definition: 'First' }),
      makeCard({ deckId: 'default', term: 'Beta', definition: 'Second' }),
      makeCard({ deckId: 'default', term: 'Gamma', definition: 'Third' }),
      makeCard({ deckId: 'biology', term: 'Osmosis', definition: 'Water moving' }),
      makeCard({ deckId: 'biology', term: 'Mitosis', definition: 'Cells dividing' }),
    ],
    [myCards, biology],
  );
}

function renderScoped(route: string) {
  return renderApp({ storage: storageWithData(twoDecks()), route });
}

describe('withDeck', () => {
  it('adds the deck to a path, and leaves it alone without one', () => {
    expect(withDeck('/study', 'biology')).toBe('/study?deck=biology');
    expect(withDeck('/study', null)).toBe('/study');
    expect(withDeck('/add', 'a b')).toBe('/add?deck=a%20b');
  });
});

describe('learning modes scoped to a deck', () => {
  it('studies only the deck’s cards', () => {
    renderScoped('/study?deck=biology');

    expect(screen.getByText('Card 1 of 2')).toBeInTheDocument();
    expect(screen.getByText(/Showing only the cards in/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the deck' })).toHaveAttribute(
      'href',
      '/decks/biology',
    );
  });

  it('studies every card when no deck is named', () => {
    renderScoped('/study');

    expect(screen.getByText('Card 1 of 5')).toBeInTheDocument();
    expect(screen.queryByText(/Showing only the cards in/)).not.toBeInTheDocument();
  });

  it('quizzes only the deck’s cards', () => {
    renderScoped('/quiz?deck=biology');

    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();
  });

  it('learns only the deck’s cards', () => {
    renderScoped('/learn?deck=biology');

    expect(screen.getByText('2 to go')).toBeInTheDocument();
  });

  it('matches only the deck’s cards', () => {
    renderScoped('/match?deck=biology');

    expect(screen.getByText(/Showing only the cards in/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Osmosis' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alpha' })).not.toBeInTheDocument();
  });

  it.each(['/study', '/quiz', '/learn', '/match', '/list'])(
    'says the deck is gone on %s',
    (path) => {
      renderScoped(`${path}?deck=vanished`);

      expect(screen.getByRole('heading', { level: 1, name: 'Deck not found' })).toBeInTheDocument();
    },
  );

  it('offers a scoped empty state when the deck has too few cards to match', () => {
    const data = makeAppData(
      [makeCard({ deckId: 'default' }), makeCard({ deckId: 'biology' })],
      [myCards, biology],
    );
    renderApp({ storage: storageWithData(data), route: '/match?deck=biology' });

    expect(screen.getByRole('heading', { name: 'Not enough cards to match' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a card' })).toHaveAttribute(
      'href',
      '/add?deck=biology',
    );
    expect(screen.getByRole('link', { name: 'Back to the deck' })).toHaveAttribute(
      'href',
      '/decks/biology',
    );
  });
});
