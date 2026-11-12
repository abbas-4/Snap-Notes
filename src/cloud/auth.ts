/**
 * What the app needs from an authentication service, independent of the
 * provider behind it. `supabaseServices.ts` implements it with Supabase Auth.
 *
 * Passwords are only ever sent to the auth server over HTTPS; it stores them
 * hashed (bcrypt) and never returns them. The app keeps a short-lived access
 * token (an hour) and a refresh token that rotates on every use, under one
 * namespaced localStorage key, and the server checks the token's signature on
 * every request. Nothing the browser sends can choose which account's data it
 * touches: the server takes that from the verified token.
 */

export interface AuthUser {
  id: string;
  email: string | null;
  /** ISO dates, as the server reports them. */
  createdAt: string | null;
  lastSignInAt: string | null;
  /** A change of email waiting to be confirmed. */
  pendingEmail: string | null;
}

export interface AuthSession {
  user: AuthUser;
  /** When the access token expires, in seconds since the epoch. */
  expiresAt: number | null;
}

export type AuthErrorCode =
  | 'invalid-credentials'
  | 'email-not-confirmed'
  | 'email-taken'
  | 'weak-password'
  | 'same-password'
  | 'invalid-email'
  | 'rate-limited'
  | 'signups-disabled'
  | 'session-expired'
  | 'link-expired'
  | 'reauthentication-required'
  | 'network'
  | 'unknown';

export type AuthResult<T = void> =
  { ok: true; value: T } | { ok: false; code: AuthErrorCode; message: string };

export type AuthChangeEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY';

/** What returning from an email link did. */
export type RedirectOutcome =
  | { kind: 'none' }
  | { kind: 'signed-in' }
  | { kind: 'recovery' }
  | { kind: 'error'; message: string };

export interface AuthClient {
  /**
   * The session saved in this browser. When the server cannot be reached to
   * refresh it, the saved user is still returned with `offline: true`, so the
   * app can keep showing who is signed in and sync once the connection is back.
   */
  getSession(): Promise<{ session: AuthSession | null; offline: boolean }>;
  onChange(listener: (event: AuthChangeEvent, session: AuthSession | null) => void): () => void;
  signUp(email: string, password: string): Promise<AuthResult<{ needsConfirmation: boolean }>>;
  signIn(email: string, password: string): Promise<AuthResult>;
  /** `local` ends this browser's session; `global` ends every session of the account. */
  signOut(scope: 'local' | 'global'): Promise<AuthResult>;
  requestPasswordReset(email: string): Promise<AuthResult>;
  updatePassword(password: string): Promise<AuthResult>;
  changeEmail(email: string): Promise<AuthResult>;
  /** Signs in again with the current email, proving the password before a sensitive change. */
  reauthenticate(password: string): Promise<AuthResult>;
  /** Exchanges the one-time code an email link brings back for a session. */
  completeRedirect(search: string): Promise<RedirectOutcome>;
  /** Asks for a new access token; false when the session can no longer be renewed. */
  refresh(): Promise<boolean>;
  /** Deletes the account and all its cloud data. Needs a sign-in in the last ten minutes. */
  deleteAccount(): Promise<AuthResult>;
}

export const PASSWORD_MIN_LENGTH = 8;

/** The same rule the auth server enforces (`supabase/config.toml`): 8+ characters, letters and digits. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) {
    return 'Use both letters and numbers.';
  }
  return null;
}

/** A light check; the server has the final say on whether an address is valid. */
export function emailProblem(email: string): string | null {
  const trimmed = email.trim();
  if (trimmed === '') return 'Enter your email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'Enter a valid email address.';
  return null;
}

const MESSAGES: Record<AuthErrorCode, string> = {
  'invalid-credentials': 'That email and password do not match an account.',
  'email-not-confirmed':
    'Confirm your email address first, using the link we sent you. Then sign in.',
  'email-taken': 'An account with this email address already exists. Sign in instead.',
  'weak-password': 'Choose a stronger password: at least 8 characters, with letters and numbers.',
  'same-password': 'Choose a password different from your current one.',
  'invalid-email': 'Enter a valid email address.',
  'rate-limited': 'Too many attempts. Wait a minute, then try again.',
  'signups-disabled': 'New accounts cannot be created right now.',
  'session-expired': 'Your session has ended. Sign in again to continue.',
  'link-expired':
    'This link has expired or was already used. Links work once, in the browser that asked for them. Request a new one.',
  'reauthentication-required': 'For your security, enter your password again.',
  network: 'Snap Notes could not reach the server. Check your connection and try again.',
  unknown: 'Something went wrong. Please try again.',
};

export function authMessage(code: AuthErrorCode): string {
  return MESSAGES[code];
}

export function authFailure<T = void>(code: AuthErrorCode): AuthResult<T> {
  return { ok: false, code, message: MESSAGES[code] };
}

const CODE_MAP: Record<string, AuthErrorCode> = {
  invalid_credentials: 'invalid-credentials',
  email_not_confirmed: 'email-not-confirmed',
  user_already_exists: 'email-taken',
  email_exists: 'email-taken',
  weak_password: 'weak-password',
  same_password: 'same-password',
  email_address_invalid: 'invalid-email',
  validation_failed: 'invalid-email',
  over_email_send_rate_limit: 'rate-limited',
  over_request_rate_limit: 'rate-limited',
  signup_disabled: 'signups-disabled',
  email_provider_disabled: 'signups-disabled',
  session_expired: 'session-expired',
  session_not_found: 'session-expired',
  refresh_token_not_found: 'session-expired',
  refresh_token_already_used: 'session-expired',
  bad_jwt: 'session-expired',
  user_not_found: 'session-expired',
  flow_state_expired: 'link-expired',
  flow_state_not_found: 'link-expired',
  bad_code_verifier: 'link-expired',
  otp_expired: 'link-expired',
  reauthentication_needed: 'reauthentication-required',
};

/**
 * Turns a provider error into a code and a message written for the user.
 * The provider's own message is never shown: it can be technical, and
 * account-specific wording could reveal whether an address is registered.
 */
export function classifyAuthError(error: unknown): AuthErrorCode {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const { code, name, status, message } = error as {
    code?: unknown;
    name?: unknown;
    status?: unknown;
    message?: unknown;
  };
  if (typeof code === 'string' && CODE_MAP[code]) return CODE_MAP[code];
  if (name === 'AuthRetryableFetchError' || status === 0) return 'network';
  if (name === 'AuthWeakPasswordError') return 'weak-password';
  if (name === 'AuthSessionMissingError') return 'session-expired';
  if (name === 'AuthPKCECodeVerifierMissingError' || name === 'AuthPKCEGrantCodeExchangeError') {
    return 'link-expired';
  }
  if (status === 429) return 'rate-limited';
  if (typeof message === 'string' && /fetch|network/i.test(message)) return 'network';
  return 'unknown';
}
