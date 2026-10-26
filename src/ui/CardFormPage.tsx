import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Card } from '../domain/types';
import { useAppData } from './appData';
import { primaryButton, secondaryButton, textField } from './styles';
import { useUnsavedChanges } from './unsavedChanges';

interface CardFormPageProps {
  mode: 'add' | 'edit';
}

export default function CardFormPage({ mode }: CardFormPageProps) {
  const { cardId } = useParams();
  const { data } = useAppData();
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

  // Keyed so switching between cards resets the form state.
  return <CardForm key={card?.id ?? 'new'} card={card} />;
}

function CardForm({ card }: { card: Card | undefined }) {
  const { addCard, updateCard } = useAppData();
  const navigate = useNavigate();
  const { setDirty, confirmLeave } = useUnsavedChanges();

  const [term, setTerm] = useState(card?.term ?? '');
  const [definition, setDefinition] = useState(card?.definition ?? '');
  const [error, setError] = useState<string | null>(null);
  const termRef = useRef<HTMLInputElement>(null);

  const dirty = term !== (card?.term ?? '') || definition !== (card?.definition ?? '');

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
    const input = { term: term.trim(), definition: definition.trim() };
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
    navigate('/list');
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
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={primaryButton}>
            {card ? 'Save changes' : 'Add card'}
          </button>
          <button type="button" className={secondaryButton} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
