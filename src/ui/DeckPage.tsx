import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { cardCountByDeck } from '../domain/deckOps';
import { useAppData } from './appData';
import DeckNameForm from './DeckNameForm';
import DeckNotFound from './DeckNotFound';
import { dangerButton, primaryButton, secondaryButton, selectField } from './styles';

const MODES = [
  { path: '/study', label: 'Study' },
  { path: '/quiz', label: 'Quiz' },
  { path: '/learn', label: 'Learn' },
  { path: '/match', label: 'Match' },
] as const;

export default function DeckPage() {
  const { deckId } = useParams();
  const { data } = useAppData();
  const deck = data.decks.find((d) => d.id === deckId);

  if (!deck) return <DeckNotFound />;

  // Keyed so switching between decks resets the rename field and the delete prompt.
  return <DeckDetail key={deck.id} deckId={deck.id} />;
}

function DeckDetail({ deckId }: { deckId: string }) {
  const { data, renameDeck, deleteDeck } = useAppData();
  const navigate = useNavigate();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);

  const deck = data.decks.find((d) => d.id === deckId);
  const others = data.decks.filter((d) => d.id !== deckId);
  // Falls back to the first deck, so a choice that no longer exists cannot be submitted.
  const destination =
    chosen !== null && others.some((d) => d.id === chosen) ? chosen : (others[0]?.id ?? '');

  // The moment after this deck is deleted, before the redirect to /decks lands.
  if (!deck) return null;

  const count = cardCountByDeck(data).get(deckId) ?? 0;
  const scoped = `?deck=${encodeURIComponent(deckId)}`;
  const isOnlyDeck = others.length === 0;

  const deckName = deck.name;
  const onDelete = () => {
    const target = data.decks.find((d) => d.id === destination);
    const result = deleteDeck(deckId, destination);
    setConfirming(false);
    if (!result.ok) {
      setError(`The deck could not be deleted: ${result.message}`);
      return;
    }
    navigate('/decks', {
      state: {
        status:
          count === 0
            ? `Deleted “${deckName}”.`
            : `Deleted “${deckName}”. Its cards moved to “${target?.name ?? 'another deck'}”.`,
      },
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm">
          <Link
            to="/decks"
            className="text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            All decks
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight break-words">{deck.name}</h1>
        <p role="status" className="mt-2 text-gray-700">
          {status ?? `${count} ${count === 1 ? 'card' : 'cards'} in this deck.`}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to={`/add${scoped}`} className={primaryButton}>
            Add a card
          </Link>
          <Link to={`/list${scoped}`} className={secondaryButton}>
            Browse these cards
          </Link>
        </div>
      </div>

      <section aria-labelledby="deck-review-heading">
        <h2 id="deck-review-heading" className="text-lg font-semibold">
          Review this deck
        </h2>
        {count === 0 ? (
          <p className="mt-2 text-sm text-gray-600">
            Add a card to this deck to study, quiz, learn or match from it.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-3">
            {MODES.map((mode) => (
              <Link
                key={mode.path}
                to={`${mode.path}${scoped}`}
                className={secondaryButton}
                aria-label={`${mode.label} ${deckName}`}
              >
                {mode.label}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="deck-rename-heading">
        <h2 id="deck-rename-heading" className="text-lg font-semibold">
          Rename this deck
        </h2>
        <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <DeckNameForm
            id="deck-name"
            label="Deck name"
            submitLabel="Save name"
            initialName={deck.name}
            onSubmit={(name) => renameDeck(deckId, name)}
            onSuccess={(name) => {
              setError(null);
              setStatus(`Renamed to “${name}”.`);
            }}
          />
        </div>
      </section>

      <section aria-labelledby="deck-delete-heading">
        <h2 id="deck-delete-heading" className="text-lg font-semibold">
          Delete this deck
        </h2>
        <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          {error && (
            <p
              role="alert"
              className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {error}
            </p>
          )}
          {isOnlyDeck ? (
            <p className="text-sm text-gray-600">
              This is your only deck, so it cannot be deleted. Create another deck first.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                Deleting a deck never deletes cards. Its {count === 1 ? 'card' : 'cards'} move to
                another deck you choose.
              </p>
              {!confirming ? (
                <button
                  type="button"
                  className={`${dangerButton} mt-3`}
                  onClick={() => {
                    setError(null);
                    setConfirming(true);
                  }}
                >
                  Delete deck
                </button>
              ) : (
                <div
                  role="alertdialog"
                  aria-label={`Delete ${deck.name}?`}
                  className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-3"
                >
                  <p className="text-sm text-red-900">
                    Delete “{deck.name}”? This cannot be undone.
                  </p>
                  {count > 0 && (
                    <div className="mt-3">
                      <label
                        htmlFor="deck-delete-destination"
                        className="block text-sm font-medium text-red-900"
                      >
                        Move its {count === 1 ? 'card' : `${count} cards`} to
                      </label>
                      <select
                        id="deck-delete-destination"
                        className={`${selectField} mt-1`}
                        value={destination}
                        onChange={(event) => setChosen(event.target.value)}
                      >
                        {others.map((other) => (
                          <option key={other.id} value={other.id}>
                            {other.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`${dangerButton} px-3 py-1.5`}
                      onClick={onDelete}
                    >
                      Delete deck
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
            </>
          )}
        </div>
      </section>
    </div>
  );
}
