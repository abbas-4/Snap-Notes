import { useState, type Ref } from 'react';
import { textField } from '../styles';

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  /** `current-password` to sign in, `new-password` when choosing one, so password managers help. */
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  error?: string | null;
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * A password input with a button to show what was typed. The button is a
 * real toggle (`aria-pressed`) next to the field rather than inside it, so it
 * is easy to reach by keyboard and never covers the text.
 */
export default function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  hint,
  error,
  inputRef,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={id}
          ref={inputRef}
          type={visible ? 'text' : 'password'}
          className={textField}
          value={value}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          aria-pressed={visible}
          aria-controls={id}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          onClick={() => setVisible((shown) => !shown)}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-gray-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
