import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { exportFileName } from '../../storage/importExport';
import type { LinkChoice } from '../../sync/link';
import { useAppData } from '../appData';
import { downloadTextFile } from '../download';
import { primaryButton, secondaryButton } from '../styles';
import { AccountsUnavailable } from './AuthPages';
import { useAuth, useSync } from './cloud';
import Notice from './Notice';
import { changesLabel } from './syncText';

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Joining this browser's data to an account, when both have something.
 *
 * Nothing happens until the user chooses, and nothing on this browser is
 * removed without a chance to download it first. The other cases are handled
 * without asking: an empty browser just downloads the account, and a new,
 * empty account just receives this browser's data.
 */
export default function LinkAccountPage() {
  const auth = useAuth();
  const sync = useSync();
  const { exportText } = useAppData();
  const navigate = useNavigate();
  const { link } = sync;
  // Until the user picks, the default follows what the check found: for
  // another account's cards, replacing them is the safer suggestion.
  const [picked, setChoice] = useState<LinkChoice | null>(null);
  const choice: LinkChoice =
    picked ?? (link.kind === 'needed' && link.previousAccount ? 'use-account' : 'merge');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  if (auth.status === 'disabled') return <AccountsUnavailable />;
  if (auth.status === 'signed-out') return <Navigate to="/account/sign-in" replace />;
  if (link.kind !== 'needed' && !busy) {
    return (
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Set up sync</h1>
        <p className="mt-2 text-gray-700" role="status">
          {link.kind === 'checking' || link.kind === 'linking'
            ? 'Comparing this browser with your account…'
            : 'This browser is already linked to your account.'}
        </p>
        <Link to="/account" className={`${secondaryButton} mt-4`}>
          Back to your account
        </Link>
      </div>
    );
  }
  if (link.kind !== 'needed') return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await sync.linkWith(choice);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    navigate('/account', { replace: true });
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Set up sync on this browser</h1>
      <p className="mt-2 text-gray-700">
        This browser and your account both have cards. Choose how to bring them together.
      </p>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <dt className="text-sm text-gray-600">On this browser</dt>
          <dd className="mt-1 font-semibold">
            {count(link.local.cards, 'card', 'cards')} in {count(link.local.decks, 'deck', 'decks')}
          </dd>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <dt className="text-sm text-gray-600">In your account ({auth.user?.email})</dt>
          <dd className="mt-1 font-semibold">
            {count(link.cloud.cards, 'card', 'cards')} in {count(link.cloud.decks, 'deck', 'decks')}
          </dd>
        </div>
      </dl>

      {link.previousAccount && (
        <Notice tone="warning" className="mt-4">
          The cards on this browser were last synced with a different account,{' '}
          <strong>{link.previousAccount}</strong>.
          {link.previousPending > 0 &&
            ` ${changesLabel(link.previousPending)} never reached that account; sign in to it instead to keep them there.`}
        </Notice>
      )}

      <form onSubmit={submit} className="mt-6" aria-busy={busy}>
        {error && (
          <Notice tone="error" role="alert" className="mb-4">
            {error}
          </Notice>
        )}
        <fieldset>
          <legend className="font-semibold">What should happen?</legend>
          <div className="mt-3 space-y-3">
            <label className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm has-[:checked]:border-indigo-500">
              <input
                type="radio"
                name="link-choice"
                value="merge"
                className="mt-1"
                checked={choice === 'merge'}
                onChange={() => setChoice('merge')}
              />
              <span>
                <span className="block font-medium">Combine them</span>
                <span className="block text-sm text-gray-600">
                  Keep everything from both. A deck with the same name, or a card with the same
                  deck, term and definition, is recognised and kept once, with its learning progress
                  joined. Nothing is deleted.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm has-[:checked]:border-indigo-500">
              <input
                type="radio"
                name="link-choice"
                value="use-account"
                className="mt-1"
                checked={choice === 'use-account'}
                onChange={() => setChoice('use-account')}
              />
              <span>
                <span className="block font-medium">Use only my account&rsquo;s cards</span>
                <span className="block text-sm text-gray-600">
                  This browser&rsquo;s cards and progress are replaced by your account&rsquo;s. Your
                  account is not changed.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {choice === 'use-account' && (
          <Notice tone="warning" className="mt-4">
            <p>
              The {count(link.local.cards, 'card', 'cards')} on this browser will be removed from
              it. Download a backup first if you might want them later.
            </p>
            <button
              type="button"
              className={`${secondaryButton} mt-2 px-3 py-1.5`}
              onClick={() => {
                downloadTextFile(exportFileName(), exportText());
                setDownloaded(true);
              }}
            >
              Download a backup of this browser&rsquo;s cards
            </button>
            {downloaded && <p className="mt-1">Backup downloaded.</p>}
          </Notice>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button type="submit" className={primaryButton} disabled={busy}>
            {busy
              ? 'Setting up sync…'
              : choice === 'merge'
                ? 'Combine and sync'
                : 'Replace and sync'}
          </button>
          <Link to="/account" className={secondaryButton}>
            Not now
          </Link>
        </div>
        <p className="mt-3 text-sm text-gray-600">
          Until you choose, this browser keeps working on its own and nothing is uploaded.
        </p>
      </form>
    </div>
  );
}
