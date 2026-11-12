import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultDeck } from '../../domain/appData';
import type { Card } from '../../domain/types';
import { SYNC_STORAGE_KEY } from '../../storage/syncStore';
import { fakeCloud, type FakeCloud } from '../../test/fakeAuth';
import { makeCard, renderApp, storageWithCards, storedCards } from '../../test/renderApp';

const EMAIL = 'me@example.test';
const PASSWORD = 'studyhard2026';

/** An account holding `cards`, and the user signed in on this browser. */
function signedIn(cards: Card[] = []): FakeCloud {
  const cloud = fakeCloud();
  cloud.auth.addUser(EMAIL, PASSWORD, 'user-1');
  cloud.auth.signInAs(EMAIL);
  cloud.server.push([
    {
      kind: 'deck',
      id: 'default',
      baseRevision: null,
      deleted: false,
      data: createDefaultDeck(1_000),
    },
    ...cards.map((card) => ({
      kind: 'card' as const,
      id: card.id,
      baseRevision: null,
      deleted: false,
      data: card,
    })),
  ]);
  return cloud;
}

afterEach(() => {
  // Tests that go offline must not leave the next test offline.
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

describe('linking a browser that already has cards', () => {
  it('asks before combining, then keeps everything from both without duplicates', async () => {
    const shared = makeCard({ id: 'cloud-hola', term: 'hola', definition: 'hello' });
    const cloud = signedIn([shared, makeCard({ id: 'cloud-only', term: 'only in the cloud' })]);
    const storage = storageWithCards([
      makeCard({ id: 'local-hola', term: 'hola', definition: 'hello' }),
      makeCard({ id: 'local-only', term: 'only here' }),
    ]);
    const user = userEvent.setup();
    renderApp({ storage, route: '/', cloud: cloud.setup });

    // Nothing is uploaded until the user chooses.
    const banner = await screen.findByText(/cards are not syncing yet/);
    expect(cloud.server.live('card')).toHaveLength(2);
    await user.click(within(banner).getByRole('link'));

    // Two cards here, two in the account.
    expect(await screen.findAllByText('2 cards in 1 deck', { selector: 'dd' })).toHaveLength(2);
    expect(screen.getByRole('radio', { name: /Combine them/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Combine and sync' }));

    await waitFor(() =>
      expect(
        cloud.server
          .live('card')
          .map((c) => c.term)
          .sort(),
      ).toEqual(['hola', 'only here', 'only in the cloud']),
    );
    expect(
      storedCards(storage)
        .map((c) => c.term)
        .sort(),
    ).toEqual(['hola', 'only here', 'only in the cloud']);
    expect(await screen.findByText(/1 cards found on both and kept once/)).toBeInTheDocument();
  });

  it('can replace this browser’s cards with the account’s, offering a backup first', async () => {
    const cloud = signedIn([makeCard({ id: 'cloud-1', term: 'from the account' })]);
    const storage = storageWithCards([makeCard({ id: 'local-1', term: 'from this browser' })]);
    const user = userEvent.setup();
    renderApp({ storage, route: '/account/link', cloud: cloud.setup });

    await user.click(await screen.findByRole('radio', { name: /Use only my account/ }));
    expect(
      screen.getByRole('button', { name: /Download a backup of this browser/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Replace and sync' }));

    await waitFor(() =>
      expect(storedCards(storage).map((c) => c.term)).toEqual(['from the account']),
    );
    // The account was not changed.
    expect(cloud.server.live('card').map((c) => c.term)).toEqual(['from the account']);
  });

  it('warns when the browser was last synced with a different account', async () => {
    const cloud = signedIn([makeCard({ id: 'c1' })]);
    const storage = storageWithCards([makeCard({ id: 'other-1', term: 'someone else' })]);
    storage.setItem(
      SYNC_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        userId: 'someone-else',
        email: 'other@example.test',
        cursor: 0,
        lastSyncedAt: null,
        linkedAt: 1_000,
        base: { deck: {}, card: {}, progress: {}, history: {} },
        conflicts: [],
        rejected: [],
      }),
    );
    renderApp({ storage, route: '/account/link', cloud: cloud.setup });
    expect(await screen.findByText(/other@example.test/)).toBeInTheDocument();
    // For another person's cards, replacing is the safer default.
    expect(screen.getByRole('radio', { name: /Use only my account/ })).toBeChecked();
  });
});

describe('offline studying', () => {
  it('saves reviews locally while offline and uploads them when the connection returns', async () => {
    const card = makeCard({ id: 'c1', term: 'Nucleus', definition: 'Control centre' });
    const cloud = signedIn([card]);
    const storage = storageWithCards([]);
    const user = userEvent.setup();
    renderApp({ storage, route: '/account', cloud: cloud.setup });
    expect(await screen.findByRole('link', { name: 'Account: Synced' })).toBeInTheDocument();

    setOnline(false);
    expect(await screen.findByRole('link', { name: 'Account: Offline' })).toBeInTheDocument();
    const pushesWhileOffline = cloud.server.pushes;

    await user.click(screen.getByRole('link', { name: 'Review' }));
    await user.click(await screen.findByRole('link', { name: 'Learn new cards (1)' }));
    await user.click(await screen.findByRole('button', { name: 'Show answer' }));
    await user.click(screen.getByRole('button', { name: /^Good/ }));

    expect(
      await screen.findByRole('link', { name: /Account: Offline · 2 changes waiting/ }),
    ).toBeInTheDocument();
    expect(cloud.server.pushes).toBe(pushesWhileOffline);

    setOnline(true);
    await waitFor(() => expect(cloud.server.live('progress')).toHaveLength(1));
    expect(cloud.server.live('history')).toHaveLength(1);
    expect(await screen.findByRole('link', { name: 'Account: Synced' })).toBeInTheDocument();
  });
});

describe('the sync section', () => {
  it('shows a failed sync, retries on request, and clears the error once it works', async () => {
    const cloud = signedIn();
    const user = userEvent.setup();
    renderApp({ storage: storageWithCards([]), route: '/account', cloud: cloud.setup });
    await screen.findByRole('link', { name: 'Account: Synced' });

    cloud.server.failPulls.push('server');
    await user.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText('The sync server is busy or unavailable.')).toBeInTheDocument();
    expect(screen.getByText(/will try again in under a minute/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Account: Sync problem' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/busy or unavailable/)).toBeNull());
    expect(screen.getByRole('link', { name: 'Account: Synced' })).toBeInTheDocument();
  });

  it('retries setting up sync when the server is briefly unavailable', async () => {
    const cloud = signedIn([makeCard({ id: 'c1', term: 'waiting in the cloud' })]);
    cloud.server.failPulls.push('network');
    const storage = storageWithCards([]);
    renderApp({ storage, route: '/account', cloud: cloud.setup });

    expect(await screen.findByText(/Sync could not be set up/)).toBeInTheDocument();
    expect(screen.getByText(/will try again/)).toBeInTheDocument();
    // The first automatic retry comes five seconds later.
    await waitFor(
      () => expect(storedCards(storage).map((c) => c.term)).toEqual(['waiting in the cloud']),
      {
        timeout: 7_000,
      },
    );
  }, 10_000);

  it('syncs on request and reports when it last did', async () => {
    const cloud = signedIn([makeCard({ id: 'c1', term: 'first' })]);
    const user = userEvent.setup();
    renderApp({ storage: storageWithCards([]), route: '/account', cloud: cloud.setup });
    expect(await screen.findByText('Just now')).toBeInTheDocument();

    cloud.server.push([
      {
        kind: 'card',
        id: 'c2',
        baseRevision: null,
        deleted: false,
        data: makeCard({ id: 'c2', term: 'from another device' }),
      },
    ]);
    await user.click(screen.getByRole('button', { name: 'Sync now' }));
    await user.click(screen.getByRole('link', { name: 'Cards' }));
    expect(await screen.findByText('from another device')).toBeInTheDocument();
  });

  it('lists a conflict and can switch to the version that was set aside', async () => {
    const original = makeCard({ id: 'c1', term: 'original' });
    const cloud = signedIn([original]);
    const storage = storageWithCards([]);
    const user = userEvent.setup();
    renderApp({ storage, route: '/account', cloud: cloud.setup });
    await screen.findByRole('link', { name: 'Account: Synced' });

    // Offline, this browser edits the card while another device edits it too.
    setOnline(false);
    await user.click(screen.getByRole('link', { name: 'Cards' }));
    await user.click(await screen.findByRole('link', { name: /Edit/ }));
    await user.clear(screen.getByLabelText('Term'));
    await user.type(screen.getByLabelText('Term'), 'edited here');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    cloud.server.push([
      {
        kind: 'card',
        id: 'c1',
        baseRevision: 2,
        deleted: false,
        data: { ...original, term: 'edited elsewhere', updatedAt: original.updatedAt + 1 },
      },
    ]);
    setOnline(true);

    await user.click(screen.getByRole('link', { name: /^Account/ }));
    expect(await screen.findByText(/was changed on two devices/)).toBeInTheDocument();
    expect(screen.getByText(/Other version: “edited elsewhere”/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use the other version' }));

    expect(storedCards(storage)[0]?.term).toBe('edited elsewhere');
    await user.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(cloud.server.live('card')[0]?.term).toBe('edited elsewhere'));
    expect(screen.queryByText(/was changed on two devices/)).toBeNull();
  });
});

describe('signing out', () => {
  it('keeps the cards on this browser by default', async () => {
    const cloud = signedIn([makeCard({ id: 'c1', term: 'mine' })]);
    const storage = storageWithCards([]);
    const user = userEvent.setup();
    renderApp({ storage, route: '/account', cloud: cloud.setup });
    await screen.findByRole('link', { name: 'Account: Synced' });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(
      await screen.findByText('You are signed out. Your cards stay on this browser.'),
    ).toBeInTheDocument();
    expect(storedCards(storage).map((c) => c.term)).toEqual(['mine']);
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
        name: 'Sign in',
      }),
    ).toBeInTheDocument();
  });

  it('can remove everything from a shared computer', async () => {
    const cloud = signedIn([makeCard({ id: 'c1', term: 'mine' })]);
    const storage = storageWithCards([]);
    const user = userEvent.setup();
    renderApp({ storage, route: '/account', cloud: cloud.setup });
    await screen.findByRole('link', { name: 'Account: Synced' });

    await user.click(screen.getByRole('checkbox', { name: /Also remove my cards/ }));
    await user.click(screen.getByRole('button', { name: 'Sign out on every device' }));
    expect(await screen.findByText(/removed from this browser/)).toBeInTheDocument();
    expect(storedCards(storage)).toEqual([]);
    expect(storage.getItem(SYNC_STORAGE_KEY)).toBeNull();
    expect(cloud.auth.calls).toContain('signOut:global');
    // The account still has its copy.
    expect(cloud.server.live('card')).toHaveLength(1);
  });

  it('warns about changes that have not synced yet', async () => {
    const cloud = signedIn();
    const storage = storageWithCards([]);
    const user = userEvent.setup();
    renderApp({ storage, route: '/account', cloud: cloud.setup });
    await screen.findByRole('link', { name: 'Account: Synced' });
    setOnline(false);
    await user.click(screen.getByRole('link', { name: 'Add card' }));
    await user.type(screen.getByLabelText('Term'), 'unsynced');
    await user.type(screen.getByLabelText('Definition'), 'yet');
    await user.click(screen.getByRole('button', { name: 'Add card' }));
    await user.click(screen.getByRole('link', { name: /^Account/ }));
    expect(
      await screen.findByText(/1 change on this browser has not synced yet/),
    ).toBeInTheDocument();
    setOnline(true);
  });
});

describe('deleting the account', () => {
  it('needs the password, then deletes the account and keeps this browser’s cards', async () => {
    const cloud = signedIn([makeCard({ id: 'c1', term: 'mine' })]);
    const storage = storageWithCards([]);
    const user = userEvent.setup();
    renderApp({ storage, route: '/account', cloud: cloud.setup });
    await screen.findByRole('link', { name: 'Account: Synced' });

    await user.click(screen.getByRole('button', { name: 'Delete my account…' }));
    await user.type(screen.getByLabelText('Your password'), 'wrong one 1');
    await user.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That password is not correct.');
    expect(cloud.auth.calls).not.toContain('deleteAccount');

    await user.clear(screen.getByLabelText('Your password'));
    await user.type(screen.getByLabelText('Your password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Permanently delete my account' }));

    expect(
      await screen.findByText(/Your account and its cloud data have been deleted/),
    ).toBeInTheDocument();
    expect(storedCards(storage).map((c) => c.term)).toEqual(['mine']);
    expect(storage.getItem(SYNC_STORAGE_KEY)).toBeNull();
    expect(await cloud.auth.signIn(EMAIL, PASSWORD)).toMatchObject({ ok: false });
  });

  it('can also remove the cards from this browser', async () => {
    const cloud = signedIn([makeCard({ id: 'c1', term: 'mine' })]);
    const storage = storageWithCards([]);
    const user = userEvent.setup();
    renderApp({ storage, route: '/account', cloud: cloud.setup });
    await screen.findByRole('link', { name: 'Account: Synced' });

    await user.click(screen.getByRole('button', { name: 'Delete my account…' }));
    await user.type(screen.getByLabelText('Your password'), PASSWORD);
    await user.click(
      screen.getByRole('checkbox', {
        name: /Also remove my cards, decks and progress from this browser\.$/,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    expect(await screen.findByText(/from the server and from this browser/)).toBeInTheDocument();
    expect(storedCards(storage)).toEqual([]);
  });
});

describe('changing the password', () => {
  it('checks the current password first', async () => {
    const cloud = signedIn();
    const user = userEvent.setup();
    renderApp({ storage: storageWithCards([]), route: '/account', cloud: cloud.setup });
    await screen.findByRole('link', { name: 'Account: Synced' });

    await user.type(screen.getByLabelText('Current password'), 'not right 1');
    await user.type(screen.getByLabelText('New password'), 'evenbetter2027');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That password is not correct.');

    await user.clear(screen.getByLabelText('Current password'));
    await user.type(screen.getByLabelText('Current password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Your password has been changed.')).toBeInTheDocument();
  });
});
