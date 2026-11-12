import {
  authFailure,
  passwordProblem,
  type AuthChangeEvent,
  type AuthClient,
  type AuthResult,
  type AuthSession,
  type RedirectOutcome,
} from '../cloud/auth';
import type { CloudServices } from '../cloud/supabaseServices';
import type { CloudSetup } from '../ui/account/cloudSetup';
import { FakeSyncServer } from './fakeSyncServer';

/**
 * An in-memory account service for UI tests. It follows the same rules the
 * real one is tested against in auth.integration.test.ts (password rule,
 * duplicate emails, same answer for a wrong password and an unknown email).
 */
export class FakeAuth implements AuthClient {
  private users = new Map<string, { id: string; password: string; createdAt: string }>();
  session: AuthSession | null = null;
  private listeners = new Set<(event: AuthChangeEvent, session: AuthSession | null) => void>();
  /** The next calls fail as if offline. */
  offline = false;
  /** Sign-ups wait for an emailed confirmation instead of signing in. */
  needsConfirmation = false;
  /** Whether the session can still be renewed. */
  canRefresh = true;
  /** Proof of a recent sign-in, required to delete the account. */
  private recentSignIn = false;
  resetRequests: string[] = [];
  redirect: RedirectOutcome = { kind: 'none' };
  calls: string[] = [];

  addUser(email: string, password: string, id = `user-${this.users.size + 1}`) {
    this.users.set(email, { id, password, createdAt: '2026-11-01T10:00:00Z' });
    return id;
  }

  /** Starts the app already signed in, as after a reload. */
  signInAs(email: string) {
    const user = this.users.get(email);
    if (!user) throw new Error(`no user ${email}`);
    this.session = this.toSession(email);
  }

  private toSession(email: string): AuthSession {
    const user = this.users.get(email)!;
    return {
      user: {
        id: user.id,
        email,
        createdAt: user.createdAt,
        lastSignInAt: null,
        pendingEmail: null,
      },
      expiresAt: null,
    };
  }

  private emit(event: AuthChangeEvent) {
    for (const listener of this.listeners) listener(event, this.session);
  }

  private async network<T>(work: () => T): Promise<T | AuthResult<never>> {
    await Promise.resolve();
    if (this.offline) return authFailure<never>('network');
    return work();
  }

  async getSession() {
    await Promise.resolve();
    return { session: this.session, offline: this.offline && this.session !== null };
  }

  onChange(listener: (event: AuthChangeEvent, session: AuthSession | null) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async signUp(email: string, password: string) {
    this.calls.push('signUp');
    return this.network((): AuthResult<{ needsConfirmation: boolean }> => {
      if (passwordProblem(password)) return authFailure('weak-password');
      if (this.users.has(email)) return authFailure('email-taken');
      this.addUser(email, password);
      if (this.needsConfirmation) return { ok: true, value: { needsConfirmation: true } };
      this.session = this.toSession(email);
      this.recentSignIn = true;
      this.emit('SIGNED_IN');
      return { ok: true, value: { needsConfirmation: false } };
    });
  }

  async signIn(email: string, password: string) {
    this.calls.push('signIn');
    return this.network((): AuthResult => {
      const user = this.users.get(email.trim());
      if (!user || user.password !== password) return authFailure('invalid-credentials');
      this.session = this.toSession(email.trim());
      this.recentSignIn = true;
      this.emit('SIGNED_IN');
      return { ok: true, value: undefined };
    });
  }

  async signOut(scope: 'local' | 'global') {
    this.calls.push(`signOut:${scope}`);
    await Promise.resolve();
    this.session = null;
    this.recentSignIn = false;
    this.emit('SIGNED_OUT');
    return { ok: true as const, value: undefined };
  }

  async requestPasswordReset(email: string) {
    return this.network((): AuthResult => {
      this.resetRequests.push(email);
      return { ok: true, value: undefined };
    });
  }

  async updatePassword(password: string) {
    return this.network((): AuthResult => {
      if (!this.session) return authFailure('session-expired');
      if (passwordProblem(password)) return authFailure('weak-password');
      const email = this.session.user.email!;
      this.users.get(email)!.password = password;
      return { ok: true, value: undefined };
    });
  }

  async changeEmail() {
    return this.network((): AuthResult => ({ ok: true, value: undefined }));
  }

  async reauthenticate(password: string) {
    return this.network((): AuthResult => {
      const email = this.session?.user.email;
      if (!email) return authFailure('session-expired');
      if (this.users.get(email)?.password !== password) {
        return { ok: false, code: 'invalid-credentials', message: 'That password is not correct.' };
      }
      this.recentSignIn = true;
      return { ok: true, value: undefined };
    });
  }

  async completeRedirect() {
    await Promise.resolve();
    return this.redirect;
  }

  async refresh() {
    await Promise.resolve();
    return this.canRefresh && this.session !== null;
  }

  async deleteAccount() {
    this.calls.push('deleteAccount');
    return this.network((): AuthResult => {
      if (!this.session) return authFailure('session-expired');
      if (!this.recentSignIn) return authFailure('reauthentication-required');
      this.users.delete(this.session.user.email!);
      return { ok: true, value: undefined };
    });
  }
}

export interface FakeCloud {
  auth: FakeAuth;
  server: FakeSyncServer;
  services: CloudServices;
  setup: CloudSetup;
}

export function fakeCloud(): FakeCloud {
  const auth = new FakeAuth();
  const server = new FakeSyncServer();
  const services: CloudServices = {
    config: {
      url: 'https://example.test',
      publishableKey: 'test',
      appUrl: 'https://example.test/',
    },
    auth,
    transport: server.transport(),
  };
  return { auth, server, services, setup: { services, error: null } };
}
