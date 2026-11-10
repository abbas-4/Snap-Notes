import { useRef, useState, type ChangeEvent } from 'react';
import type { LegacyProblem } from '../storage/localStore';
import type { ImportOutcome, WriteResult } from './appData';
import { downloadTextFile } from './download';
import { LEGACY_APP_URL } from './legacyApp';
import { primaryButton, secondaryButton } from './styles';

interface LegacyRecoveryScreenProps {
  problem: LegacyProblem;
  message: string;
  /** The original app's data exactly as stored, offered as a download. */
  raw: string;
  onRestoreFile(text: string): ImportOutcome;
  onStartEmpty(): WriteResult;
}

/**
 * Shown when there is no v2 data and the original app's data cannot be read as
 * cards. Nothing has been written at this point, and nothing is until the user
 * picks a way forward; starting with an empty collection is the one choice
 * that writes, and it is explicit and confirmed.
 */
export default function LegacyRecoveryScreen({
  problem,
  message,
  raw,
  onRestoreFile,
  onStartEmpty,
}: LegacyRecoveryScreenProps) {
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    let text: string;
    try {
      text = await file.text();
    } catch {
      setError('The backup file could not be read.');
      input.value = '';
      return;
    }

    const result = onRestoreFile(text);
    if (!result.ok) setError(`The backup could not be restored: ${result.message}`);
    input.value = '';
  }

  function downloadOriginal() {
    // Unreadable JSON is saved as plain text, so it opens anywhere.
    const json = problem !== 'invalid-json';
    downloadTextFile(
      json ? 'snap-notes-original-data.json' : 'snap-notes-original-data.txt',
      raw,
      json ? 'application/json' : 'text/plain',
    );
  }

  function startEmpty() {
    const sure = window.confirm(
      'Start with an empty collection? The data from the previous version stays saved in this browser, but Snap Notes will stop offering to recover it.',
    );
    if (!sure) return;
    const result = onStartEmpty();
    if (!result.ok) setError(`An empty collection could not be saved: ${result.message}`);
  }

  return (
    // Shown instead of the layout, so it sets the page colours the layout normally sets.
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Your cards from the previous version could not be read
        </h1>
        <p className="mt-4 text-gray-700">
          Snap Notes found data saved by the previous version in this browser, but it could not be
          read as a list of cards, so nothing has been moved over. Nothing has been changed or
          deleted either: the data is still stored exactly as it was.
        </p>
        <p className="mt-2 text-sm text-gray-500">Details: {message}</p>

        <section aria-labelledby="recovery-options" className="mt-8">
          <h2 id="recovery-options" className="text-lg font-semibold">
            What you can do
          </h2>
          <ol className="mt-3 space-y-4">
            <li className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="font-semibold">1. Keep a copy of the original data</h3>
              <p className="mt-1 text-sm text-gray-600">
                Do this first. If you open the original app, it may show no cards, and saving
                anything there would replace this data.
              </p>
              <button type="button" className={`${primaryButton} mt-3`} onClick={downloadOriginal}>
                Download the original data
              </button>
            </li>
            <li className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="font-semibold">2. Look in the original app</h3>
              <p className="mt-1 text-sm text-gray-600">
                Your cards may still display there. If they do, export them from its home page and
                restore that file here.
              </p>
              <a href={LEGACY_APP_URL} className={`${secondaryButton} mt-3`}>
                Open the original app
              </a>
            </li>
            <li className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="font-semibold">3. Restore from a backup</h3>
              <p className="mt-1 text-sm text-gray-600">
                A file exported from the original app or from Snap Notes.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                tabIndex={-1}
                aria-label="Backup file"
                onChange={onFileChange}
              />
              <button
                type="button"
                className={`${secondaryButton} mt-3`}
                onClick={() => fileInputRef.current?.click()}
              >
                Restore from a backup file…
              </button>
            </li>
            <li className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="font-semibold">4. Start fresh</h3>
              <p className="mt-1 text-sm text-gray-600">
                Begin with an empty collection. The original data stays in this browser, untouched.
              </p>
              <button type="button" className={`${secondaryButton} mt-3`} onClick={startEmpty}>
                Start with an empty collection
              </button>
            </li>
          </ol>
        </section>

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </p>
        )}
      </main>
    </div>
  );
}
