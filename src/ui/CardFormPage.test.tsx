import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  makeAppData,
  makeCard,
  makeDeck,
  renderApp,
  storageWithCards,
  storageWithData,
  storedCards,
} from '../test/renderApp';
import { MemoryStorage } from '../test/memoryStorage';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CardFormPage', () => {
  it('creates a card and shows it in the list', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    renderApp({ storage, route: '/add' });

    await user.type(screen.getByLabelText('Term'), 'Mitochondria');
    await user.type(screen.getByLabelText('Definition'), 'Powerhouse of the cell');
    await user.click(screen.getByRole('button', { name: 'Add card' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Cards' })).toBeInTheDocument();
    expect(screen.getByText('Mitochondria')).toBeInTheDocument();

    const cards = storedCards(storage);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      term: 'Mitochondria',
      definition: 'Powerhouse of the cell',
    });
    expect(cards[0]!.createdAt).toBeGreaterThan(0);
    expect(cards[0]!.updatedAt).toBe(cards[0]!.createdAt);
  });

  it('rejects a card with neither term nor definition', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    renderApp({ storage, route: '/add' });

    await user.click(screen.getByRole('button', { name: 'Add card' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'A card needs at least a term or a definition.',
    );
    expect(screen.getByLabelText('Term')).toHaveFocus();
    expect(storage.writes).toEqual([]);
  });

  it('edits a card, preserving its id and creation time and updating updatedAt', async () => {
    const user = userEvent.setup();
    const card = makeCard({ term: 'Old term', definition: 'Old definition' });
    const storage = storageWithCards([card]);
    renderApp({ storage, route: `/edit/${card.id}` });

    const termField = screen.getByLabelText('Term');
    expect(termField).toHaveValue('Old term');
    expect(screen.getByLabelText('Definition')).toHaveValue('Old definition');

    await user.clear(termField);
    await user.type(termField, 'New term');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Cards' })).toBeInTheDocument();
    expect(screen.getByText('New term')).toBeInTheDocument();

    const stored = storedCards(storage);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: card.id,
      term: 'New term',
      definition: 'Old definition',
      createdAt: card.createdAt,
    });
    expect(stored[0]!.updatedAt).toBeGreaterThan(card.updatedAt);
  });

  it('shows a not-found message for an unknown card id', () => {
    renderApp({ storage: storageWithCards([makeCard()]), route: '/edit/no-such-card' });

    expect(screen.getByRole('heading', { name: 'Card not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to cards' })).toBeInTheDocument();
  });

  it('asks before navigating away from unsaved changes and stays when declined', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderApp({ route: '/add' });

    await user.type(screen.getByLabelText('Term'), 'Unsaved');
    await user.click(screen.getByRole('link', { name: 'Home' }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { level: 1, name: 'Add a card' })).toBeInTheDocument();
    expect(screen.getByLabelText('Term')).toHaveValue('Unsaved');
  });

  it('leaves the form when the user agrees to discard unsaved changes', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApp({ route: '/add' });

    await user.type(screen.getByLabelText('Term'), 'Unsaved');
    await user.click(screen.getByRole('link', { name: 'Home' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Your flashcards' })).toBeInTheDocument();
  });

  it('navigates away without asking when nothing changed', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm');
    renderApp({ route: '/add' });

    await user.click(screen.getByRole('link', { name: 'Home' }));

    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Your flashcards' })).toBeInTheDocument();
  });

  it('cancel returns to the list from an edit without saving', async () => {
    const user = userEvent.setup();
    const card = makeCard({ term: 'Untouched' });
    const storage = storageWithCards([card]);
    renderApp({ storage, route: `/edit/${card.id}` });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Cards' })).toBeInTheDocument();
    expect(storedCards(storage)).toEqual([card]);
    expect(storage.writes).toEqual([]);
  });
});

describe('CardFormPage and decks', () => {
  const myCards = makeDeck({ id: 'default', name: 'My Cards' });
  const biology = makeDeck({ id: 'biology', name: 'Biology' });

  function twoDecks(cards = [makeCard({ id: 'c1', deckId: 'biology', term: 'Osmosis' })]) {
    return makeAppData(cards, [myCards, biology]);
  }

  it('has no deck field when there is only one deck', () => {
    renderApp({ storage: new MemoryStorage(), route: '/add' });

    expect(screen.queryByLabelText('Deck')).not.toBeInTheDocument();
  });

  it('adds a card into the deck the link came from', async () => {
    const user = userEvent.setup();
    const storage = storageWithData(twoDecks());
    renderApp({ storage, route: '/add?deck=biology' });

    expect(screen.getByLabelText('Deck')).toHaveValue('biology');
    await user.type(screen.getByLabelText('Term'), 'Mitosis');
    await user.click(screen.getByRole('button', { name: 'Add card' }));

    // Back to that deck's cards, with the new one in it.
    expect(screen.getByRole('link', { name: 'Show all cards' })).toBeInTheDocument();
    expect(screen.getByText('Mitosis')).toBeInTheDocument();
    expect(storedCards(storage).find((c) => c.term === 'Mitosis')?.deckId).toBe('biology');
  });

  it('defaults a new card to the default deck when no deck is named', async () => {
    const user = userEvent.setup();
    const storage = storageWithData(twoDecks());
    renderApp({ storage, route: '/add' });

    expect(screen.getByLabelText('Deck')).toHaveValue('default');
    await user.type(screen.getByLabelText('Term'), 'Loose');
    await user.click(screen.getByRole('button', { name: 'Add card' }));

    expect(storedCards(storage).find((c) => c.term === 'Loose')?.deckId).toBe('default');
  });

  it('moves a card when its deck is the only thing changed', async () => {
    const user = userEvent.setup();
    const data = twoDecks();
    const before = data.cards[0]!;
    const storage = storageWithData(data);
    renderApp({ storage, route: '/edit/c1' });

    expect(screen.getByLabelText('Deck')).toHaveValue('biology');
    await user.selectOptions(screen.getByLabelText('Deck'), 'default');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const moved = storedCards(storage).find((c) => c.id === 'c1');
    expect(moved).toEqual({ ...before, deckId: 'default', updatedAt: moved!.updatedAt });
  });

  it('asks before leaving when only the deck was changed', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderApp({ storage: storageWithData(twoDecks()), route: '/edit/c1' });

    await user.selectOptions(screen.getByLabelText('Deck'), 'default');
    await user.click(screen.getByRole('link', { name: 'Home' }));

    expect(confirm).toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Edit card' })).toBeInTheDocument();
  });
});
