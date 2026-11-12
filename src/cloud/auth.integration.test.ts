import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../test/memoryStorage';
import {
  APP_URL,
  browser,
  followEmailLink,
  latestEmail,
  newAccount,
  PASSWORD,
  uniqueEmail,
} from '../test/integration';
import { AUTH_STORAGE_KEY } from './supabaseServices';

describe('registration', () => {
  it('creates an account and signs it in', async () => {
    const email = uniqueEmail('register');
    const { auth } = await browser();
    const result = await auth.signUp(email, PASSWORD);
    expect(result).toEqual({ ok: true, value: { needsConfirmation: false } });
    const { session } = await auth.getSession();
    expect(session?.user.email).toBe(email);
  });

  it('refuses a second account with the same email', async () => {
    const { email } = await newAccount('taken');
    const { auth } = await browser();
    const result = await auth.signUp(email, PASSWORD);
    expect(result).toMatchObject({ ok: false, code: 'email-taken' });
  });

  it('refuses a weak password, enforced by the server', async () => {
    const { auth } = await browser();
    expect(await auth.signUp(uniqueEmail('weak'), 'short')).toMatchObject({
      ok: false,
      code: 'weak-password',
    });
    expect(await auth.signUp(uniqueEmail('weak'), 'onlyletters')).toMatchObject({
      ok: false,
      code: 'weak-password',
    });
  });

  it('never stores the password in the browser', async () => {
    const storage = new MemoryStorage();
    const { auth } = await browser(storage);
    await auth.signUp(uniqueEmail('nopass'), PASSWORD);
    expect(storage.getItem(AUTH_STORAGE_KEY)).not.toContain(PASSWORD);
  });
});

describe('signing in and out', () => {
  it('signs in with the right password', async () => {
    const { email } = await newAccount('login');
    const { auth } = await browser();
    expect(await auth.signIn(email, PASSWORD)).toEqual({ ok: true, value: undefined });
    expect((await auth.getSession()).session?.user.email).toBe(email);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { email } = await newAccount('wrong');
    const { auth } = await browser();
    const wrongPassword = await auth.signIn(email, 'not the password 1');
    const unknownEmail = await auth.signIn(uniqueEmail('nobody'), PASSWORD);
    expect(wrongPassword).toMatchObject({ ok: false, code: 'invalid-credentials' });
    expect(unknownEmail).toEqual(wrongPassword);
  });

  it('signs out and forgets the session', async () => {
    const { services } = await newAccount('logout');
    expect(await services.auth.signOut('local')).toEqual({ ok: true, value: undefined });
    expect((await services.auth.getSession()).session).toBeNull();
    expect(services.storage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it('restores the session after a page reload', async () => {
    const { services, email } = await newAccount('restore');
    // A reload: a new client over the same storage.
    const reloaded = await browser(services.storage);
    const { session, offline } = await reloaded.auth.getSession();
    expect(session?.user.email).toBe(email);
    expect(offline).toBe(false);
  });

  it('keeps showing who is signed in when the server cannot be reached', async () => {
    const { services, email } = await newAccount('offline');
    // Force the saved access token to look expired, so a refresh is needed.
    const saved = JSON.parse(services.storage.getItem(AUTH_STORAGE_KEY)!) as Record<
      string,
      unknown
    >;
    services.storage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({ ...saved, expires_at: Math.floor(Date.now() / 1000) - 60 }),
    );
    const offlineFetch: typeof fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    const reloaded = await browser(services.storage, offlineFetch);
    const { session, offline } = await reloaded.auth.getSession();
    expect(offline).toBe(true);
    expect(session?.user.email).toBe(email);
    // Nothing was thrown away: back online, the session is renewed.
    const online = await browser(services.storage);
    expect((await online.auth.getSession()).session?.user.email).toBe(email);
  });

  it('ends a session that was signed out everywhere once its token expires', async () => {
    const { services, email } = await newAccount('expired');
    const other = await browser();
    await other.auth.signIn(email, PASSWORD);
    expect(await other.auth.signOut('global')).toEqual({ ok: true, value: undefined });

    // The first browser cannot renew its session any more.
    expect(await services.auth.refresh()).toBe(false);

    // Its access token stays valid until it expires (tokens are checked by
    // signature, not looked up), but the moment it does, the session is over.
    const saved = JSON.parse(services.storage.getItem(AUTH_STORAGE_KEY)!) as Record<
      string,
      unknown
    >;
    services.storage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({ ...saved, expires_at: Math.floor(Date.now() / 1000) - 60 }),
    );
    const reloaded = await browser(services.storage);
    expect(await reloaded.auth.getSession()).toEqual({ session: null, offline: false });
  });
});

describe('password recovery', () => {
  it('emails a link that lets the user choose a new password', async () => {
    const { email } = await newAccount('recover');
    const forgetful = await browser();
    expect(await forgetful.auth.requestPasswordReset(email)).toEqual({
      ok: true,
      value: undefined,
    });

    const landing = await followEmailLink(await latestEmail(email));
    // The link returns to the app's reset screen, with a one-time code.
    expect(`${landing.origin}${landing.pathname}`).toBe(APP_URL);
    expect(landing.hash).toBe('#/account/reset-password');
    expect(landing.searchParams.get('code')).toBeTruthy();

    expect(await forgetful.auth.completeRedirect(landing.search)).toEqual({ kind: 'recovery' });
    expect(await forgetful.auth.updatePassword('a brand new 99')).toEqual({
      ok: true,
      value: undefined,
    });

    const fresh = await browser();
    expect(await fresh.auth.signIn(email, PASSWORD)).toMatchObject({ ok: false });
    expect(await fresh.auth.signIn(email, 'a brand new 99')).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('does not reveal whether an address has an account', async () => {
    const { auth } = await browser();
    expect(await auth.requestPasswordReset(uniqueEmail('ghost'))).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('refuses a reset link opened in a different browser', async () => {
    const { email } = await newAccount('otherbrowser');
    const asked = await browser();
    await asked.auth.requestPasswordReset(email);
    const landing = await followEmailLink(await latestEmail(email));
    const elsewhere = await browser();
    const outcome = await elsewhere.auth.completeRedirect(landing.search);
    expect(outcome.kind).toBe('error');
    expect((await elsewhere.auth.getSession()).session).toBeNull();
  });

  it('reports an error a link brings back', async () => {
    const { auth } = await browser();
    expect(
      await auth.completeRedirect('?error=access_denied&error_code=otp_expired'),
    ).toMatchObject({ kind: 'error' });
    expect(await auth.completeRedirect('')).toEqual({ kind: 'none' });
  });
});

describe('account management', () => {
  it('changes the password after checking the current one', async () => {
    const { services, email } = await newAccount('changepw');
    expect(await services.auth.reauthenticate('wrong password 1')).toMatchObject({ ok: false });
    expect(await services.auth.reauthenticate(PASSWORD)).toEqual({ ok: true, value: undefined });
    expect(await services.auth.updatePassword('another one 77')).toEqual({
      ok: true,
      value: undefined,
    });
    const fresh = await browser();
    expect(await fresh.auth.signIn(email, 'another one 77')).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('starts an email change that needs confirming', async () => {
    const { services } = await newAccount('changeemail');
    const next = uniqueEmail('newaddress');
    expect(await services.auth.changeEmail(next)).toEqual({ ok: true, value: undefined });
    expect(await latestEmail(next)).toMatch(/verify/);
  });
});
