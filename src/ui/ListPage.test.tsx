import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  makeAppData,
  makeCard,
  makeDeck,
  renderApp,
  storageWithCards,
  storageWithData,
  storedCards,
} from '../test/renderApp';

describe('ListPage', () => {
  it('shows every card with its term and definition', () => {
    const cards = [
      makeCard({ term: 'Photosynthesis', definition: 'How plants make food' }),
      makeCard({ term: 'Osmosis', definition: 'Diffusion of water' }),
    ];
    renderApp({ storage: storageWithCards(cards), route: '/list' });

    expect(screen.getByText('Photosynthesis')).toBeInTheDocument();
    expect(screen.getByText('How plants make food')).toBeInTheDocument();
    expect(screen.getByText('Osmosis')).toBeInTheDocument();
    expect(screen.getByText('Diffusion of water')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 cards');
  });

  it('shows an empty state with guidance when there are no cards', () => {
    renderApp({ route: '/list' });

    expect(screen.getByRole('heading', { name: 'No cards yet' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Search')).not.toBeInTheDocument();
  });

  it('filters cards by term or definition, ignoring case', async () => {
    const user = userEvent.setup();
    const cards = [
      makeCard({ term: 'Photosynthesis', definition: 'How plants make food' }),
      makeCard({ term: 'Osmosis', definition: 'Diffusion of water' }),
    ];
    renderApp({ storage: storageWithCards(cards), route: '/list' });

    await user.type(screen.getByLabelText('Search'), 'WATER');

    expect(screen.getByText('Osmosis')).toBeInTheDocument();
    expect(screen.queryByText('Photosynthesis')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 2 cards');
  });

  it('handles a search with no matches and can clear it', async () => {
    const user = userEvent.setup();
    renderApp({ storage: storageWithCards([makeCard({ term: 'Osmosis' })]), route: '/list' });

    await user.type(screen.getByLabelText('Search'), 'zebra');
    expect(screen.getByText('No cards match “zebra”.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Osmosis')).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toHaveValue('');
  });

  it('asks for confirmation before deleting, and cancel keeps the card', async () => {
    const user = userEvent.setup();
    const card = makeCard({ term: 'Keep me' });
    const storage = storageWithCards([card]);
    renderApp({ storage, route: '/list' });

    await user.click(screen.getByRole('button', { name: 'Delete Keep me' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete “Keep me”?');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('Keep me')).toBeInTheDocument();
    expect(storedCards(storage)).toEqual([card]);
  });

  it('deletes a card after confirmation and keeps the others', async () => {
    const user = userEvent.setup();
    const stays = makeCard({ term: 'Stays' });
    const goes = makeCard({ term: 'Goes' });
    const storage = storageWithCards([stays, goes]);
    renderApp({ storage, route: '/list' });

    await user.click(screen.getByRole('button', { name: 'Delete Goes' }));
    await user.click(screen.getByRole('button', { name: 'Delete card' }));

    expect(screen.queryByText('Goes')).not.toBeInTheDocument();
    expect(screen.getByText('Stays')).toBeInTheDocument();
    expect(screen.getByText('Deleted “Goes”.')).toBeInTheDocument();
    expect(storedCards(storage)).toEqual([stays]);
  });

  it('renders long text without losing it and links each card to its editor', () => {
    const long = 'long '.repeat(200).trim();
    const card = makeCard({ term: 'Long card', definition: long });
    renderApp({ storage: storageWithCards([card]), route: '/list' });

    expect(screen.getByText(long)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit Long card' })).toHaveAttribute(
      'href',
      `/edit/${card.id}`,
    );
  });
});

describe('ListPage scoped to a deck', () => {
  const myCards = makeDeck({ id: 'default', name: 'My Cards' });
  const biology = makeDeck({ id: 'biology', name: 'Biology' });

  function twoDecks() {
    return makeAppData(
      [
        makeCard({ id: 'c1', deckId: 'default', term: 'Everywhere' }),
        makeCard({ id: 'c2', deckId: 'biology', term: 'Osmosis' }),
      ],
      [myCards, biology],
    );
  }

  it('shows only that deck’s cards, and offers a way back to all of them', () => {
    renderApp({ storage: storageWithData(twoDecks()), route: '/list?deck=biology' });

    expect(screen.getByText('Osmosis')).toBeInTheDocument();
    expect(screen.queryByText('Everywhere')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 card');
    expect(screen.getByRole('link', { name: 'Show all cards' })).toHaveAttribute('href', '/list');
  });

  it('shows every card when no deck is named', () => {
    renderApp({ storage: storageWithData(twoDecks()), route: '/list' });

    expect(screen.getByText('Everywhere')).toBeInTheDocument();
    expect(screen.getByText('Osmosis')).toBeInTheDocument();
  });

  it('says so when the deck no longer exists', () => {
    renderApp({ storage: storageWithData(twoDecks()), route: '/list?deck=gone' });

    expect(screen.getByRole('heading', { level: 1, name: 'Deck not found' })).toBeInTheDocument();
    expect(screen.queryByText('Osmosis')).not.toBeInTheDocument();
  });

  it('has its own empty state for a deck with no cards', () => {
    const data = makeAppData([makeCard({ deckId: 'default' })], [myCards, biology]);
    renderApp({ storage: storageWithData(data), route: '/list?deck=biology' });

    expect(screen.getByRole('heading', { name: 'No cards in this deck yet' })).toBeInTheDocument();
  });

  it('moves a card to another deck from the list', async () => {
    const user = userEvent.setup();
    const data = twoDecks();
    const before = data.cards[1]!;
    const storage = storageWithData(data);
    renderApp({ storage, route: '/list' });

    await user.selectOptions(screen.getByLabelText('Deck for Osmosis'), 'default');

    expect(screen.getByText('Moved “Osmosis” to “My Cards”.')).toBeInTheDocument();
    const moved = storedCards(storage).find((c) => c.id === 'c2');
    // Only the deck changed; the text and creation time are untouched.
    expect(moved).toEqual({ ...before, deckId: 'default', updatedAt: moved!.updatedAt });
    expect(moved!.updatedAt).toBeGreaterThanOrEqual(before.createdAt);
  });

  it('leaves the deck controls out when there is only one deck', () => {
    renderApp({ storage: storageWithCards([makeCard({ term: 'Alone' })]), route: '/list' });

    expect(screen.queryByLabelText('Deck for Alone')).not.toBeInTheDocument();
  });
});
