import { createContext, useContext } from 'react';
import type { AuthResult, AuthUser } from '../../cloud/auth';
import type { CloudServices } from '../../cloud/supabaseServices';
import type { SyncErrorKind } from '../../sync/engine';
import type { LinkChoice, LinkReport } from '../../sync/link';
import type { SyncConflict, RejectedChange } from '../../sync/state';
import type { Timestamp } from '../../domain/types';
import type { WriteResult } from '../appData';

/** Accounts: who is signed in, and what can be done about it. */
export interface AuthValue {
  /** `disabled`: this build has no cloud settings, and the app is local-only. */
  status: 'disabled' | 'loading' | 'signed-out' | 'signed-in';
  user: AuthUser | null;
  /** Signed in, but the server could not be reached to confirm the session. */
  offline: boolean;
  /** The session ended without the user signing out (expired or revoked elsewhere). */
  sessionExpired: boolean;
  /** Set when this build's cloud settings are wrong, for the account page to explain. */
  configError: string | null;
  /** Something an email link did, to tell the user about once. */
  notice: { tone: 'success' | 'error'; text: string } | null;
  /** True after following a password reset link, until a new password is set. */
  recovering: boolean;
  services: CloudServices | null;
  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(email: string, password: string): Promise<AuthResult<{ needsConfirmation: boolean }>>;
  signOut(scope?: 'local' | 'global'): Promise<AuthResult>;
  requestPasswordReset(email: string): Promise<AuthResult>;
  /** Sets a new password. Outside a reset link, the current password must be proved first. */
  updatePassword(password: string, currentPassword?: string): Promise<AuthResult>;
  changeEmail(email: string): Promise<AuthResult>;
  /** Deletes the account after proving the password. Sync is told to forget it. */
  deleteAccount(password: string): Promise<AuthResult>;
  /**
   * Called by sync when the server refuses the session. Renews it if it can
   * (true); otherwise ends it and tells the user to sign in again (false).
   */
  reportSessionProblem(): Promise<boolean>;
  dismissNotice(): void;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <CloudProvider>');
  return value;
}

/** Where this browser stands with its account. */
export type SyncStatus =
  | 'disabled'
  | 'signed-out'
  | 'session-expired'
  /** Signed in, and finding out whether this browser's data needs to be joined to the account. */
  | 'checking'
  /** The user must choose how to join this browser's data to the account. */
  | 'needs-link'
  | 'linking'
  | 'offline'
  | 'syncing'
  | 'error'
  /** Changes are waiting and will be uploaded shortly. */
  | 'pending'
  | 'synced';

export type LinkState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | {
      kind: 'needed';
      local: { decks: number; cards: number };
      cloud: { decks: number; cards: number };
      /** The other account this browser was last synced with, if any. */
      previousAccount: string | null;
      /** Changes for that other account that never reached it. */
      previousPending: number;
    }
  | { kind: 'linking' }
  | { kind: 'error'; message: string };

export interface SyncValue {
  status: SyncStatus;
  online: boolean;
  /** Changes on this device the server has not confirmed. */
  pending: number;
  lastSyncedAt: Timestamp | null;
  error: { kind: SyncErrorKind | 'unknown'; message: string; at: Timestamp } | null;
  /** When the next automatic attempt is due after a failure. */
  retryAt: Timestamp | null;
  link: LinkState;
  /** What the last link did, until dismissed. */
  linkReport: LinkReport | null;
  conflicts: readonly SyncConflict[];
  rejected: readonly RejectedChange[];
  syncNow(): void;
  linkWith(choice: LinkChoice): Promise<WriteResult>;
  dismissLinkReport(): void;
  /** Makes the version a conflict set aside the current one. */
  restoreConflict(id: string): WriteResult;
  dismissConflict(id: string): void;
  /** Removes every card, deck and review from this browser and forgets the account link. */
  forgetThisBrowser(): WriteResult;
  /** Forgets the account link, keeping this browser's data as a local-only collection. */
  unlink(): void;
}

export const SyncContext = createContext<SyncValue | null>(null);

export function useSync(): SyncValue {
  const value = useContext(SyncContext);
  if (!value) throw new Error('useSync must be used inside <CloudProvider>');
  return value;
}

/** For components that only show sync when it exists (the header, the home page). */
export function useOptionalSync(): SyncValue | null {
  return useContext(SyncContext);
}

export function useOptionalAuth(): AuthValue | null {
  return useContext(AuthContext);
}
