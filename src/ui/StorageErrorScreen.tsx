import { downloadTextFile } from './download';
import { LEGACY_APP_URL } from './legacyApp';
import { secondaryButton } from './styles';

interface StorageErrorScreenProps {
  error: 'corrupt' | 'newer-version';
  message: string;
  /** The raw stored text, offered as a backup download. */
  raw: string;
}

/**
 * Shown when the saved data cannot be read. The app refuses to run rather than
 * risk overwriting data it does not understand.
 */
export default function StorageErrorScreen({ error, message, raw }: StorageErrorScreenProps) {
  return (
    // Shown instead of the layout, so it sets the page colours the layout normally sets.
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {error === 'newer-version'
            ? 'Your saved cards need a newer version of Snap Notes'
            : 'Your saved cards could not be read'}
        </h1>
        <p className="mt-4 text-gray-700">
          Nothing has been changed or deleted — your data is still stored exactly as it was. To keep
          a copy somewhere safe, download it below.
        </p>
        <p className="mt-2 text-sm text-gray-500">Details: {message}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className={secondaryButton}
            onClick={() => downloadTextFile('snap-notes-backup.json', raw)}
          >
            Download my data
          </button>
          <a href={LEGACY_APP_URL} className={secondaryButton}>
            Open the original app
          </a>
        </div>
        <p className="mt-3 text-sm text-gray-500">
          The original app keeps its own copy of the cards you had before the switch, so it may
          still show them.
        </p>
      </main>
    </div>
  );
}
