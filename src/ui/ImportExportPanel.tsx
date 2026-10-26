import { useRef, useState, type ChangeEvent } from 'react';
import { exportFileName } from '../storage/importExport';
import { useAppData } from './appData';
import { downloadTextFile } from './download';
import { secondaryButton } from './styles';

type Status = { kind: 'success' | 'error'; text: string };

/**
 * Import and export actions with inline feedback. A failed import never
 * changes stored data; the storage layer validates before anything is written.
 */
export default function ImportExportPanel() {
  const { data, importCards, exportText } = useAppData();
  const [status, setStatus] = useState<Status | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    let text: string;
    try {
      text = await file.text();
    } catch {
      setStatus({
        kind: 'error',
        text: 'The file could not be read. Your cards were not changed.',
      });
      input.value = '';
      return;
    }

    const result = importCards(text);
    if (!result.ok) {
      setStatus({
        kind: 'error',
        text: `Import failed: ${result.message} Your cards were not changed.`,
      });
    } else {
      const { cardsAdded, duplicatesSkipped } = result.report;
      const added =
        cardsAdded === 0
          ? 'No new cards to import.'
          : `Imported ${cardsAdded} ${cardsAdded === 1 ? 'card' : 'cards'}.`;
      const skipped =
        duplicatesSkipped > 0
          ? ` Skipped ${duplicatesSkipped} ${duplicatesSkipped === 1 ? 'card' : 'cards'} you already have.`
          : '';
      setStatus({ kind: 'success', text: added + skipped });
    }
    // Allows picking the same file again.
    input.value = '';
  }

  function onExport() {
    downloadTextFile(exportFileName(), exportText());
    setStatus({
      kind: 'success',
      text: `Exported ${data.cards.length} ${data.cards.length === 1 ? 'card' : 'cards'}.`,
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Import file"
          onChange={onFileChange}
        />
        <button
          type="button"
          className={secondaryButton}
          onClick={() => fileInputRef.current?.click()}
        >
          Import cards…
        </button>
        <button
          type="button"
          className={secondaryButton}
          disabled={data.cards.length === 0}
          onClick={onExport}
        >
          Export cards
        </button>
      </div>
      <p className="mt-2 text-sm text-gray-500">
        Import accepts exports from this app and from the original Snap Notes. Importing the same
        file twice will not duplicate cards.
      </p>
      {status && (
        <p
          role={status.kind === 'error' ? 'alert' : 'status'}
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            status.kind === 'error'
              ? 'border border-red-200 bg-red-50 text-red-800'
              : 'border border-green-200 bg-green-50 text-green-800'
          }`}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
