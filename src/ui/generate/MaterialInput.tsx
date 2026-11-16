import { useId, useRef, useState, type ChangeEvent } from 'react';
import { LIMITS } from '../../../supabase/functions/_shared/flashcards/contract.ts';
import {
  ACCEPT_ATTRIBUTE,
  extractText,
  FORMAT_LABELS,
  type ExtractResult,
} from '../../documents/extract';
import { loadPdfJs } from '../../documents/pdfjsLoader';
import Notice from '../account/Notice';
import { useAppData } from '../appData';
import { secondaryButton, selectField, textField } from '../styles';

interface MaterialInputProps {
  value: string;
  onChange(value: string): void;
  disabled: boolean;
  /** Shown under the field: why the material cannot be sent yet. */
  problem: string | null;
}

type Notification = { tone: 'success' | 'error' | 'warning'; text: string } | null;

/** Adds text after what is already there, with a blank line between. */
function append(current: string, addition: string): string {
  return current.trim() === '' ? addition : `${current.trimEnd()}\n\n${addition}`;
}

const characters = (n: number) => n.toLocaleString('en');

/**
 * The study material: typed or pasted, read from a document, or taken from
 * cards the user already has. Documents are read here in the browser; nothing
 * is uploaded until the user chooses to generate.
 */
export default function MaterialInput({ value, onChange, disabled, problem }: MaterialInputProps) {
  const { data } = useAppData();
  const fieldId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notification>(null);
  const [chosenDeck, setSourceDeck] = useState(data.decks[0]?.id ?? '');
  // The chosen deck may since have been deleted, here, in another tab, or by sync.
  const sourceDeck = data.decks.some((d) => d.id === chosenDeck)
    ? chosenDeck
    : (data.decks[0]?.id ?? '');

  const over = value.length > LIMITS.materialMaxChars;

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again still counts as a change.
    event.target.value = '';
    if (!file) return;
    setNotice(null);
    setReading(file.name);
    let result: ExtractResult;
    try {
      result = await extractText(file, { loadPdfJs });
    } catch {
      result = { ok: false, message: 'This file could not be read.' };
    }
    setReading(null);
    if (!result.ok) {
      setNotice({ tone: 'error', text: `${file.name}: ${result.message}` });
      return;
    }
    onChange(append(value, result.text));
    const added = `Added ${characters(result.text.length)} characters from the ${FORMAT_LABELS[result.format]} “${file.name}”.`;
    setNotice(
      result.truncated
        ? {
            tone: 'warning',
            text: `${added} The file has more text than that; only the beginning was added.`,
          }
        : {
            tone: 'success',
            text: `${added} Check it below, and remove anything you do not want cards about.`,
          },
    );
  }

  function addDeckCards() {
    const cards = data.cards.filter((card) => card.deckId === sourceDeck);
    const deck = data.decks.find((d) => d.id === sourceDeck);
    if (cards.length === 0 || !deck) {
      setNotice({ tone: 'error', text: 'That deck has no cards yet.' });
      return;
    }
    const text = cards
      .map((card) => [card.term.trim(), card.definition.trim()].filter(Boolean).join(': '))
      .join('\n');
    onChange(append(value, text));
    setNotice({
      tone: 'success',
      text: `Added ${cards.length} ${cards.length === 1 ? 'card' : 'cards'} from “${deck.name}”.`,
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label htmlFor={fieldId} className="block text-sm font-medium text-gray-700">
          Study material
        </label>
        <p
          id={`${fieldId}-count`}
          className={`text-sm tabular-nums ${over ? 'font-semibold text-red-700' : 'text-gray-500'}`}
        >
          {characters(value.length)} / {characters(LIMITS.materialMaxChars)} characters
        </p>
      </div>
      <textarea
        id={fieldId}
        rows={12}
        className={`${textField} mt-1 font-normal`}
        placeholder="Paste notes, a textbook section or an article…"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={problem !== null && value !== ''}
        aria-describedby={`${fieldId}-count ${fieldId}-hint${problem ? ` ${fieldId}-problem` : ''}`}
      />
      <p id={`${fieldId}-hint`} className="mt-1 text-sm text-gray-500">
        Cards are written only from this text, so include everything the cards should cover.
      </p>
      {problem && value !== '' && (
        <div id={`${fieldId}-problem`} className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-sm text-red-700">{problem}</p>
          {over && (
            <button
              type="button"
              className={secondaryButton}
              onClick={() => onChange(value.slice(0, LIMITS.materialMaxChars))}
              disabled={disabled}
            >
              Keep the first {characters(LIMITS.materialMaxChars)} characters
            </button>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-gray-900">From a document</p>
          <p className="mt-1 text-sm text-gray-600">
            Text (.txt, .md), PDF or Word (.docx), up to 10 MB. Read on this device.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => void onFile(event)}
            data-testid="material-file"
          />
          <button
            type="button"
            className={`${secondaryButton} mt-3`}
            disabled={disabled || reading !== null}
            onClick={() => fileInput.current?.click()}
          >
            {reading ? 'Reading…' : 'Choose a file'}
          </button>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <label htmlFor={`${fieldId}-deck`} className="text-sm font-medium text-gray-900">
            From your cards
          </label>
          <p className="mt-1 text-sm text-gray-600">
            Use a deck’s terms and definitions, for example to make quiz-style cards from them.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              id={`${fieldId}-deck`}
              className={`${selectField} min-w-0 flex-1`}
              value={sourceDeck}
              onChange={(event) => setSourceDeck(event.target.value)}
              disabled={disabled}
            >
              {data.decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={secondaryButton}
              onClick={addDeckCards}
              disabled={disabled}
            >
              Add
            </button>
          </div>
        </div>
      </div>
      {reading && (
        <p role="status" className="mt-3 text-sm text-gray-600">
          Reading “{reading}”…
        </p>
      )}
      {notice && (
        <Notice
          tone={notice.tone}
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className="mt-3"
        >
          {notice.text}
        </Notice>
      )}
    </div>
  );
}
