import { exportFileName } from '../storage/importExport';
import { useAppData } from './appData';
import { downloadTextFile } from './download';
import { LEGACY_APP_URL } from './legacyApp';
import { migrationHeadline, migrationOutcome, summarizeIssues } from './migrationSummary';
import { secondaryButton } from './styles';

/**
 * Tells the user what happened to their cards from the original app. It reads
 * the persisted record, so it stays until dismissed, however often the page is
 * reloaded.
 */
export default function MigrationNotice() {
  const { migrationRecord, dismissMigrationNotice, exportText, legacyRawData } = useAppData();
  if (!migrationRecord) return null;

  const outcome = migrationOutcome(migrationRecord);
  const partial = outcome !== 'complete';
  const { significant, harmless, notShown } = summarizeIssues(migrationRecord);

  function downloadOriginal() {
    const raw = legacyRawData();
    if (raw !== null) downloadTextFile('snap-notes-original-data.json', raw);
  }

  return (
    <section
      role={partial ? 'alert' : 'status'}
      aria-labelledby="migration-notice-heading"
      className={`mb-6 rounded-xl border p-4 shadow-sm ${
        partial ? 'border-amber-300 bg-amber-50' : 'border-indigo-200 bg-indigo-50'
      }`}
    >
      <h2 id="migration-notice-heading" className="font-semibold">
        {outcome === 'entries-left-out'
          ? 'Some entries could not be moved over'
          : outcome === 'text-lost'
            ? 'Some text could not be moved over'
            : 'Welcome to the new Snap Notes'}
      </h2>
      <p className="mt-1 text-sm text-gray-800">
        {migrationHeadline(migrationRecord)}{' '}
        {partial
          ? 'Your original data has not been changed, so nothing is lost: you can download it below or open it in the original app.'
          : 'Nothing was removed: your original cards are still saved in this browser as a backup.'}
      </p>
      {significant.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-800">
          {significant.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ul>
      )}
      {harmless.length > 0 && (
        <details className="mt-2 text-sm text-gray-700">
          <summary className="cursor-pointer font-medium">Details of small changes</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {harmless.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        </details>
      )}
      {notShown > 0 && (
        <p className="mt-2 text-sm text-gray-800">
          {notShown} more {notShown === 1 ? 'change is' : 'changes are'} not listed here. The
          original data has every entry.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        {partial ? (
          <>
            <button type="button" className={secondaryButton} onClick={downloadOriginal}>
              Download the original data
            </button>
            <a href={LEGACY_APP_URL} className={secondaryButton}>
              Open the original app
            </a>
          </>
        ) : (
          <button
            type="button"
            className={secondaryButton}
            onClick={() => downloadTextFile(exportFileName(), exportText())}
          >
            Download a backup
          </button>
        )}
        <button type="button" className={secondaryButton} onClick={dismissMigrationNotice}>
          Dismiss
        </button>
      </div>
    </section>
  );
}
