import { useState, type ReactNode } from 'react';
import type { WriteResult } from './appData';
import { dangerButton, secondaryButton } from './styles';

interface ResetProgressPanelProps {
  /** What the button says, such as "Reset this deck's progress". */
  label: string;
  /** The question in the confirmation, such as "Reset progress for Biology?". */
  question: string;
  /** What resetting does and does not touch. */
  children: ReactNode;
  /** Nothing to reset: the button explains itself instead of doing nothing. */
  disabled?: boolean;
  disabledHint?: string;
  onReset(): WriteResult;
  /** Shown as a status message once the reset has happened. */
  successMessage: string;
}

/**
 * A two-step reset. Nothing happens on the first click: the panel asks first,
 * and the confirmation says exactly what will be forgotten and what will not.
 *
 * Used for a single card, a whole deck and the whole collection, so all three
 * behave and read the same way.
 */
export default function ResetProgressPanel({
  label,
  question,
  children,
  disabled = false,
  disabledHint,
  onReset,
  successMessage,
}: ResetProgressPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    const result = onReset();
    setConfirming(false);
    if (!result.ok) {
      setStatus(null);
      setError(`Progress could not be reset: ${result.message}`);
      return;
    }
    setError(null);
    setStatus(successMessage);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      <p className="text-sm text-gray-600">{children}</p>
      {/* Announced politely rather than as a status region: these panels sit
          on pages that already have one, and a second would compete with it. */}
      <div aria-live="polite">
        {status && (
          <p className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
            {status}
          </p>
        )}
      </div>

      {disabled ? (
        <p className="mt-3 text-sm text-gray-500">{disabledHint}</p>
      ) : !confirming ? (
        <button
          type="button"
          className={`${dangerButton} mt-3`}
          onClick={() => {
            setError(null);
            setStatus(null);
            setConfirming(true);
          }}
        >
          {label}
        </button>
      ) : (
        <div
          role="alertdialog"
          aria-label={question}
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-3"
        >
          <p className="text-sm text-red-900">{question} This cannot be undone.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={`${dangerButton} px-3 py-1.5`} onClick={confirm}>
              Yes, reset progress
            </button>
            <button
              type="button"
              className={`${secondaryButton} px-3 py-1.5`}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
