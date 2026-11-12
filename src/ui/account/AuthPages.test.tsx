import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeCloud } from '../../test/fakeAuth';
import { MemoryStorage } from '../../test/memoryStorage';
import { makeCard, renderApp, storageWithCards } from '../../test/renderApp';

const PASSWORD = 'studyhard2026';

describe('without cloud settings', () => {
  it('has no account link, and explains instead of offering sign-in', async () => {
    renderApp({ route: '/account' });
    expect(await screen.findByText(/accounts and sync are not set up/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign in|account/i })).toBeNull();
  });

  it('explains a misconfigured build without breaking the app', async () => {
    renderApp({
      route: '/account/sign-in',
      cloud: { services: null, error: 'The configured Supabase key is a secret key.' },
    });
    expect(await screen.findByText(/secret key/i)).toBeInTheDocument();
  });
});

describe('signing up', () => {
  it('checks the email and password before sending anything', async () => {
    const cloud = fakeCloud();
    const user = userEvent.setup();
    renderApp({ route: '/account/sign-up', cloud: cloud.setup });

    await user.click(await screen.findByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toHaveFocus();

    await user.type(screen.getByLabelText('Email address'), 'me@example.test');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveFocus();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(cloud.auth.calls).not.toContain('signUp');
  });

  it('shows and hides the password', async () => {
    const cloud = fakeCloud();
    const user = userEvent.setup();
    renderApp({ route: '/account/sign-up', cloud: cloud.setup });
    const field = await screen.findByLabelText('Password');
    expect(field).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(field).toHaveAttribute('type', 'password');
  });

  it('creates the account and uploads the cards already in this browser', async () => {
    const cloud = fakeCloud();
    const user = userEvent.setup();
    const storage = storageWithCards([makeCard({ id: 'old-1', term: 'kept' })]);
    renderApp({ storage, route: '/account/sign-up', cloud: cloud.setup });

    await user.type(await screen.findByLabelText('Email address'), 'me@example.test');
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeInTheDocument();
    await waitFor(() => expect(cloud.server.live('card').map((c) => c.id)).toEqual(['old-1']));
    expect(await screen.findByText(/1 cards from this browser added/)).toBeInTheDocument();
    // Nothing on this browser was removed.
    expect(JSON.parse(storage.getItem('snapnotes.data.v2')!).cards).toHaveLength(1);
  });

  it('asks to confirm the email when the server requires it', async () => {
    const cloud = fakeCloud();
    cloud.auth.needsConfirmation = true;
    const user = userEvent.setup();
    renderApp({ route: '/account/sign-up', cloud: cloud.setup });
    await user.type(await screen.findByLabelText('Email address'), 'me@example.test');
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
  });

  it('explains when the email is already registered', async () => {
    const cloud = fakeCloud();
    cloud.auth.addUser('taken@example.test', PASSWORD);
    const user = userEvent.setup();
    renderApp({ route: '/account/sign-up', cloud: cloud.setup });
    await user.type(await screen.findByLabelText('Email address'), 'taken@example.test');
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/);
  });
});

describe('signing in', () => {
  it('reports wrong credentials without saying which part was wrong', async () => {
    const cloud = fakeCloud();
    cloud.auth.addUser('me@example.test', PASSWORD);
    const user = userEvent.setup();
    renderApp({ route: '/account/sign-in', cloud: cloud.setup });
    await user.type(await screen.findByLabelText('Email address'), 'me@example.test');
    await user.type(screen.getByLabelText('Password'), 'not it 123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That email and password do not match an account.',
    );
  });

  it('reports a lost connection clearly', async () => {
    const cloud = fakeCloud();
    cloud.auth.offline = true;
    const user = userEvent.setup();
    renderApp({ route: '/account/sign-in', cloud: cloud.setup });
    await user.type(await screen.findByLabelText('Email address'), 'me@example.test');
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/);
  });

  it('signs in, downloads the account into an empty browser, and shows it in the navigation', async () => {
    const cloud = fakeCloud();
    cloud.auth.addUser('me@example.test', PASSWORD);
    cloud.server.push([
      {
        kind: 'deck',
        id: 'default',
        baseRevision: null,
        deleted: false,
        data: { id: 'default', name: 'My Cards', createdAt: 1, updatedAt: 1 },
      },
      {
        kind: 'card',
        id: 'cloud-1',
        baseRevision: null,
        deleted: false,
        data: makeCard({ id: 'cloud-1', term: 'from the cloud' }),
      },
    ]);
    const user = userEvent.setup();
    renderApp({ route: '/account/sign-in', cloud: cloud.setup });
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/account',
    );

    await user.type(screen.getByLabelText('Email address'), 'me@example.test');
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('link', { name: 'Account: Synced' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Cards' }));
    expect(await screen.findByText('from the cloud')).toBeInTheDocument();
  });

  it('restores the session after a reload', async () => {
    const cloud = fakeCloud();
    cloud.auth.addUser('me@example.test', PASSWORD);
    cloud.auth.signInAs('me@example.test');
    renderApp({ route: '/account', cloud: cloud.setup });
    expect(await screen.findByText('me@example.test')).toBeInTheDocument();
  });

  it('sends a signed-in user from the sign-in page to their account', async () => {
    const cloud = fakeCloud();
    cloud.auth.addUser('me@example.test', PASSWORD);
    cloud.auth.signInAs('me@example.test');
    renderApp({ route: '/account/sign-in', cloud: cloud.setup });
    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeInTheDocument();
  });
});

describe('password recovery', () => {
  it('sends a reset link without revealing whether the account exists', async () => {
    const cloud = fakeCloud();
    const user = userEvent.setup();
    renderApp({ route: '/account/forgot-password', cloud: cloud.setup });
    await user.type(await screen.findByLabelText('Email address'), 'who@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/If there is an account for/)).toBeInTheDocument();
    expect(cloud.auth.resetRequests).toEqual(['who@example.test']);
  });

  it('lets the user choose a new password after following the link', async () => {
    const cloud = fakeCloud();
    cloud.auth.addUser('me@example.test', PASSWORD);
    cloud.auth.signInAs('me@example.test');
    cloud.auth.redirect = { kind: 'recovery' };
    const user = userEvent.setup();
    renderApp({ route: '/account/reset-password', cloud: cloud.setup });

    await user.type(await screen.findByLabelText('New password'), 'brandnew2027');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText('Your password has been changed.')).toBeInTheDocument();
    expect(await cloud.auth.reauthenticate('brandnew2027')).toEqual({ ok: true, value: undefined });
  });

  it('explains an expired or reused link', async () => {
    const cloud = fakeCloud();
    renderApp({ route: '/account/reset-password', cloud: cloud.setup });
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired/);
    expect(screen.getByRole('link', { name: 'Request a new link' })).toBeInTheDocument();
  });
});

describe('expired sessions', () => {
  it('tells the user when the server refuses the session, and keeps their data', async () => {
    const cloud = fakeCloud();
    cloud.auth.addUser('me@example.test', PASSWORD);
    cloud.auth.signInAs('me@example.test');
    cloud.auth.canRefresh = false;
    cloud.server.failPulls.push('auth');
    const storage = storageWithCards([makeCard({ term: 'still here' })]);
    renderApp({ storage, route: '/', cloud: cloud.setup });

    expect(await screen.findByText(/Your session ended/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in again' })).toBeInTheDocument();
    expect(JSON.parse(storage.getItem('snapnotes.data.v2')!).cards[0].term).toBe('still here');
  });
});

it('never writes the original app’s data, whatever the account does', async () => {
  const cloud = fakeCloud();
  const storage = new MemoryStorage({ abbas_flashcards_v1: '[]' });
  const user = userEvent.setup();
  renderApp({ storage, route: '/account/sign-up', cloud: cloud.setup });
  await user.type(await screen.findByLabelText('Email address'), 'me@example.test');
  await user.type(screen.getByLabelText('Password'), PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByRole('heading', { name: 'Your account' });
  // The shared afterEach guard checks that the original key was never written.
  expect(storage.getItem('abbas_flashcards_v1')).toBe('[]');
});
