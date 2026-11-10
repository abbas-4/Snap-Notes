import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LEGACY_STORAGE_KEY, STORAGE_KEY } from '../storage/localStore';
import { MemoryStorage } from '../test/memoryStorage';
import { makeAppData, makeCard, renderApp, storageWithCards, storedCards } from '../test/renderApp';

const BUTTON = 'Import cards from the original app';

const existing = makeCard({ id: 'a1', term: 'Mitochondria', definition: 'Powerhouse of the cell' });
const legacyRaw = JSON.stringify([
  { id: 'a1', term: 'Mitochondria', definition: 'Powerhouse of the cell', created: 1 },
  { id: 'b2', term: 'Ribosome', definition: 'Makes proteins', created: 2 },
]);

function storageWithBoth(legacy = legacyRaw, cards = [existing]) {
  return new MemoryStorage({
    [STORAGE_KEY]: JSON.stringify(makeAppData(cards)),
    [LEGACY_STORAGE_KEY]: legacy,
  });
}

describe('Import cards from the original app', () => {
  it("merges the original app's cards into the current data without duplicating", async () => {
    const user = userEvent.setup();
    const storage = storageWithBoth();
    renderApp({ storage });

    await user.click(screen.getByRole('button', { name: BUTTON }));

    expect(screen.getByRole('status')).toHaveTextContent(
      'Imported 1 card. Skipped 1 card you already have.',
    );
    expect(storedCards(storage).map((c) => c.term)).toEqual(['Mitochondria', 'Ribosome']);

    await user.click(screen.getByRole('button', { name: BUTTON }));

    expect(screen.getByRole('status')).toHaveTextContent(
      'No new cards to import. Skipped 2 cards you already have.',
    );
    expect(storedCards(storage)).toHaveLength(2);
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(legacyRaw);
  });

  it('does not add copies of entries whose IDs were duplicated or missing', async () => {
    const user = userEvent.setup();
    // The original app's own import produced duplicate IDs like these.
    const storage = new MemoryStorage({
      [LEGACY_STORAGE_KEY]: JSON.stringify([
        { id: 'a1', term: 'T1', definition: 'D1', created: 1 },
        { id: 'a1', term: 'T1', definition: 'D1' },
        { term: 'No id', definition: 'X' },
      ]),
    });
    renderApp({ storage });
    expect(storedCards(storage)).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: BUTTON }));
    await user.click(screen.getByRole('button', { name: BUTTON }));

    const panel = within(screen.getByRole('region', { name: 'Import and export' }));
    expect(panel.getByRole('status')).toHaveTextContent(
      'No new cards to import. Skipped 3 cards you already have.',
    );
    expect(storedCards(storage)).toHaveLength(3);
  });

  it('leaves a card edited here as it is instead of bringing back the old version', async () => {
    const user = userEvent.setup();
    const edited = makeCard({ id: 'a1', term: 'Mitochondria', definition: 'Edited here' });
    const storage = storageWithBoth(legacyRaw, [edited]);
    renderApp({ storage });

    await user.click(screen.getByRole('button', { name: BUTTON }));

    expect(storedCards(storage).map((c) => [c.id, c.definition])).toEqual([
      ['a1', 'Edited here'],
      ['b2', 'Makes proteins'],
    ]);
  });

  it('is not offered when the original app left nothing readable behind', () => {
    renderApp({ storage: storageWithCards([existing]) });
    expect(screen.queryByRole('button', { name: BUTTON })).not.toBeInTheDocument();

    for (const raw of ['[]', 'null', '{bad', '{"cards":[]}']) {
      renderApp({ storage: storageWithBoth(raw) }).unmount();
      expect(screen.queryByRole('button', { name: BUTTON })).not.toBeInTheDocument();
    }
  });

  it('explains when none of the original entries are cards, and changes nothing', async () => {
    const user = userEvent.setup();
    const storage = storageWithBoth('[{"id":"x"}]');
    renderApp({ storage });

    await user.click(screen.getByRole('button', { name: BUTTON }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Import failed: None of the entries saved by the original app could be read as cards. Your cards were not changed.',
    );
    expect(storedCards(storage)).toHaveLength(1);
    expect(storage.writes).toEqual([]);
  });

  it('reports a full storage instead of pretending the import worked', async () => {
    const user = userEvent.setup();
    const storage = storageWithBoth();
    renderApp({ storage });
    storage.failWrites = new DOMException('Full', 'QuotaExceededError');

    await user.click(screen.getByRole('button', { name: BUTTON }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Import failed: Browser storage is full. Your cards were not changed.',
    );
    expect(storedCards(storage)).toHaveLength(1);
    fireEvent.focus(window);
    expect(screen.getByRole('button', { name: BUTTON })).toBeInTheDocument();
  });
});
