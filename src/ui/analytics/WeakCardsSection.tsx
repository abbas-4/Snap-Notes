import { useState } from 'react';
import { Link } from 'react-router';
import {
  WEAK_ACCURACY,
  WEAK_MIN_ATTEMPTS,
  WEAK_MIN_MISSES,
  WEAK_RECENT_SESSIONS,
  type SessionOutcome,
  type WeakCard,
  type WeakReason,
} from '../../domain/analytics';
import type { Deck } from '../../domain/types';
import { primaryButton, secondaryButton } from '../styles';
import { count, daysAgo, pct } from './format';
import Section, { panel } from './Section';

const SHOWN = 8;

function reasonText(reason: WeakReason): string {
  switch (reason.kind) {
    case 'low-accuracy':
      return `Right ${reason.correct} of ${count(reason.attempts, 'time')}`;
    case 'recent-misses':
      return `Missed in ${reason.missed} of its last ${count(reason.sessions, 'session')}`;
    case 'review-lapses':
      return `Forgotten ${count(reason.lapses, 'time')} in Review`;
  }
}

const OUTCOME: Record<SessionOutcome, { label: string; className: string; symbol: string }> = {
  correct: { label: 'right', className: 'bg-green-100 text-green-900', symbol: '✓' },
  missed: { label: 'missed', className: 'bg-red-100 text-red-900', symbol: '✗' },
  mixed: { label: 'missed, then right', className: 'bg-amber-100 text-amber-900', symbol: '~' },
};

function preview(text: string): string {
  const flat = text.trim().replace(/\s+/g, ' ');
  return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat || '(empty)';
}

export default function WeakCardsSection({
  weakCards,
  decks,
  now,
}: {
  weakCards: WeakCard[];
  decks: ReadonlyMap<string, Deck>;
  now: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? weakCards : weakCards.slice(0, SHOWN);

  return (
    <Section
      id="weak-cards"
      title="Weak cards"
      description="Cards you keep getting wrong, judged on your actual answers in every mode."
      actions={
        weakCards.length > 0 ? (
          <Link to="/learn?focus=weak" className={primaryButton}>
            Practise weak cards
          </Link>
        ) : null
      }
    >
      {weakCards.length === 0 ? (
        <div className={`${panel} text-sm text-gray-600`}>
          <p className="font-semibold text-gray-900">No weak cards right now</p>
          <p className="mt-1">
            No card has been missed often enough to stand out. Keep studying, and any card you
            struggle with will be listed here with the reason why.
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {shown.map((weak) => {
              const deck = decks.get(weak.card.deckId);
              return (
                <li key={weak.card.id} className={panel}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold break-words">{preview(weak.card.term)}</p>
                      <p className="mt-0.5 text-sm break-words text-gray-600">
                        {preview(weak.card.definition)}
                      </p>
                    </div>
                    <p
                      className="shrink-0 rounded-full bg-red-50 px-2.5 py-0.5 text-sm font-semibold text-red-800"
                      title="Share of answers that were right"
                    >
                      {pct(weak.accuracy)} right
                    </p>
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-700">
                    {weak.reasons.map((reason) => (
                      <li key={reason.kind}>• {reasonText(reason)}</li>
                    ))}
                  </ul>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-gray-600">Deck</dt>
                      <dd className="font-semibold break-words">{deck?.name ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-600">Attempts</dt>
                      <dd className="font-semibold tabular-nums">{weak.attempts}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-600">Last answered</dt>
                      <dd className="font-semibold">
                        {weak.lastAnsweredAt === null ? '—' : daysAgo(weak.lastAnsweredAt, now)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-600">Recent sessions</dt>
                      <dd className="flex gap-1">
                        {weak.recent.length === 0 ? (
                          <span className="text-gray-500">—</span>
                        ) : (
                          weak.recent.map((outcome, i) => (
                            <span
                              key={i}
                              className={`inline-flex h-5 w-5 items-center justify-center rounded text-xs font-bold ${OUTCOME[outcome].className}`}
                              title={OUTCOME[outcome].label}
                            >
                              <span aria-hidden="true">{OUTCOME[outcome].symbol}</span>
                              <span className="sr-only">{OUTCOME[outcome].label}</span>
                            </span>
                          ))
                        )}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      to={`/edit/${encodeURIComponent(weak.card.id)}`}
                      className={secondaryButton}
                    >
                      Open card
                    </Link>
                    {deck && (
                      <Link
                        to={`/decks/${encodeURIComponent(deck.id)}`}
                        className={secondaryButton}
                      >
                        Open deck
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {weakCards.length > SHOWN && (
            <button
              type="button"
              className={`${secondaryButton} mt-3`}
              onClick={() => setShowAll((value) => !value)}
              aria-expanded={showAll}
            >
              {showAll ? 'Show fewer' : `Show all ${weakCards.length} weak cards`}
            </button>
          )}
        </>
      )}
      <details className="mt-3 text-sm text-gray-600">
        <summary className="cursor-pointer text-indigo-700 hover:underline">
          How weak cards are chosen
        </summary>
        <p className="mt-2">
          A card is considered only after at least {WEAK_MIN_ATTEMPTS} answers, at least{' '}
          {WEAK_MIN_MISSES} of them wrong, so one slip never lists a card. It is then weak when
          fewer than {pct(WEAK_ACCURACY)} of its answers were right, or when it was missed in two of
          its last {WEAK_RECENT_SESSIONS} sessions. A card answered correctly in each of its last{' '}
          {WEAK_RECENT_SESSIONS} sessions is left off: you have learned it since. Review answers
          count from the card’s whole history; Quiz, Learn and Match answers count from recent
          sessions.
        </p>
      </details>
    </Section>
  );
}
