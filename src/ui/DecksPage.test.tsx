import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  makeAppData,
  makeCard,
  makeDeck,
  renderApp,
  storageWithData,
  storedDecks,
} from '../test/renderApp';

const myCards = makeDeck({ id: 'default', name: 'My Cards' });
const biology = makeDeck({ id: 'biology', name: 'Biology' });

function twoDecks() {
  return makeAppData(
    [
      makeCard({ deckId: 'default' }),
      makeCard({ deckId: 'biology' }),
      makeCard({ deckId: 'biology' }),
    ],
    [myCards, biology],
  );
}

describe('DecksPage', () => {
  it('lists every deck with its card count, alphabetically', () => {
    renderApp({ storage: storageWithData(twoDecks()), route: '/decks' });

    const names = screen.getAllByRole('link', { name: /^(Biology|My Cards)$/ });
    expect(names.map((link) => link.textContent)).toEqual(['Biology', 'My Cards']);
    expect(screen.getByText('2 cards')).toBeInTheDocument();
    expect(screen.getByText('1 card')).toBeInTheDocument();
  });

  it('links each deck to its page and to its cards', () => {
    renderApp({ storage: storageWithData(twoDecks()), route: '/decks' });

    expect(screen.getByRole('link', { name: 'Biology' })).toHaveAttribute('href', '/decks/biology');
    expect(screen.getByRole('link', { name: 'Browse the cards in Biology' })).toHaveAttribute(
      'href',
      '/list?deck=biology',
    );
  });

  it('creates a deck and saves it', async () => {
    const user = userEvent.setup();
    const storage = storageWithData(twoDecks());
    renderApp({ storage, route: '/decks' });

    await user.type(screen.getByLabelText('Deck name'), 'Chemistry');
    await user.click(screen.getByRole('button', { name: 'Create deck' }));

    expect(screen.getByRole('link', { name: 'Chemistry' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Created “Chemistry”.');
    expect(storedDecks(storage).map((d) => d.name)).toEqual(['My Cards', 'Biology', 'Chemistry']);
    // The field is ready for the next deck.
    expect(screen.getByLabelText('Deck name')).toHaveValue('');
  });

  it('refuses a blank name and a name already in use', async () => {
    const user = userEvent.setup();
    const storage = storageWithData(twoDecks());
    renderApp({ storage, route: '/decks' });

    await user.click(screen.getByRole('button', { name: 'Create deck' }));
    expect(screen.getByRole('alert')).toHaveTextContent('A deck needs a name.');

    await user.type(screen.getByLabelText('Deck name'), '  biology ');
    await user.click(screen.getByRole('button', { name: 'Create deck' }));
    expect(screen.getByRole('alert')).toHaveTextContent('already exists');

    expect(storedDecks(storage)).toHaveLength(2);
  });

  it('shows an empty state when there are no decks at all', () => {
    renderApp({ storage: storageWithData(makeAppData([], [])), route: '/decks' });

    expect(screen.getByRole('heading', { name: 'No decks yet' })).toBeInTheDocument();
  });
});
