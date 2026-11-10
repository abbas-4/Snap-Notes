import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type AppData } from '../domain/types';
import { LEGACY_STORAGE_KEY, STORAGE_KEY } from '../storage/localStore';
import { appDataSchema } from '../storage/schemas';
import { MemoryStorage } from '../test/memoryStorage';
import { makeAppData, makeCard, makeDeck, renderApp, storageWithData } from '../test/renderApp';

function stored(storage: MemoryStorage): AppData {
  return JSON.parse(storage.getItem(STORAGE_KEY)!) as AppData;
}

/**
 * Decks were part of the v2 shape from the start, so Milestone 6 adds no
 * migration. These tests pin that: data saved before decks had a UI is read as
 * it is, and nothing the deck UI can do produces data the storage layer would
 * refuse.
 */
describe('decks and existing data', () => {
  it('opens data saved before decks had a UI without writing anything', () => {
    const existing = makeAppData([makeCard({ term: 'From before' })]);
    const storage = storageWithData(existing);

    renderApp({ storage, route: '/decks' });

    expect(screen.getByRole('link', { name: 'My Cards' })).toBeInTheDocument();
    expect(screen.getByText('1 card')).toBeInTheDocument();
    expect(storage.writes).toEqual([]);
    expect(stored(storage)).toEqual(existing);
  });

  it('still reports the schema version it was given', () => {
    const storage = storageWithData(makeAppData([makeCard()]));
    renderApp({ storage, route: '/decks' });

    expect(stored(storage).schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(2);
  });

  it('survives a collection that has no decks at all', () => {
    const storage = storageWithData({ schemaVersion: SCHEMA_VERSION, decks: [], cards: [] });

    renderApp({ storage, route: '/decks' });

    expect(screen.getByRole('heading', { name: 'No decks yet' })).toBeInTheDocument();
    expect(storage.writes).toEqual([]);
  });

  it("puts the original app's migrated cards in a deck the deck page can show", () => {
    const storage = new MemoryStorage({
      [LEGACY_STORAGE_KEY]: JSON.stringify([
        { id: 'a', term: 'legacy one', definition: 'first' },
        { id: 'b', term: 'legacy two', definition: 'second' },
      ]),
    });

    renderApp({ storage, route: '/decks' });

    expect(screen.getByRole('link', { name: 'My Cards' })).toBeInTheDocument();
    expect(screen.getByText('2 cards')).toBeInTheDocument();
    // The original key is still untouched.
    expect(storage.writes.map((w) => w.key)).not.toContain(LEGACY_STORAGE_KEY);
  });

  it('keeps the saved collection valid through a run of deck changes', async () => {
    const user = userEvent.setup();
    const storage = storageWithData(
      makeAppData(
        [
          makeCard({ id: 'c1', deckId: 'default', term: 'Alpha' }),
          makeCard({ id: 'c2', deckId: 'biology', term: 'Osmosis' }),
        ],
        [
          makeDeck({ id: 'default', name: 'My Cards' }),
          makeDeck({ id: 'biology', name: 'Biology' }),
        ],
      ),
    );

    renderApp({ storage, route: '/decks' });

    // Create a deck.
    await user.type(screen.getByLabelText('Deck name'), 'Chemistry');
    await user.click(screen.getByRole('button', { name: 'Create deck' }));
    expect(appDataSchema.safeParse(stored(storage)).success).toBe(true);

    // Rename it.
    await user.click(screen.getByRole('link', { name: 'Chemistry' }));
    const field = screen.getByLabelText('Deck name');
    await user.clear(field);
    await user.type(field, 'Physics');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(appDataSchema.safeParse(stored(storage)).success).toBe(true);

    // Move a card into it, from the card list.
    await user.click(screen.getByRole('link', { name: 'Cards' }));
    await user.selectOptions(screen.getByLabelText('Deck for Osmosis'), 'default');
    expect(appDataSchema.safeParse(stored(storage)).success).toBe(true);

    // Delete a deck; its cards move rather than disappear.
    await user.click(screen.getByRole('link', { name: 'Decks' }));
    await user.click(screen.getByRole('link', { name: 'My Cards' }));
    await user.click(screen.getByRole('button', { name: 'Delete deck' }));
    await user.click(screen.getByRole('button', { name: 'Delete deck' }));

    const final = stored(storage);
    expect(appDataSchema.safeParse(final).success).toBe(true);
    // Every card is still here, and every one points at a deck that exists.
    expect(final.cards.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    const deckIds = new Set(final.decks.map((d) => d.id));
    expect(final.cards.every((c) => deckIds.has(c.deckId))).toBe(true);
  });
});
