import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { emailProblem, passwordProblem, PASSWORD_MIN_LENGTH } from '../../cloud/auth';
import type { Card, Deck } from '../../domain/types';
import { useAppData } from '../appData';
import { useNow } from '../useNow';
import { dangerButton, primaryButton, secondaryButton, textField } from '../styles';
import { AccountsUnavailable } from './AuthPages';
import { useAuth, useSync } from './cloud';
import Notice from './Notice';
import PasswordField from './PasswordField';
import { changesLabel, describeSyncTime, syncStatusLabel } from './syncText';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        {children}
      </div>
    </section>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'Unknown'
    : date.toLocaleDateString(undefined, { dateStyle: 'long' });
}

/** The account hub: sign in or out, see and run sync, and manage the account. */
export default function AccountPage() {
  const auth = useAuth();
  const location = useLocation();
  const flash = (location.state as { flash?: string } | null)?.flash ?? null;

  if (auth.status === 'disabled') return <AccountsUnavailable />;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Account</h1>
      {flash && (
        <Notice tone="success" role="status" className="mt-4">
          {flash}
        </Notice>
      )}
      {auth.notice && (
        <Notice
          tone={auth.notice.tone}
          role={auth.notice.tone === 'error' ? 'alert' : 'status'}
          className="mt-4"
        >
          <span>{auth.notice.text}</span>{' '}
          <button type="button" className="underline" onClick={auth.dismissNotice}>
            Dismiss
          </button>
        </Notice>
      )}
      {auth.status === 'loading' ? (
        <p className="mt-4 text-gray-600" role="status">
          Checking your account…
        </p>
      ) : auth.status === 'signed-out' ? (
        <SignedOut />
      ) : (
        <SignedIn />
      )}
    </div>
  );
}

function SignedOut() {
  const auth = useAuth();
  const sync = useSync();
  return (
    <>
      {auth.sessionExpired && (
        <Notice tone="warning" role="status" className="mt-4">
          Your session ended, so syncing has stopped. Everything on this browser is safe
          {sync.pending > 0
            ? `, including ${changesLabel(sync.pending)} that will sync when you sign in again`
            : ''}
          .
        </Notice>
      )}
      <p className="mt-4 text-gray-700">
        With an account, your cards, decks and learning progress are kept in step on every device
        you sign in on, and you can get them back if this browser is cleared.
      </p>
      <p className="mt-2 text-gray-700">
        Snap Notes works without one: everything is saved in this browser, and studying never needs
        a connection.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link to="/account/sign-in" className={primaryButton}>
          Sign in
        </Link>
        <Link to="/account/sign-up" className={secondaryButton}>
          Create an account
        </Link>
      </div>
    </>
  );
}

function SignedIn() {
  const { user, offline } = useAuth();
  if (!user) return null;
  return (
    <>
      <Section id="account-details" title="Your account">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-600">Email address</dt>
            <dd className="font-semibold break-all">{user.email ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt className="text-gray-600">Member since</dt>
            <dd className="font-semibold">{formatDate(user.createdAt)}</dd>
          </div>
        </dl>
        {user.pendingEmail && (
          <p className="mt-3 text-sm text-gray-600">
            Waiting for you to confirm your new address, {user.pendingEmail}.
          </p>
        )}
        {offline && (
          <p className="mt-3 text-sm text-gray-600">
            Snap Notes could not reach the server to check your session. It will try again when you
            are back online.
          </p>
        )}
      </Section>
      <SyncSection />
      <SignOutSection />
      <PasswordSection />
      <EmailSection />
      <DeleteAccountSection />
    </>
  );
}

function SyncSection() {
  const sync = useSync();
  const now = useNow(true, 30_000);
  const busy = sync.status === 'syncing' || sync.status === 'linking' || sync.status === 'checking';

  return (
    <Section id="account-sync" title="Sync">
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-gray-600">Status</dt>
          <dd className="font-semibold" aria-live="polite">
            {syncStatusLabel(sync.status, sync.pending)}
          </dd>
        </div>
        <div>
          <dt className="text-gray-600">Last synced</dt>
          <dd className="font-semibold">{describeSyncTime(sync.lastSyncedAt, now)}</dd>
        </div>
        <div>
          <dt className="text-gray-600">Waiting to upload</dt>
          <dd className="font-semibold">
            {sync.pending === 0 ? 'Nothing' : changesLabel(sync.pending)}
          </dd>
        </div>
      </dl>

      {sync.status === 'needs-link' && (
        <Notice tone="info" className="mt-4">
          This browser has cards of its own.{' '}
          <Link to="/account/link" className="font-semibold underline">
            Choose how to combine them with your account
          </Link>{' '}
          to start syncing.
        </Notice>
      )}
      {!sync.online && (
        <p className="mt-4 text-sm text-gray-600">
          You are offline. Keep studying: changes are saved on this browser and sync when you are
          back online.
        </p>
      )}
      {sync.error && (
        <Notice tone="error" role="alert" className="mt-4">
          <p>{sync.error.message}</p>
          {sync.retryAt && (
            <p className="mt-1">Snap Notes will try again {describeRetry(sync.retryAt, now)}.</p>
          )}
        </Notice>
      )}
      {sync.link.kind === 'error' && (
        <Notice tone="error" role="alert" className="mt-4">
          <p>Sync could not be set up: {sync.link.message}</p>
          {sync.retryAt && (
            <p className="mt-1">Snap Notes will try again {describeRetry(sync.retryAt, now)}.</p>
          )}
        </Notice>
      )}
      {sync.linkReport && <LinkReportNotice />}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className={primaryButton}
          onClick={sync.syncNow}
          disabled={busy || !sync.online || sync.status === 'needs-link'}
        >
          {busy ? 'Syncing…' : sync.error || sync.link.kind === 'error' ? 'Try again' : 'Sync now'}
        </button>
      </div>
      <p className="mt-3 text-sm text-gray-600">
        Sync runs on its own a moment after each change, when you come back online, and every minute
        while Snap Notes is open.
      </p>

      {sync.rejected.length > 0 && <RejectedList />}
      {sync.conflicts.length > 0 && <ConflictList />}
    </Section>
  );
}

function describeRetry(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((at - now) / 1000));
  if (seconds < 60) return 'in under a minute';
  const minutes = Math.round(seconds / 60);
  return `in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

function LinkReportNotice() {
  const { linkReport, dismissLinkReport } = useSync();
  if (!linkReport) return null;
  const parts: string[] = [];
  if (linkReport.cardsUploaded > 0)
    parts.push(`${linkReport.cardsUploaded} cards from this browser added to your account`);
  if (linkReport.cardsDownloaded > 0)
    parts.push(`${linkReport.cardsDownloaded} cards from your account added to this browser`);
  if (linkReport.duplicateCards > 0)
    parts.push(`${linkReport.duplicateCards} cards found on both and kept once`);
  if (linkReport.duplicateDecks > 0)
    parts.push(`${linkReport.duplicateDecks} decks with the same name joined`);
  return (
    <Notice tone="success" role="status" className="mt-4">
      <p>
        This browser is now linked to your account
        {parts.length > 0 ? `: ${parts.join('; ')}.` : '.'}
      </p>
      {linkReport.conflicts > 0 && (
        <p className="mt-1">
          Some cards differed between the two. They are listed below so you can choose.
        </p>
      )}
      <button type="button" className="mt-1 underline" onClick={dismissLinkReport}>
        Dismiss
      </button>
    </Notice>
  );
}

function RejectedList() {
  const { rejected } = useSync();
  return (
    <div className="mt-6">
      <h3 className="font-semibold">Not synced</h3>
      <p className="mt-1 text-sm text-gray-600">
        The server refused these changes. They are safe on this browser, and will be sent again once
        they are edited.
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {rejected.map((item) => (
          <li key={`${item.kind}:${item.id}`} className="rounded-lg bg-gray-50 px-3 py-2">
            {item.kind === 'card' ? (
              <Link to={`/edit/${item.id}`} className="text-indigo-700 underline">
                A card
              </Link>
            ) : (
              <span>A {item.kind === 'history' ? 'day of review history' : item.kind}</span>
            )}
            : {item.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

const CONFLICT_TEXT = {
  'both-changed': 'was changed on two devices. The most recent change is in use.',
  'deleted-here': 'was deleted here but changed on another device, so it was kept.',
  'deleted-elsewhere': 'was deleted on another device but changed here, so it was kept.',
  linked: 'was different in this browser and in your account. The most recent version is in use.',
} as const;

function describeRecord(record: Card | Deck | null): string {
  if (!record) return '';
  return 'term' in record ? `“${record.term || record.definition}”` : `“${record.name}”`;
}

function ConflictList() {
  const { conflicts, restoreConflict, dismissConflict } = useSync();
  const { data } = useAppData();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-6">
      <h3 className="font-semibold">Changes to review</h3>
      <p className="mt-1 text-sm text-gray-600">
        When the same card or deck was changed in two places, nothing was thrown away. Check these,
        and switch to the other version if it was the one you wanted.
      </p>
      {error && (
        <Notice tone="error" role="alert" className="mt-2">
          {error}
        </Notice>
      )}
      <ul className="mt-2 space-y-2">
        {conflicts.map((conflict) => {
          const current =
            conflict.kind === 'card'
              ? data.cards.find((c) => c.id === conflict.recordId)
              : data.decks.find((d) => d.id === conflict.recordId);
          const name = describeRecord(current ?? conflict.kept);
          return (
            <li key={conflict.id} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <p>
                The {conflict.kind} {name} {CONFLICT_TEXT[conflict.reason]}
              </p>
              {conflict.other && (
                <p className="mt-1 text-gray-600">
                  Other version: {describeRecord(conflict.other)}
                  {'term' in conflict.other && conflict.other.definition
                    ? ` — ${conflict.other.definition}`
                    : ''}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {(conflict.other || conflict.kind === 'card') && (
                  <button
                    type="button"
                    className={`${secondaryButton} px-3 py-1.5`}
                    onClick={() => {
                      const result = restoreConflict(conflict.id);
                      setError(result.ok ? null : result.message);
                    }}
                  >
                    {conflict.other ? 'Use the other version' : 'Delete it'}
                  </button>
                )}
                <button
                  type="button"
                  className={`${secondaryButton} px-3 py-1.5`}
                  onClick={() => dismissConflict(conflict.id)}
                >
                  Keep as it is
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SignOutSection() {
  const auth = useAuth();
  const sync = useSync();
  const navigate = useNavigate();
  const [removeData, setRemoveData] = useState(false);
  const [busy, setBusy] = useState<'local' | 'global' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signOut(scope: 'local' | 'global') {
    setBusy(scope);
    setError(null);
    const result = await auth.signOut(scope);
    setBusy(null);
    if (removeData) {
      const removed = sync.forgetThisBrowser();
      if (!removed.ok)
        setError(`Signed out, but the data could not be removed: ${removed.message}`);
    }
    if (!result.ok && scope === 'global') {
      setError(
        `Signed out on this browser, but other devices could not be signed out: ${result.message}`,
      );
      return;
    }
    navigate('/account', {
      replace: true,
      state: {
        flash: removeData
          ? 'You are signed out, and your cards have been removed from this browser.'
          : 'You are signed out. Your cards stay on this browser.',
      },
    });
  }

  return (
    <Section id="account-sign-out" title="Sign out">
      {error && (
        <Notice tone="error" role="alert" className="mb-3">
          {error}
        </Notice>
      )}
      <p className="text-sm text-gray-600">
        Your cards and progress stay on this browser after you sign out, and keep working offline.
        Signing in again carries on syncing.
      </p>
      {sync.pending > 0 && (
        <Notice tone="warning" className="mt-3">
          {changesLabel(sync.pending)} on this browser {sync.pending === 1 ? 'has' : 'have'} not
          synced yet.{' '}
          {removeData
            ? `Removing your data now would lose ${sync.pending === 1 ? 'it' : 'them'}.`
            : `${sync.pending === 1 ? 'It' : 'They'} will sync when you sign in again.`}
        </Notice>
      )}
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={removeData}
          onChange={(event) => setRemoveData(event.target.checked)}
        />
        <span>
          Also remove my cards, decks and progress from this browser (for a shared or public
          computer). Your account keeps its copy.
        </span>
      </label>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className={secondaryButton}
          disabled={busy !== null}
          onClick={() => void signOut('local')}
        >
          {busy === 'local' ? 'Signing out…' : 'Sign out'}
        </button>
        <button
          type="button"
          className={secondaryButton}
          disabled={busy !== null}
          onClick={() => void signOut('global')}
        >
          {busy === 'global' ? 'Signing out…' : 'Sign out on every device'}
        </button>
      </div>
    </Section>
  );
}

function PasswordSection() {
  const auth = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = {
      current: current === '' ? 'Enter your current password.' : undefined,
      next: passwordProblem(next) ?? undefined,
    };
    setErrors(found);
    setDone(false);
    if (found.current || found.next) return;
    setBusy(true);
    setError(null);
    const result = await auth.updatePassword(next, current);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setCurrent('');
    setNext('');
    setDone(true);
  }

  return (
    <Section id="account-password-heading" title="Password">
      <form onSubmit={submit} noValidate className="max-w-md space-y-4" aria-busy={busy}>
        {error && (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        )}
        {done && (
          <Notice tone="success" role="status">
            Your password has been changed.
          </Notice>
        )}
        <PasswordField
          id="account-current-password"
          label="Current password"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          error={errors.current}
        />
        <PasswordField
          id="account-change-password"
          label="New password"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters, with letters and numbers.`}
          error={errors.next}
        />
        <button type="submit" className={primaryButton} disabled={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </Section>
  );
}

function EmailSection() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = emailProblem(email);
    setFieldError(problem);
    if (problem) return;
    setBusy(true);
    setError(null);
    const result = await auth.changeEmail(email);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSentTo(email.trim());
    setEmail('');
  }

  return (
    <Section id="account-email-heading" title="Email address">
      <form onSubmit={submit} noValidate className="max-w-md space-y-4" aria-busy={busy}>
        {error && (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        )}
        {sentTo && (
          <Notice tone="success" role="status">
            Check {sentTo} for a confirmation link. Your address changes once you follow it.
          </Notice>
        )}
        <div>
          <label htmlFor="account-change-email" className="block text-sm font-medium text-gray-700">
            New email address
          </label>
          <input
            id="account-change-email"
            type="email"
            className={`${textField} mt-1`}
            value={email}
            autoComplete="email"
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? 'account-change-email-error' : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
          {fieldError && (
            <p id="account-change-email-error" className="mt-1 text-sm text-red-700">
              {fieldError}
            </p>
          )}
        </div>
        <button type="submit" className={secondaryButton} disabled={busy}>
          {busy ? 'Sending…' : 'Change email address'}
        </button>
      </form>
    </Section>
  );
}

function DeleteAccountSection() {
  const auth = useAuth();
  const sync = useSync();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [removeData, setRemoveData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password === '') {
      setError('Enter your password to confirm.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await auth.deleteAccount(password);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // The account is gone. What stays on this browser becomes a local-only collection.
    if (removeData) sync.forgetThisBrowser();
    else sync.unlink();
    navigate('/account', {
      replace: true,
      state: {
        flash: removeData
          ? 'Your account and all of its data have been deleted, from the server and from this browser.'
          : 'Your account and its cloud data have been deleted. Your cards are still on this browser, saved only here.',
      },
    });
  }

  return (
    <Section id="account-delete" title="Delete account">
      <p className="text-sm text-gray-600">
        Deleting your account permanently removes it and every card, deck and review stored with it
        on the server, and signs out every device. Other devices keep the copy they already have,
        saved only on that device. This cannot be undone.
      </p>
      {!open ? (
        <button type="button" className={`${dangerButton} mt-4`} onClick={() => setOpen(true)}>
          Delete my account…
        </button>
      ) : (
        <form
          onSubmit={submit}
          noValidate
          className="mt-4 max-w-md space-y-4 rounded-lg border border-red-200 bg-red-50 p-4"
          aria-label="Confirm account deletion"
          aria-busy={busy}
        >
          {error && (
            <Notice tone="error" role="alert">
              {error}
            </Notice>
          )}
          <PasswordField
            id="account-delete-password"
            label="Your password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            hint="Needed to confirm it is you."
          />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={removeData}
              onChange={(event) => setRemoveData(event.target.checked)}
            />
            <span>Also remove my cards, decks and progress from this browser.</span>
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={dangerButton} disabled={busy}>
              {busy ? 'Deleting…' : 'Permanently delete my account'}
            </button>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                setOpen(false);
                setPassword('');
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}
