import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { cardCountByDeck } from '../domain/deckOps';
import { useAppData } from './appData';
import DeckNameForm from './DeckNameForm';
import { primaryButton, secondaryButton } from './styles';

function cardsLabel(count: number): string {
  return `${count} ${count === 1 ? 'card' : 'cards'}`;
}

export default function DecksPage() {
  const { data, createDeck } = useAppData();
  // A deck page that deletes a deck sends its message here, since it navigates away.
  const handedOver = (useLocation().state as { status?: string } | null)?.status ?? null;
  const [status, setStatus] = useState<string | null>(handedOver);

  const counts = cardCountByDeck(data);
  // Alphabetical, so a deck stays easy to find as the list grows.
  const decks = [...data.decks].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Decks</h1>
        <Link to="/add" className={primaryButton}>
          Add a card
        </Link>
      </div>

      <section aria-labelledby="new-deck-heading">
        <h2 id="new-deck-heading" className="text-lg font-semibold">
          Create a deck
        </h2>
        <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <DeckNameForm
            id="new-deck-name"
            label="Deck name"
            submitLabel="Create deck"
            clearOnSuccess
            onSubmit={createDeck}
            onSuccess={(name) => setStatus(`Created “${name}”.`)}
          />
        </div>
      </section>

      <section aria-labelledby="deck-list-heading">
        <h2 id="deck-list-heading" className="text-lg font-semibold">
          Your decks
        </h2>
        <p role="status" className="mt-2 text-sm text-gray-500">
          {status ??
            `${decks.length} ${decks.length === 1 ? 'deck' : 'decks'}, ${cardsLabel(data.cards.length)} in all`}
        </p>

        {decks.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-gray-300 bg-white p-6">
            <h3 className="font-semibold">No decks yet</h3>
            <p className="mt-1 text-sm text-gray-600">
              Create a deck above, and new cards can go straight into it.
            </p>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {decks.map((deck) => (
              <li
                key={deck.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="min-w-0">
                  <h3 className="font-semibold break-words">
                    <Link
                      to={`/decks/${deck.id}`}
                      className="text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                    >
                      {deck.name}
                    </Link>
                  </h3>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {cardsLabel(counts.get(deck.id) ?? 0)}
                  </p>
                </div>
                <Link
                  to={`/list?deck=${encodeURIComponent(deck.id)}`}
                  className={secondaryButton}
                  aria-label={`Browse the cards in ${deck.name}`}
                >
                  Cards
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
