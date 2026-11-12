import type { MouseEvent, ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { useOptionalAuth, useOptionalSync, type SyncStatus } from './cloud';
import { syncStatusLabel } from './syncText';

const DOT: Partial<Record<SyncStatus, string>> = {
  synced: 'bg-green-600',
  syncing: 'bg-indigo-500 animate-pulse motion-reduce:animate-none',
  pending: 'bg-indigo-400',
  offline: 'bg-gray-400',
  error: 'bg-red-600',
  'needs-link': 'bg-amber-500',
  linking: 'bg-indigo-500 animate-pulse motion-reduce:animate-none',
  checking: 'bg-gray-300',
  'session-expired': 'bg-amber-500',
};

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
    isActive
      ? 'bg-indigo-100 text-indigo-900'
      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
  }`;

/**
 * The account entry in the navigation, as a list item. Signed out it says "Sign in"; signed
 * in it shows how sync stands, with a coloured dot backed by words, so the
 * state never depends on colour alone. Hidden when the build has no accounts.
 */
export function AccountNavLink({ onClick }: { onClick(event: MouseEvent): void }) {
  const auth = useOptionalAuth();
  const sync = useOptionalSync();
  if (!auth || !sync || auth.status === 'disabled') return null;

  if (auth.status !== 'signed-in') {
    return (
      <li>
        <NavLink to="/account" onClick={onClick} className={navLinkClass}>
          {auth.status === 'loading' ? 'Account' : 'Sign in'}
          {auth.sessionExpired && (
            <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
          )}
        </NavLink>
      </li>
    );
  }

  const label = syncStatusLabel(sync.status, sync.pending);
  return (
    <li>
      <NavLink
        to="/account"
        onClick={onClick}
        className={navLinkClass}
        aria-label={`Account: ${label}`}
        title={label}
      >
        <span
          className={`h-2 w-2 rounded-full ${DOT[sync.status] ?? 'bg-gray-300'}`}
          aria-hidden="true"
        />
        Account
      </NavLink>
    </li>
  );
}

/**
 * A line under the header for the few sync states that need the user: a
 * session that ended, or a browser waiting to be joined to the account.
 * Ordinary states (offline, syncing, pending) stay in the navigation and on
 * the account page, so studying is never interrupted by them.
 */
export function SyncBanner() {
  const auth = useOptionalAuth();
  const sync = useOptionalSync();
  if (!auth || !sync) return null;

  let content: ReactNode = null;
  if (sync.status === 'session-expired') {
    content = (
      <>
        Your session ended, so syncing has stopped. Your cards are safe on this browser.{' '}
        <Link to="/account/sign-in" className="font-semibold underline">
          Sign in again
        </Link>
      </>
    );
  } else if (sync.status === 'needs-link') {
    content = (
      <>
        This browser&rsquo;s cards are not syncing yet.{' '}
        <Link to="/account/link" className="font-semibold underline">
          Choose how to combine them with your account
        </Link>
      </>
    );
  }
  if (!content) return null;

  return (
    <p
      role="status"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900"
    >
      {content}
    </p>
  );
}
