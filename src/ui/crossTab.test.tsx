import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { STORAGE_KEY } from '../storage/localStore';
import { makeAppData, makeCard, renderApp } from '../test/renderApp';

/**
 * Two tabs share one localStorage. When the other tab (or sync running in it)
 * saves, this tab takes the new data instead of later writing its older copy
 * over it. Storage events only fire for the browser's own storage, so this
 * test uses jsdom's.
 */

afterEach(() => {
  window.localStorage.removeItem(STORAGE_KEY);
});

it('picks up cards saved by another tab, and builds on them', async () => {
  const user = userEvent.setup();
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(makeAppData([makeCard({ term: 'first' })])),
  );
  renderApp({ storage: window.localStorage, route: '/list' });
  expect(screen.getByText('first')).toBeInTheDocument();

  // The other tab adds a card.
  const fromOtherTab = makeAppData([
    makeCard({ term: 'first' }),
    makeCard({ term: 'from the other tab' }),
  ]);
  const serialized = JSON.stringify(fromOtherTab);
  window.localStorage.setItem(STORAGE_KEY, serialized);
  act(() => {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: STORAGE_KEY,
        newValue: serialized,
        storageArea: window.localStorage,
      }),
    );
  });
  expect(await screen.findByText('from the other tab')).toBeInTheDocument();

  // A change here keeps the other tab's card.
  await user.click(screen.getByRole('link', { name: 'Add card' }));
  await user.type(screen.getByLabelText('Term'), 'from this tab');
  await user.type(screen.getByLabelText('Definition'), 'x');
  await user.click(screen.getByRole('button', { name: 'Add card' }));
  const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as {
    cards: { term: string }[];
  };
  expect(saved.cards.map((c) => c.term)).toEqual(['first', 'from the other tab', 'from this tab']);
});
