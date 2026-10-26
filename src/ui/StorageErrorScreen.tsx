import { downloadTextFile } from './download';
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
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-gray-900">
        {error === 'newer-version'
          ? 'Your saved cards need a newer version of Snap Notes'
          : 'Your saved cards could not be read'}
      </h1>
      <p className="mt-4 text-gray-700">
        Nothing has been changed or deleted — your data is still stored exactly as it was. To keep a
        copy somewhere safe, download it below.
      </p>
      <p className="mt-2 text-sm text-gray-500">Details: {message}</p>
      <button
        type="button"
        className={`${secondaryButton} mt-6`}
        onClick={() => downloadTextFile('snap-notes-backup.json', raw)}
      >
        Download my data
      </button>
    </main>
  );
}
