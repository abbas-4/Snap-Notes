import { useRef, useState, type FormEvent } from 'react';
import type { WriteResult } from './appData';
import { primaryButton, textField } from './styles';

interface DeckNameFormProps {
  /** Distinguishes the field when more than one of these is on a page. */
  id: string;
  label: string;
  submitLabel: string;
  initialName?: string;
  /** Empties the field after a successful submit, for the "create a deck" form. */
  clearOnSuccess?: boolean;
  onSubmit(name: string): WriteResult;
  /** Called with the trimmed name once the write has succeeded. */
  onSuccess(name: string): void;
}

/**
 * The one text field used to name a deck, shared by creating and renaming.
 *
 * It keeps its own error so a refused name stays next to the field; the page
 * owns the success message, because only the page knows what to say about it.
 */
export default function DeckNameForm({
  id,
  label,
  submitLabel,
  initialName = '',
  clearOnSuccess = false,
  onSubmit,
  onSuccess,
}: DeckNameFormProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function fail(message: string) {
    setError(message);
    inputRef.current?.focus();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      fail('A deck needs a name.');
      return;
    }
    const result = onSubmit(trimmed);
    if (!result.ok) {
      fail(result.message);
      return;
    }
    setError(null);
    if (clearOnSuccess) setName('');
    onSuccess(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-xl">
      {error && (
        <p
          role="alert"
          id={`${id}-error`}
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <div className="mt-1 flex flex-wrap items-start gap-3">
        <input
          id={id}
          ref={inputRef}
          type="text"
          className={`${textField} sm:w-64`}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button type="submit" className={primaryButton}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
