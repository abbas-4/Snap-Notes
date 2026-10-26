import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCard, renderApp, storageWithCards, storedCards } from '../test/renderApp';
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
