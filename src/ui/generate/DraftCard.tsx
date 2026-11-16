import { Link } from 'react-router';
import {
  BLANK,
  CARD_KIND_LABELS,
  CARD_KINDS,
  cardProblem,
  LIMITS,
  type CardKind,
  type GeneratedCard,
} from '../../../supabase/functions/_shared/flashcards/contract.ts';
import { dangerButton, secondaryButton, selectField, textField } from '../styles';
import type { Draft } from './generatorState';

interface DraftCardProps {
  draft: Draft;
  /** 1-based, for labels: "Card 3". */
  number: number;
  /** The deck already holds a card with the same text. */
  duplicateOf: string | null;
  /** A request is running, so nothing can be changed or regenerated. */
  busy: boolean;
  regenerating: boolean;
  onEdit(card: GeneratedCard): void;
  onKind(kind: CardKind): void;
  onToggle(selected: boolean): void;
  onRegenerate(): void;
  onRemove(): void;
}

const DIFFICULTY_STYLES = {
  easy: 'bg-green-50 text-green-800 ring-green-200',
  medium: 'bg-amber-50 text-amber-900 ring-amber-200',
  hard: 'bg-red-50 text-red-800 ring-red-200',
} as const;

function Badge({ className, children }: { className: string; children: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}
    >
      {children}
    </span>
  );
}

/** One generated card in the review list: everything about it can be changed before saving. */
export default function DraftCard({
  draft,
  number,
  duplicateOf,
  busy,
  regenerating,
  onEdit,
  onKind,
  onToggle,
  onRegenerate,
  onRemove,
}: DraftCardProps) {
  const { card } = draft;
  const id = `draft-${draft.id}`;
  const problem = cardProblem(card);
  const saved = draft.saved !== null;
  const locked = saved || busy;

  const set = (change: Partial<GeneratedCard>) => onEdit({ ...card, ...change });
  const correct = card.answer === '' ? -1 : card.choices.indexOf(card.answer);

  function setChoice(index: number, text: string) {
    const choices = card.choices.map((choice, i) => (i === index ? text : choice));
    // Editing the correct option edits the answer with it.
    set(index === correct ? { choices, answer: text } : { choices });
  }

  function removeChoice(index: number) {
    const choices = card.choices.filter((_, i) => i !== index);
    set({ choices, answer: index === correct ? '' : card.answer });
  }

  const border = saved
    ? 'border-green-200 bg-green-50/40'
    : draft.selected
      ? problem
        ? 'border-red-300 bg-white'
        : 'border-indigo-200 bg-white'
      : 'border-gray-200 bg-gray-50';

  return (
    <li
      className={`rounded-xl border p-4 shadow-sm transition-colors ${border}`}
      aria-labelledby={`${id}-title`}
      aria-busy={regenerating}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {saved ? (
          <span id={`${id}-title`} className="text-sm font-semibold text-gray-900">
            Card {number}
          </span>
        ) : (
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus-visible:outline-2 focus-visible:outline-indigo-600"
              checked={draft.selected}
              disabled={busy}
              onChange={(event) => onToggle(event.target.checked)}
            />
            <span id={`${id}-title`}>Card {number}</span>
            <span className="sr-only">
              {draft.selected ? ' (will be saved)' : ' (will not be saved)'}
            </span>
          </label>
        )}
        <Badge className={DIFFICULTY_STYLES[card.difficulty]}>{card.difficulty}</Badge>
        {draft.edited && !saved && (
          <Badge className="bg-gray-50 text-gray-700 ring-gray-200">edited</Badge>
        )}
        {saved && (
          <Badge className="bg-green-100 text-green-900 ring-green-300">
            {draft.saved?.cardId ? 'Saved' : 'Already in deck'}
          </Badge>
        )}
        {!saved && duplicateOf && (
          <Badge className="bg-amber-50 text-amber-900 ring-amber-200">{`Already in “${duplicateOf}”`}</Badge>
        )}
        <div className="ml-auto">
          <label htmlFor={`${id}-kind`} className="sr-only">
            Card {number} type
          </label>
          <select
            id={`${id}-kind`}
            className={`${selectField} py-1 text-sm`}
            value={card.kind}
            disabled={locked}
            onChange={(event) => onKind(event.target.value as CardKind)}
          >
            {CARD_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {CARD_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {regenerating ? (
        <p role="status" className="mt-4 text-sm text-gray-600">
          Writing a different card…
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor={`${id}-question`} className="block text-sm font-medium text-gray-700">
              {card.kind === 'term' ? 'Term' : card.kind === 'fill-blank' ? 'Sentence' : 'Question'}
            </label>
            <textarea
              id={`${id}-question`}
              rows={card.kind === 'term' ? 1 : 2}
              maxLength={LIMITS.questionMaxChars}
              className={`${textField} mt-1`}
              value={card.question}
              readOnly={locked}
              onChange={(event) => set({ question: event.target.value })}
              aria-describedby={card.kind === 'fill-blank' ? `${id}-blank-hint` : undefined}
            />
            {card.kind === 'fill-blank' && (
              <p id={`${id}-blank-hint`} className="mt-1 text-xs text-gray-500">
                Mark the missing word with {BLANK}.
              </p>
            )}
          </div>

          {card.kind === 'multiple-choice' ? (
            <fieldset>
              <legend className="text-sm font-medium text-gray-700">
                Choices <span className="font-normal text-gray-500">(select the correct one)</span>
              </legend>
              <ul className="mt-1 space-y-2">
                {card.choices.map((choice, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`${id}-correct`}
                      className="h-4 w-4 border-gray-300 text-indigo-600"
                      checked={index === correct && choice !== ''}
                      disabled={locked}
                      onChange={() => set({ answer: choice })}
                      aria-label={`Choice ${index + 1} is correct`}
                    />
                    <input
                      type="text"
                      className={`${textField} py-1.5`}
                      maxLength={LIMITS.choiceMaxChars}
                      value={choice}
                      readOnly={locked}
                      onChange={(event) => setChoice(index, event.target.value)}
                      aria-label={`Choice ${index + 1}`}
                    />
                    {!locked && card.choices.length > LIMITS.choicesMin && (
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-indigo-600"
                        onClick={() => removeChoice(index)}
                        aria-label={`Remove choice ${index + 1}`}
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {!locked && card.choices.length < LIMITS.choicesMax && (
                <button
                  type="button"
                  className="mt-2 text-sm font-medium text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-indigo-600"
                  onClick={() => set({ choices: [...card.choices, ''] })}
                >
                  Add a choice
                </button>
              )}
            </fieldset>
          ) : (
            <div>
              <label htmlFor={`${id}-answer`} className="block text-sm font-medium text-gray-700">
                {card.kind === 'term'
                  ? 'Definition'
                  : card.kind === 'fill-blank'
                    ? 'Missing word'
                    : 'Answer'}
              </label>
              <textarea
                id={`${id}-answer`}
                rows={card.kind === 'fill-blank' ? 1 : 3}
                maxLength={LIMITS.answerMaxChars}
                className={`${textField} mt-1`}
                value={card.answer}
                readOnly={locked}
                onChange={(event) => set({ answer: event.target.value })}
              />
            </div>
          )}

          {problem && !saved && (
            <p className="text-sm font-medium text-red-700" id={`${id}-problem`}>
              {problem}
            </p>
          )}

          {card.evidence && (
            <details className="text-sm text-gray-600">
              <summary className="cursor-pointer rounded font-medium text-gray-700 focus-visible:outline-2 focus-visible:outline-indigo-600">
                Where this comes from
              </summary>
              <blockquote className="mt-2 border-l-4 border-indigo-200 pl-3 break-words whitespace-pre-wrap italic">
                {card.evidence}
              </blockquote>
            </details>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {saved ? (
          draft.saved?.cardId && (
            <Link to={`/edit/${draft.saved.cardId}`} className={secondaryButton}>
              Edit saved card
            </Link>
          )
        ) : (
          <>
            <button
              type="button"
              className={secondaryButton}
              onClick={onRegenerate}
              aria-label={`Regenerate card ${number}`}
              disabled={busy}
            >
              Regenerate
            </button>
            <button
              type="button"
              className={dangerButton}
              onClick={onRemove}
              disabled={busy}
              aria-label={`Remove card ${number}`}
            >
              Remove
            </button>
          </>
        )}
      </div>
    </li>
  );
}
