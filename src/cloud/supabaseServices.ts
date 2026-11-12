import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { SyncTransport } from '../sync/engine';
import type { PushChange } from '../sync/state';
import {
  authFailure,
  authMessage,
  classifyAuthError,
  type AuthChangeEvent,
  type AuthClient,
  type AuthResult,
  type AuthSession,
  type AuthUser,
  type RedirectOutcome,
} from './auth';
import type { CloudConfig } from './config';
import { classifyRpcFailure, parsePullPage, parsePushResults } from './syncProtocol';

/**
 * The real backend: Supabase Auth for accounts and the Postgres functions in
 * supabase/migrations for sync. Loaded on demand, so a build without cloud
 * settings never downloads the client library.
 */

export interface CloudServices {
  config: CloudConfig;
  auth: AuthClient;
  transport: SyncTransport;
}

/** Namespaced, because every project on abbas-4.github.io shares one localStorage. */
export const AUTH_STORAGE_KEY = 'snapnotes.auth.v1';

/** A request that has not answered in this long is treated as a lost connection. */
const REQUEST_TIMEOUT_MS = 30_000;

export interface SupabaseServicesOptions {
  /** Where the session is kept. Defaults to the browser's localStorage. */
  storage?: Storage | null;
  /** For tests in Node, where there is no page to refresh tokens for. */
  autoRefreshToken?: boolean;
  fetch?: typeof fetch;
}

export async function createSupabaseServices(
  config: CloudConfig,
  options: SupabaseServicesOptions = {},
): Promise<CloudServices> {
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(config.url, config.publishableKey, {
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      storage: options.storage ?? undefined,
      persistSession: true,
      autoRefreshToken: options.autoRefreshToken ?? true,
      // Email links are handled explicitly by `completeRedirect`, because the
      // app's own routes live in the URL hash.
      detectSessionInUrl: false,
      // A one-time code in the query string, exchanged by this browser only.
      flowType: 'pkce',
    },
    global: options.fetch ? { fetch: options.fetch } : undefined,
  });
  return {
    config,
    auth: new SupabaseAuthClient(client, config, options.storage ?? null),
    transport: new SupabaseSyncTransport(client),
  };
}

function toUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email ?? null,
    createdAt: user.created_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
    pendingEmail: user.new_email ?? null,
  };
}

function toSession(session: Session): AuthSession {
  return { user: toUser(session.user), expiresAt: session.expires_at ?? null };
}

function fail<T = void>(error: unknown): AuthResult<T> {
  return authFailure<T>(classifyAuthError(error));
}

const OK: AuthResult = { ok: true, value: undefined };

const EVENTS = new Set<AuthChangeEvent>([
  'INITIAL_SESSION',
  'SIGNED_IN',
  'SIGNED_OUT',
  'TOKEN_REFRESHED',
  'USER_UPDATED',
  'PASSWORD_RECOVERY',
]);

class SupabaseAuthClient implements AuthClient {
  private readonly client: SupabaseClient;
  private readonly config: CloudConfig;
  private readonly storage: Storage | null;

  constructor(client: SupabaseClient, config: CloudConfig, storage: Storage | null) {
    this.client = client;
    this.config = config;
    this.storage = storage;
  }

  private link(route: string): string {
    return `${this.config.appUrl}#${route}`;
  }

  /** The user saved with the session, read without the network. */
  private storedUser(): AuthUser | null {
    try {
      const store = this.storage ?? (typeof window === 'undefined' ? null : window.localStorage);
      const raw = store?.getItem(AUTH_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { user?: User };
      return parsed.user?.id ? toUser(parsed.user) : null;
    } catch {
      return null;
    }
  }

  async getSession() {
    const { data, error } = await this.client.auth.getSession();
    if (data.session) return { session: toSession(data.session), offline: false };
    if (error && classifyAuthError(error) === 'network') {
      const user = this.storedUser();
      return { session: user ? { user, expiresAt: null } : null, offline: user !== null };
    }
    return { session: null, offline: false };
  }

  onChange(listener: (event: AuthChangeEvent, session: AuthSession | null) => void) {
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      if (EVENTS.has(event as AuthChangeEvent)) {
        listener(event as AuthChangeEvent, session ? toSession(session) : null);
      }
    });
    return () => data.subscription.unsubscribe();
  }

  async signUp(email: string, password: string) {
    const { data, error } = await this.client.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: this.link('/account') },
    });
    if (error) return fail<{ needsConfirmation: boolean }>(error);
    // With email confirmation on, there is no session until the link is
    // followed. (For an address already registered the server answers the
    // same way, so this screen never reveals who has an account.)
    return { ok: true as const, value: { needsConfirmation: data.session === null } };
  }

  async signIn(email: string, password: string) {
    const { error } = await this.client.auth.signInWithPassword({ email: email.trim(), password });
    return error ? fail(error) : OK;
  }

  async signOut(scope: 'local' | 'global') {
    const { error } = await this.client.auth.signOut({ scope });
    if (!error) return OK;
    // Offline, this browser's session is still removed; only the server could
    // not be told. For this browser alone, that is a successful sign-out.
    if (scope === 'local' && classifyAuthError(error) === 'network') return OK;
    return fail(error);
  }

  async requestPasswordReset(email: string) {
    const { error } = await this.client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: this.link('/account/reset-password'),
    });
    return error ? fail(error) : OK;
  }

  async updatePassword(password: string) {
    const { error } = await this.client.auth.updateUser({ password });
    return error ? fail(error) : OK;
  }

  async changeEmail(email: string) {
    const { error } = await this.client.auth.updateUser(
      { email: email.trim() },
      { emailRedirectTo: this.link('/account') },
    );
    return error ? fail(error) : OK;
  }

  async reauthenticate(password: string) {
    const { data } = await this.client.auth.getSession();
    const email = data.session?.user.email;
    if (!email) return authFailure('session-expired');
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (!error) return OK;
    const code = classifyAuthError(error);
    return code === 'invalid-credentials'
      ? { ok: false as const, code, message: 'That password is not correct.' }
      : authFailure(code);
  }

  async completeRedirect(search: string): Promise<RedirectOutcome> {
    const params = new URLSearchParams(search);
    const errorCode = params.get('error_code');
    if (params.get('error') || errorCode) {
      return {
        kind: 'error',
        message:
          errorCode === 'otp_expired'
            ? authMessage('link-expired')
            : 'That link could not be used. Request a new one.',
      };
    }
    const code = params.get('code');
    if (!code) return { kind: 'none' };

    let recovery = false;
    const { data: listener } = this.client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') recovery = true;
    });
    try {
      const { error } = await this.client.auth.exchangeCodeForSession(code);
      if (error) return { kind: 'error', message: authMessage(classifyAuthError(error)) };
      return recovery ? { kind: 'recovery' } : { kind: 'signed-in' };
    } finally {
      listener.subscription.unsubscribe();
    }
  }

  async refresh() {
    const { data, error } = await this.client.auth.refreshSession();
    return !error && data.session !== null;
  }

  async deleteAccount() {
    const { error, status } = await this.client
      .rpc('delete_account')
      .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
    if (!error) return OK;
    if (error.hint === 'reauthentication-required') return authFailure('reauthentication-required');
    if (status === 0) return authFailure('network');
    if (status === 401 || error.code === '28000') return authFailure('session-expired');
    return authFailure('unknown');
  }
}

class SupabaseSyncTransport implements SyncTransport {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async pull(since: number) {
    const { data, error, status } = await this.client
      .rpc('sync_pull', { since, max_rows: 500 })
      .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
    if (error) throw classifyRpcFailure({ status, code: error.code, message: error.message });
    return parsePullPage(data);
  }

  async push(changes: readonly PushChange[]) {
    const { data, error, status } = await this.client
      .rpc('sync_push', { changes })
      .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
    if (error) throw classifyRpcFailure({ status, code: error.code, message: error.message });
    return parsePushResults(data);
  }
}
