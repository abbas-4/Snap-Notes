import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  makeAppData,
  makeCard,
  makeDeck,
  renderApp,
  storageWithData,
  storedCards,
  storedDecks,
} from '../test/renderApp';

const myCards = makeDeck({ id: 'default', name: 'My Cards' });
const biology = makeDeck({ id: 'biology', name: 'Biology' });

function twoDecks() {
  return makeAppData(
    [
      makeCard({ id: 'c1', deckId: 'default', term: 'Kept' }),
      makeCard({ id: 'c2', deckId: 'biology', term: 'Osmosis' }),
      makeCard({ id: 'c3', deckId: 'biology', term: 'Mitosis' }),
    ],
    [myCards, biology],
  );
}

describe('DeckPage', () => {
  it('shows the deck, its count, and links scoped to it', () => {
    renderApp({ storage: storageWithData(twoDecks()), route: '/decks/biology' });

    expect(screen.getByRole('heading', { level: 1, name: 'Biology' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 cards in this deck.');
    expect(screen.getByRole('link', { name: 'Study Biology' })).toHaveAttribute(
      'href',
      '/study?deck=biology',
    );
    expect(screen.getByRole('link', { name: 'Match Biology' })).toHaveAttribute(
      'href',
      '/match?deck=biology',
    );
    expect(screen.getByRole('link', { name: 'Browse these cards' })).toHaveAttribute(
      'href',
      '/list?deck=biology',
    );
    expect(screen.getByRole('link', { name: 'Add a card' })).toHaveAttribute(
      'href',
      '/add?deck=biology',
    );
  });

  it('offers no review links for an empty deck', () => {
    const data = makeAppData([makeCard({ deckId: 'default' })], [myCards, biology]);
    renderApp({ storage: storageWithData(data), route: '/decks/biology' });

    expect(screen.queryByRole('link', { name: 'Study Biology' })).not.toBeInTheDocument();
    expect(screen.getByText(/Add a card to this deck to study/)).toBeInTheDocument();
  });

  it('renames the deck and saves it', async () => {
    const user = userEvent.setup();
    const storage = storageWithData(twoDecks());
    renderApp({ storage, route: '/decks/biology' });

    const field = screen.getByLabelText('Deck name');
    expect(field).toHaveValue('Biology');
    await user.clear(field);
    await user.type(field, 'Life sciences');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Life sciences' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Renamed to “Life sciences”.');
    expect(storedDecks(storage).find((d) => d.id === 'biology')?.name).toBe('Life sciences');
  });

  it('refuses a rename to a name another deck uses', async () => {
    const user = userEvent.setup();
    const storage = storageWithData(twoDecks());
    renderApp({ storage, route: '/decks/biology' });

    const field = screen.getByLabelText('Deck name');
    await user.clear(field);
    await user.type(field, 'My Cards');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    expect(screen.getByRole('alert')).toHaveTextContent('already exists');
    expect(storedDecks(storage).find((d) => d.id === 'biology')?.name).toBe('Biology');
  });

  it('deletes the deck, keeps every card, and says where they went', async () => {
    const user = userEvent.setup();
    const storage = storageWithData(twoDecks());
    renderApp({ storage, route: '/decks/biology' });

    await user.click(screen.getByRole('button', { name: 'Delete deck' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete “Biology”?');
    expect(screen.getByLabelText('Move its 2 cards to')).toHaveValue('default');

    await user.click(screen.getByRole('button', { name: 'Delete deck' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Decks' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Deleted “Biology”. Its cards moved to “My Cards”.',
    );
    expect(storedDecks(storage).map((d) => d.id)).toEqual(['default']);
    // No card was lost; the two that moved now point at the surviving deck.
    expect(storedCards(storage).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(storedCards(storage).every((c) => c.deckId === 'default')).toBe(true);
    expect(storedCards(storage).map((c) => c.term)).toEqual(['Kept', 'Osmosis', 'Mitosis']);
  });

  it('can be cancelled, leaving the deck alone', async () => {
    const user = userEvent.setup();
    const storage = storageWithData(twoDecks());
    renderApp({ storage, route: '/decks/biology' });

    await user.click(screen.getByRole('button', { name: 'Delete deck' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(storedDecks(storage)).toHaveLength(2);
  });

  it('refuses to delete the only deck', () => {
    const data = makeAppData([makeCard({ deckId: 'default' })], [myCards]);
    renderApp({ storage: storageWithData(data), route: '/decks/default' });

    expect(screen.getByText(/This is your only deck/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete deck' })).not.toBeInTheDocument();
  });

  it('shows a not-found page for a deck that does not exist', () => {
    renderApp({ storage: storageWithData(twoDecks()), route: '/decks/nope' });

    expect(screen.getByRole('heading', { level: 1, name: 'Deck not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to decks' })).toBeInTheDocument();
  });
});
