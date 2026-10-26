import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeCard, renderApp, storageWithCards, storedCards } from '../test/renderApp';

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
