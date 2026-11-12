import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { DEFAULT_DECK_ID } from '../domain/appData';
import { describeDue, mastery, retention } from '../domain/srs';
import type { Card } from '../domain/types';
import { useAppData } from './appData';
import { useDeckScope, withDeck } from './deckScope';
import { useProgress } from './progress';
import { percent, reviewsLabel } from './progressText';
import ResetProgressPanel from './ResetProgressPanel';
import { primaryButton, secondaryButton, selectField, textField } from './styles';
import { useUnsavedChanges } from './unsavedChanges';
import { useNow } from './useNow';

interface CardFormPageProps {
  mode: 'add' | 'edit';
}

export default function CardFormPage({ mode }: CardFormPageProps) {
  const { cardId } = useParams();
  const { data } = useAppData();
  const { deck: scopedDeck } = useDeckScope();
  const card = mode === 'edit' ? data.cards.find((c) => c.id === cardId) : undefined;

  if (mode === 'edit' && !card) {
    return (
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Card not found</h1>
        <p className="mt-2 text-gray-700">
          This card does not exist. It may have been deleted, or the link may be wrong.
        </p>
        <Link to="/list" className={`${primaryButton} mt-4`}>
          Back to cards
        </Link>
      </div>
    );
  }

  // A new card goes to the deck the link came from, else the default deck.
  const initialDeckId =
    card?.deckId ??
    scopedDeck?.id ??
    data.decks.find((d) => d.id === DEFAULT_DECK_ID)?.id ??
    data.decks[0]?.id ??
    '';

  // Keyed so switching between cards resets the form state.
  return (
    <CardForm
      key={card?.id ?? 'new'}
      card={card}
      initialDeckId={initialDeckId}
      scoped={!!scopedDeck}
    />
  );
}

interface CardFormProps {
  card: Card | undefined;
  initialDeckId: string;
  /** Whether the page was opened from a deck, so saving returns to that deck's cards. */
  scoped: boolean;
}

function CardForm({ card, initialDeckId, scoped }: CardFormProps) {
  const { data, addCard, updateCard } = useAppData();
  const navigate = useNavigate();
  const { setDirty, confirmLeave } = useUnsavedChanges();

  const [term, setTerm] = useState(card?.term ?? '');
  const [definition, setDefinition] = useState(card?.definition ?? '');
  const [deckId, setDeckId] = useState(initialDeckId);
  const [error, setError] = useState<string | null>(null);
  const termRef = useRef<HTMLInputElement>(null);

  // With one deck there is nothing to choose, so the field stays out of the way.
  const showDecks = data.decks.length > 1;

  const dirty =
    term !== (card?.term ?? '') ||
    definition !== (card?.definition ?? '') ||
    deckId !== initialDeckId;

  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);

  // Also warns when closing or reloading the page with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const input = { term: term.trim(), definition: definition.trim(), deckId };
    if (input.term === '' && input.definition === '') {
      setError('A card needs at least a term or a definition.');
      termRef.current?.focus();
      return;
    }
    const result = card ? updateCard(card.id, input) : addCard(input);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDirty(false);
    // Coming from a deck, go back to that deck's cards — the one the card is in now.
    navigate(scoped ? withDeck('/list', deckId) : '/list');
  }

  function onCancel() {
    if (confirmLeave()) navigate(card ? '/list' : '/');
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{card ? 'Edit card' : 'Add a card'}</h1>
      <form onSubmit={onSubmit} noValidate className="mt-6 max-w-xl space-y-5">
        {error && (
          <p
            role="alert"
            id="card-form-error"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        <div>
          <label htmlFor="card-term" className="block text-sm font-medium text-gray-700">
            Term
          </label>
          <input
            id="card-term"
            ref={termRef}
            type="text"
            className={`${textField} mt-1`}
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setError(null);
            }}
            aria-invalid={error !== null}
            aria-describedby={error ? 'card-form-error' : 'card-term-hint'}
          />
          <p id="card-term-hint" className="mt-1 text-sm text-gray-500">
            The front of the card — a word, phrase, or question.
          </p>
        </div>
        <div>
          <label htmlFor="card-definition" className="block text-sm font-medium text-gray-700">
            Definition
          </label>
          <textarea
            id="card-definition"
            rows={4}
            className={`${textField} mt-1`}
            value={definition}
            onChange={(event) => {
              setDefinition(event.target.value);
              setError(null);
            }}
            aria-describedby="card-definition-hint"
          />
          <p id="card-definition-hint" className="mt-1 text-sm text-gray-500">
            The back of the card — the answer or explanation.
          </p>
        </div>
        {showDecks && (
          <div>
            <label htmlFor="card-deck" className="block text-sm font-medium text-gray-700">
              Deck
            </label>
            <select
              id="card-deck"
              className={`${selectField} mt-1`}
              value={deckId}
              onChange={(event) => {
                setDeckId(event.target.value);
                setError(null);
              }}
              aria-describedby="card-deck-hint"
            >
              {data.decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name}
                </option>
              ))}
            </select>
            <p id="card-deck-hint" className="mt-1 text-sm text-gray-500">
              {card ? 'Changing this moves the card to another deck.' : 'Where this card is kept.'}
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={primaryButton}>
            {card ? 'Save changes' : 'Add card'}
          </button>
          <button type="button" className={secondaryButton} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
      {card && <CardProgressSection card={card} />}
    </div>
  );
}

const STAGE_LABELS = {
  learning: 'Learning',
  review: 'Reviewing',
  mastered: 'Mastered',
} as const;

/**
 * What reviewing knows about this card, and the way to forget it.
 *
 * Editing a card never touches its learning history: a typo fixed in a
 * definition should not cost the user weeks of scheduling. Resetting it is
 * therefore something they ask for here, on its own.
 */
function CardProgressSection({ card }: { card: Card }) {
  const { records, resetCard } = useProgress();
  // Read once when the page opens: "due tomorrow" need not tick while typing.
  const now = useNow(false);
  const progress = records.get(card.id);

  return (
    <section aria-labelledby="card-progress-heading" className="mt-10 max-w-xl">
      <h2 id="card-progress-heading" className="text-lg font-semibold">
        Learning progress
      </h2>
      {progress ? (
        <dl className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm shadow-sm">
          <div>
            <dt className="text-gray-600">Reviews</dt>
            <dd className="font-semibold">{reviewsLabel(progress.reviews)}</dd>
          </div>
          <div>
            <dt className="text-gray-600">Remembered</dt>
            <dd className="font-semibold">
              {percent(retention(progress))} ({progress.correct} of {progress.reviews})
            </dd>
          </div>
          <div>
            <dt className="text-gray-600">Stage</dt>
            <dd className="font-semibold">
              {STAGE_LABELS[progress.stage]} · {percent(mastery(progress))} learned
            </dd>
          </div>
          <div>
            <dt className="text-gray-600">Next review</dt>
            <dd className="font-semibold">{describeDue(progress, now)}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-sm text-gray-600">
          This card has not been reviewed yet, so it counts as new.
        </p>
      )}
      <div className="mt-3">
        <ResetProgressPanel
          label="Reset this card's progress"
          question={`Reset the learning progress for this card?`}
          disabled={!progress}
          disabledHint="There is no progress to reset yet."
          onReset={() => resetCard(card.id)}
          successMessage="This card's learning progress has been reset. The card itself is unchanged."
        >
          The card starts again as new: its review history, schedule and streak for this card are
          forgotten. The term, definition and deck stay exactly as they are.
        </ResetProgressPanel>
      </div>
    </section>
  );
}
