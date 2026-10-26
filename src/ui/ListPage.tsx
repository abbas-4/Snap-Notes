import { useState } from 'react';
import { Link } from 'react-router';
import type { Card } from '../domain/types';
import { useAppData } from './appData';
import { cardLabel } from './cardText';
import { dangerButton, primaryButton, secondaryButton, textField } from './styles';

type Status = { kind: 'success' | 'error'; text: string };

function matches(card: Card, query: string): boolean {
  return card.term.toLowerCase().includes(query) || card.definition.toLowerCase().includes(query);
}

export default function ListPage() {
  const { data, deleteCard } = useAppData();
  const [query, setQuery] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  // Newest first; creation time keeps the order stable across edits.
  const cards = [...data.cards].sort((a, b) => b.createdAt - a.createdAt);
  const normalizedQuery = query.trim().toLowerCase();
  const visible = normalizedQuery ? cards.filter((card) => matches(card, normalizedQuery)) : cards;

  function onDelete(card: Card) {
    const result = deleteCard(card.id);
    setConfirmingId(null);
    setStatus(
      result.ok
        ? { kind: 'success', text: `Deleted “${cardLabel(card)}”.` }
        : { kind: 'error', text: `The card could not be deleted: ${result.message}` },
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Cards</h1>
        <Link to="/add" className={primaryButton}>
          Add a card
        </Link>
      </div>

      {cards.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-6">
          <h2 className="font-semibold">No cards yet</h2>
          <p className="mt-1 text-sm text-gray-600">
            Add your first card, or import a backup from the home page.
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
