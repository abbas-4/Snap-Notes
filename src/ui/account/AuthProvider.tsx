import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  authFailure,
  type AuthResult,
  type AuthUser,
  type RedirectOutcome,
} from '../../cloud/auth';
import type { CloudServices } from '../../cloud/supabaseServices';
import { AuthContext, type AuthValue } from './cloud';

interface AuthProviderProps {
  /** null: this build has no cloud settings. A promise while the client library loads. */
  services: CloudServices | Promise<CloudServices> | null;
  configError?: string | null;
  children: ReactNode;
}

/**
 * An email link's one-time code can be exchanged only once, so the exchange
 * is started once per client, however many times the effect below runs (React
 * runs effects twice in development).
 */
const redirects = new WeakMap<CloudServices, Promise<RedirectOutcome>>();

function completeRedirectOnce(services: CloudServices): Promise<RedirectOutcome> {
  let pending = redirects.get(services);
  if (!pending) {
    const search = takeRedirectParams();
    pending = search
      ? services.auth.completeRedirect(search)
      : Promise.resolve<RedirectOutcome>({ kind: 'none' });
    redirects.set(services, pending);
  }
  return pending;
}

/** Reads what an email link brought back, then takes it out of the address bar. */
function takeRedirectParams(): string {
  if (typeof window === 'undefined') return '';
  const { search, pathname, hash } = window.location;
  const params = new URLSearchParams(search);
  if (!params.has('code') && !params.has('error') && !params.has('error_code')) return '';
  // The one-time code must not stay in history, bookmarks or shared links.
  window.history.replaceState(window.history.state, '', `${pathname}${hash}`);
  return search;
}

/**
 * Owns the account session. When the build has no cloud settings it reports
 * `disabled` and does nothing else, so the app behaves exactly as it did
 * before accounts existed.
 */
export default function AuthProvider({
  services: given,
  configError = null,
  children,
}: AuthProviderProps) {
  const [services, setServices] = useState<CloudServices | null>(
    given && !(given instanceof Promise) ? given : null,
  );
  const [status, setStatus] = useState<AuthValue['status']>(given ? 'loading' : 'disabled');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [offline, setOffline] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [notice, setNotice] = useState<AuthValue['notice']>(null);
  const [recovering, setRecovering] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Sign-outs the user asked for, so they are not mistaken for an expired session.
  const expectingSignOut = useRef(false);
  const signedIn = useRef(false);

  useEffect(() => {
    if (!(given instanceof Promise)) return;
    let active = true;
    given.then(
      (loaded) => active && setServices(loaded),
      () => {
        if (!active) return;
        setLoadError('Accounts could not be loaded. Your cards on this browser are unaffected.');
        setStatus('disabled');
      },
    );
    return () => {
      active = false;
    };
  }, [given]);

  useEffect(() => {
    if (!services) return;
    let active = true;
    const { auth } = services;

    const unsubscribe = auth.onChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (session) {
        signedIn.current = true;
        setUser(session.user);
        setStatus('signed-in');
        setOffline(false);
        setSessionExpired(false);
      } else if (event === 'SIGNED_OUT') {
        if (signedIn.current && !expectingSignOut.current) setSessionExpired(true);
        expectingSignOut.current = false;
        signedIn.current = false;
        setUser(null);
        setStatus('signed-out');
        setOffline(false);
        setRecovering(false);
      }
    });

    void (async () => {
      const outcome = await completeRedirectOnce(services);
      if (!active) return;
      if (outcome.kind === 'recovery') setRecovering(true);
      else if (outcome.kind === 'signed-in') {
        setNotice({
          tone: 'success',
          text: 'Your email address is confirmed. You are signed in.',
        });
      } else if (outcome.kind === 'error') setNotice({ tone: 'error', text: outcome.message });
      const { session, offline: noServer } = await auth.getSession();
      if (!active) return;
      signedIn.current = session !== null;
      setUser(session?.user ?? null);
      setOffline(noServer);
      setStatus(session ? 'signed-in' : 'signed-out');
    })();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [services]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!services) return authFailure('unknown');
      const result = await services.auth.signIn(email, password);
      if (result.ok) {
        setSessionExpired(false);
        const { session } = await services.auth.getSession();
        if (session) {
          signedIn.current = true;
          setUser(session.user);
          setStatus('signed-in');
        }
      }
      return result;
    },
    [services],
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      if (!services) return authFailure<{ needsConfirmation: boolean }>('unknown');
      const result = await services.auth.signUp(email, password);
      if (result.ok && !result.value.needsConfirmation) {
        const { session } = await services.auth.getSession();
        if (session) {
          signedIn.current = true;
          setUser(session.user);
          setStatus('signed-in');
        }
      }
      return result;
    },
    [services],
  );

  const signOut = useCallback(
    async (scope: 'local' | 'global' = 'local'): Promise<AuthResult> => {
      if (!services) return authFailure('unknown');
      expectingSignOut.current = true;
      const result = await services.auth.signOut(scope);
      // The session in this browser is gone either way.
      signedIn.current = false;
      setUser(null);
      setStatus('signed-out');
      setSessionExpired(false);
      setRecovering(false);
      return result;
    },
    [services],
  );

  const requestPasswordReset = useCallback(
    async (email: string) =>
      services ? services.auth.requestPasswordReset(email) : authFailure('unknown'),
    [services],
  );

  const updatePassword = useCallback(
    async (password: string, currentPassword?: string): Promise<AuthResult> => {
      if (!services) return authFailure('unknown');
      if (currentPassword !== undefined) {
        const proved = await services.auth.reauthenticate(currentPassword);
        if (!proved.ok) return proved;
      }
      const result = await services.auth.updatePassword(password);
      if (result.ok) setRecovering(false);
      return result;
    },
    [services],
  );

  const changeEmail = useCallback(
    async (email: string) => (services ? services.auth.changeEmail(email) : authFailure('unknown')),
    [services],
  );

  const deleteAccount = useCallback(
    async (password: string): Promise<AuthResult> => {
      if (!services) return authFailure('unknown');
      const proved = await services.auth.reauthenticate(password);
      if (!proved.ok) return proved;
      const deleted = await services.auth.deleteAccount();
      if (!deleted.ok) return deleted;
      // The account is gone; end the session this browser still holds.
      expectingSignOut.current = true;
      await services.auth.signOut('local');
      signedIn.current = false;
      setUser(null);
      setStatus('signed-out');
      return deleted;
    },
    [services],
  );

  const reportSessionProblem = useCallback(async (): Promise<boolean> => {
    if (!services) return false;
    if (await services.auth.refresh()) return true;
    // The session cannot be renewed: end it here, and say so.
    expectingSignOut.current = false;
    signedIn.current = false;
    await services.auth.signOut('local');
    setUser(null);
    setStatus('signed-out');
    setSessionExpired(true);
    return false;
  }, [services]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      offline,
      sessionExpired,
      configError: configError ?? loadError,
      notice,
      recovering,
      services,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      updatePassword,
      changeEmail,
      deleteAccount,
      reportSessionProblem,
      dismissNotice,
    }),
    [
      status,
      user,
      offline,
      sessionExpired,
      configError,
      loadError,
      notice,
      recovering,
      services,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      updatePassword,
      changeEmail,
      deleteAccount,
      reportSessionProblem,
      dismissNotice,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
