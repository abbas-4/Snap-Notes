import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LEGACY_STORAGE_KEY, STORAGE_KEY } from './storage/localStore';
import { MemoryStorage } from './test/memoryStorage';
import { makeCard, renderApp, storageWithCards } from './test/renderApp';

describe('App', () => {
  it('renders the home page with navigation', () => {
    renderApp();

    expect(screen.getByRole('heading', { level: 1, name: 'Your flashcards' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cards' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add card' })).toBeInTheDocument();
  });

  it('navigates between views through the main navigation', async () => {
    const user = userEvent.setup();
    renderApp({ storage: storageWithCards([makeCard()]) });

    await user.click(screen.getByRole('link', { name: 'Cards' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Cards' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Add card' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Add a card' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Home' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Your flashcards' })).toBeInTheDocument();
  });

  it('shows a not-found page for unknown routes', () => {
    renderApp({ route: '/no-such-page' });

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toBeInTheDocument();
  });

  it('never reads or migrates the legacy key before cutover', () => {
    const storage = new MemoryStorage({
      [LEGACY_STORAGE_KEY]: JSON.stringify([{ id: 'a', term: 'legacy', definition: 'card' }]),
    });
    const getItem = vi.spyOn(storage, 'getItem');

    renderApp({ storage });

    // The legacy data is invisible to the rebuild: the app starts empty.
    expect(screen.getByRole('heading', { name: 'No cards yet' })).toBeInTheDocument();
    expect(getItem).not.toHaveBeenCalledWith(LEGACY_STORAGE_KEY);
    expect(storage.writes).toEqual([]);
    vi.restoreAllMocks();
  });

  it('refuses to run over unreadable stored data and offers a backup', () => {
    const storage = new MemoryStorage({ [STORAGE_KEY]: '{broken json' });

    renderApp({ storage });

    expect(
      screen.getByRole('heading', { name: 'Your saved cards could not be read' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download my data' })).toBeInTheDocument();
    // Nothing is overwritten.
    expect(storage.writes).toEqual([]);
    expect(storage.getItem(STORAGE_KEY)).toBe('{broken json');
  });

  it('keeps data from a newer version untouched', () => {
    const storage = new MemoryStorage({
      [STORAGE_KEY]: JSON.stringify({ schemaVersion: 99, decks: [], cards: [] }),
    });

    renderApp({ storage });

    expect(
      screen.getByRole('heading', { name: 'Your saved cards need a newer version of Snap Notes' }),
    ).toBeInTheDocument();
    expect(storage.writes).toEqual([]);
  });

  it('warns when browser storage is unavailable but still runs in memory', () => {
    renderApp({ storage: null });

    expect(screen.getByRole('alert')).toHaveTextContent('Browser storage is unavailable');
    expect(screen.getByRole('heading', { level: 1, name: 'Your flashcards' })).toBeInTheDocument();
  });
});
