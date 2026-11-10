import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LEGACY_STORAGE_KEY, STORAGE_KEY } from './storage/localStore';
import { MIGRATION_RECORD_KEY } from './storage/migrationRecord';
import { MemoryStorage } from './test/memoryStorage';
import { makeCard, renderApp, storageWithCards } from './test/renderApp';
import { LEGACY_APP_URL } from './ui/legacyApp';

describe('App', () => {
  it('renders the home page with navigation', () => {
    renderApp();

    expect(screen.getByRole('heading', { level: 1, name: 'Your flashcards' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cards' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Study' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quiz' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Learn' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Match' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add card' })).toBeInTheDocument();
  });

  it('navigates between views through the main navigation', async () => {
    const user = userEvent.setup();
    renderApp({ storage: storageWithCards([makeCard()]) });

    await user.click(screen.getByRole('link', { name: 'Cards' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Cards' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Study' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Study' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Quiz' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Quiz' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Learn' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Learn' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Match' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Match' })).toBeInTheDocument();

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

  it("moves the original app's cards over on the first visit", () => {
    const storage = new MemoryStorage({
      [LEGACY_STORAGE_KEY]: JSON.stringify([{ id: 'a', term: 'legacy', definition: 'card' }]),
    });

    renderApp({ storage });

    expect(screen.getByText('legacy')).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Welcome to the new Snap Notes' }),
    ).toBeInTheDocument();
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).cards).toMatchObject([
      { id: 'a', term: 'legacy', definition: 'card', deckId: 'default' },
    ]);
    expect(storage.writes.map((w) => w.key)).toEqual([STORAGE_KEY, MIGRATION_RECORD_KEY]);
  });

  it('refuses to run over unreadable stored data and offers a backup', () => {
    const storage = new MemoryStorage({ [STORAGE_KEY]: '{broken json' });

    renderApp({ storage });

    expect(
      screen.getByRole('heading', { name: 'Your saved cards could not be read' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download my data' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the original app' })).toHaveAttribute(
      'href',
      LEGACY_APP_URL,
    );
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

  it('runs in memory when the browser blocks every read of storage', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    storage.failReads = new DOMException('Access denied', 'SecurityError');

    renderApp({ storage, route: '/add' });

    expect(screen.getByRole('alert')).toHaveTextContent('Browser storage is unavailable');
    await user.type(screen.getByLabelText('Term'), 'In memory');
    await user.type(screen.getByLabelText('Definition'), 'Only');
    await user.click(screen.getByRole('button', { name: 'Add card' }));
    expect(screen.getByText('In memory')).toBeInTheDocument();
    expect(storage.writes).toEqual([]);
  });
});
