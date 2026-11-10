import { useState } from 'react';
import { Link } from 'react-router';
import type { Card } from '../domain/types';
import { useAppData } from './appData';
import { cardLabel } from './cardText';
import DeckNotFound from './DeckNotFound';
import { useDeckScope, withDeck } from './deckScope';
import DeckScopeNotice from './DeckScopeNotice';
import { dangerButton, primaryButton, secondaryButton, selectField, textField } from './styles';

type Status = { kind: 'success' | 'error'; text: string };

function matches(card: Card, query: string): boolean {
  return card.term.toLowerCase().includes(query) || card.definition.toLowerCase().includes(query);
}

export default function ListPage() {
  const { data, deleteCard, moveCards } = useAppData();
  const { deck, deckId, unknownDeck, cards: inScope } = useDeckScope();
  const [query, setQuery] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  // Newest first; creation time keeps the order stable across edits.
  const cards = [...inScope].sort((a, b) => b.createdAt - a.createdAt);
  const normalizedQuery = query.trim().toLowerCase();
  const visible = normalizedQuery ? cards.filter((card) => matches(card, normalizedQuery)) : cards;
  // With one deck there is nothing to choose between, so the deck controls stay out of the way.
  const showDecks = data.decks.length > 1;
  const deckNames = new Map(data.decks.map((d) => [d.id, d.name]));

  function onDelete(card: Card) {
    const result = deleteCard(card.id);
    setConfirmingId(null);
    setStatus(
      result.ok
        ? { kind: 'success', text: `Deleted “${cardLabel(card)}”.` }
        : { kind: 'error', text: `The card could not be deleted: ${result.message}` },
    );
  }

  function onMove(card: Card, toDeckId: string) {
    const result = moveCards([card.id], toDeckId);
    setStatus(
      result.ok
        ? {
            kind: 'success',
            text: `Moved “${cardLabel(card)}” to “${deckNames.get(toDeckId) ?? 'another deck'}”.`,
          }
        : { kind: 'error', text: `The card could not be moved: ${result.message}` },
    );
  }

  if (unknownDeck) return <DeckNotFound />;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Cards</h1>
        <Link to={withDeck('/add', deckId)} className={primaryButton}>
          Add a card
        </Link>
      </div>

      {deck && (
        <div className="mt-3">
          <DeckScopeNotice deck={deck}>
            <Link
              to="/list"
              className="font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              Show all cards
            </Link>
          </DeckScopeNotice>
        </div>
      )}

      {cards.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-6">
          <h2 className="font-semibold">{deck ? 'No cards in this deck yet' : 'No cards yet'}</h2>
          <p className="mt-1 text-sm text-gray-600">
            {deck
              ? 'Add a card to this deck, or move one here from another deck.'
              : 'Add your first card, or import a backup from the home page.'}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6">
            <label htmlFor="card-search" className="block text-sm font-medium text-gray-700">
              Search
            </label>
            <input
              id="card-search"
              type="search"
              className={`${textField} mt-1`}
              placeholder="Search terms and definitions"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <p role="status" className="mt-2 text-sm text-gray-500">
              {normalizedQuery
                ? `Showing ${visible.length} of ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`
                : `${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`}
            </p>
          </div>

          {status && (
            <p
              role={status.kind === 'error' ? 'alert' : 'status'}
              className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                status.kind === 'error'
                  ? 'border border-red-200 bg-red-50 text-red-800'
                  : 'border border-green-200 bg-green-50 text-green-800'
              }`}
            >
              {status.text}
            </p>
          )}

          {visible.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center">
              <p className="text-gray-700">No cards match “{query.trim()}”.</p>
              <button
                type="button"
                className={`${secondaryButton} mt-3`}
                onClick={() => setQuery('')}
              >
                Clear search
              </button>
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {visible.map((card) => (
                <li
                  key={card.id}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="font-semibold break-words whitespace-pre-wrap">
                        {card.term.trim() === '' ? (
                          <span className="font-normal text-gray-400 italic">(no term)</span>
                        ) : (
                          card.term
                        )}
                      </h2>
                      <p className="mt-1 text-sm break-words whitespace-pre-wrap text-gray-600">
                        {card.definition.trim() === '' ? (
                          <span className="text-gray-400 italic">(no definition)</span>
                        ) : (
                          card.definition
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Link
                        to={`/edit/${card.id}`}
                        className={secondaryButton}
                        aria-label={`Edit ${cardLabel(card)}`}
                      >
                        Edit
                      </Link>
                      <button
                        type="button"
                        className={dangerButton}
                        aria-label={`Delete ${cardLabel(card)}`}
                        onClick={() => {
                          setStatus(null);
                          setConfirmingId(card.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  {showDecks && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label
                        htmlFor={`card-deck-${card.id}`}
                        className="text-sm font-medium text-gray-700"
                      >
                        Deck
                      </label>
                      <select
                        id={`card-deck-${card.id}`}
                        className={`${selectField} py-1.5 text-sm`}
                        aria-label={`Deck for ${cardLabel(card)}`}
                        value={card.deckId}
                        onChange={(event) => onMove(card, event.target.value)}
                      >
                        {data.decks.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {confirmingId === card.id && (
                    <div
                      role="alertdialog"
                      aria-label={`Delete ${cardLabel(card)}?`}
                      className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2"
                    >
                      <p className="text-sm text-red-900">
                        Delete “{cardLabel(card)}”? This cannot be undone.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={`${dangerButton} px-3 py-1.5`}
                          onClick={() => onDelete(card)}
                        >
                          Delete card
                        </button>
                        <button
                          type="button"
                          className={`${secondaryButton} px-3 py-1.5`}
                          onClick={() => setConfirmingId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
