import { useState } from 'react';
import { Link } from 'react-router';
import {
  sortDecks,
  strongestAndWeakest,
  type DeckPerformance,
  type DeckSort,
} from '../../domain/analytics';
import { selectField, secondaryButton } from '../styles';
import { ArrowDownIcon, ArrowUpIcon } from './Icons';
import { count, daysAgo, pct, points } from './format';
import Section, { panel } from './Section';

const SORTS: { id: string; label: string; sort: DeckSort; direction: 'asc' | 'desc' }[] = [
  { id: 'accuracy-desc', label: 'Highest accuracy', sort: 'accuracy', direction: 'desc' },
  { id: 'accuracy-asc', label: 'Lowest accuracy', sort: 'accuracy', direction: 'asc' },
  { id: 'reviewed-desc', label: 'Most cards reviewed', sort: 'reviewed', direction: 'desc' },
  { id: 'reviewed-asc', label: 'Fewest cards reviewed', sort: 'reviewed', direction: 'asc' },
  { id: 'recent-desc', label: 'Most recently studied', sort: 'recent', direction: 'desc' },
  { id: 'name-asc', label: 'Name', sort: 'name', direction: 'asc' },
];

/** Accuracy bands, each with its own colour and word, so colour is never the only signal. */
function band(accuracy: number | null): { label: string; bar: string; text: string } | null {
  if (accuracy === null) return null;
  if (accuracy >= 0.8) return { label: 'Strong', bar: 'bg-green-600', text: 'text-green-800' };
  if (accuracy >= 0.5) return { label: 'Fair', bar: 'bg-amber-500', text: 'text-amber-800' };
  return { label: 'Weak', bar: 'bg-red-600', text: 'text-red-800' };
}

function Sparkline({ values, deckName }: { values: number[]; deckName: string }) {
  const top = Math.max(1, ...values);
  const active = values.filter((v) => v > 0).length;
  return (
    <div>
      <div className="flex h-6 items-end gap-0.5" aria-hidden="true">
        {values.map((value, i) => (
          <div
            key={i}
            className={`w-1.5 rounded-t-sm ${value > 0 ? 'bg-indigo-500' : 'bg-gray-200'}`}
            style={{ height: `${value > 0 ? Math.max(20, (value / top) * 100) : 12}%` }}
          />
        ))}
      </div>
      <p className="sr-only">
        {deckName}: studied on {count(active, 'day')} of the last {values.length}.
      </p>
    </div>
  );
}

function DeckRow({
  deck,
  now,
  badge,
}: {
  deck: DeckPerformance;
  now: number;
  badge: 'strongest' | 'weakest' | null;
}) {
  const level = band(deck.accuracy);
  const { trend } = deck;
  return (
    <li className={`${panel} motion-safe:animate-rise`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 font-semibold">
            <Link to={`/decks/${encodeURIComponent(deck.deck.id)}`} className="hover:underline">
              {deck.deck.name}
            </Link>
            {badge === 'strongest' && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-900">
                Strongest
              </span>
            )}
            {badge === 'weakest' && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">
                Needs attention
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-sm text-gray-600">
            {deck.cards === 0
              ? 'No cards yet'
              : `${count(deck.cards, 'card')} · ${deck.cardsStudied.toLocaleString()} studied · ${pct(deck.counts.mastery)} learned`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`/decks/${encodeURIComponent(deck.deck.id)}`} className={secondaryButton}>
            Open deck
          </Link>
        </div>
      </div>

      {deck.cards === 0 ? (
        <p className="mt-3 text-sm text-gray-500">Add cards to this deck to start tracking it.</p>
      ) : deck.answered === 0 ? (
        <p className="mt-3 text-sm text-gray-500">
          Not studied in this period
          {deck.lastStudiedAt !== null ? `; last studied ${daysAgo(deck.lastStudiedAt, now)}` : ''}.
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
              <div
                className={`h-full rounded-full ${level?.bar ?? 'bg-gray-300'} transition-[width] duration-500`}
                style={{ width: `${Math.round((deck.accuracy ?? 0) * 100)}%` }}
              />
            </div>
            <p className={`w-28 shrink-0 text-right text-sm font-semibold ${level?.text ?? ''}`}>
              {pct(deck.accuracy)} · {level?.label}
            </p>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-gray-600">Answers</dt>
              <dd className="font-semibold tabular-nums">{deck.answered.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-gray-600">Correct / missed</dt>
              <dd className="font-semibold tabular-nums">
                {deck.correct.toLocaleString()} / {deck.incorrect.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-gray-600">Last studied</dt>
              <dd className="font-semibold">
                {deck.lastStudiedAt === null ? '—' : daysAgo(deck.lastStudiedAt, now)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-600">Trend, 2 weeks</dt>
              <dd className="flex items-center gap-1 font-semibold">
                {trend.direction === 'improving' && (
                  <>
                    <ArrowUpIcon className="h-4 w-4 text-green-700" /> Improving{' '}
                    {trend.change !== null && points(trend.change)}
                  </>
                )}
                {trend.direction === 'declining' && (
                  <>
                    <ArrowDownIcon className="h-4 w-4 text-red-700" /> Declining{' '}
                    {trend.change !== null && points(trend.change)}
                  </>
                )}
                {trend.direction === 'steady' && 'Steady'}
                {trend.direction === 'insufficient' && (
                  <span className="font-normal text-gray-500">Not enough answers</span>
                )}
              </dd>
            </div>
          </dl>
        </>
      )}
      {deck.cards > 0 && (
        <div className="mt-3 flex items-end justify-between gap-3 border-t border-gray-100 pt-3">
          <div>
            <p className="text-xs text-gray-500">Last 14 days</p>
            <Sparkline values={deck.recentActivity} deckName={deck.deck.name} />
          </div>
          {deck.counts.due > 0 && (
            <Link
              to={`/review?mode=due&deck=${encodeURIComponent(deck.deck.id)}`}
              className="text-sm font-semibold text-indigo-700 hover:underline"
            >
              Review {count(deck.counts.due, 'due card')}
            </Link>
          )}
        </div>
      )}
    </li>
  );
}

export default function DeckSection({
  decks,
  now,
  periodName,
  lifetimeReviews,
}: {
  decks: DeckPerformance[];
  now: number;
  periodName: string;
  /** "All time" counts Review answers from each card's lifetime record. */
  lifetimeReviews: boolean;
}) {
  const [sortId, setSortId] = useState('accuracy-desc');
  const choice = SORTS.find((s) => s.id === sortId) ?? (SORTS[0] as (typeof SORTS)[number]);
  const sorted = sortDecks(decks, choice.sort, choice.direction);
  const { strongest, weakest } = strongestAndWeakest(decks);

  return (
    <Section
      id="decks"
      title="Deck performance"
      description={
        lifetimeReviews
          ? 'Every answer, in every deck. Review answers include those from before sessions were recorded.'
          : `Answers in each deck, ${periodName}. Answers follow their card if it moves deck.`
      }
      actions={
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Sort by
          <select
            className={`${selectField} py-1.5 text-sm`}
            value={sortId}
            onChange={(event) => setSortId(event.target.value)}
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      }
    >
      {strongest && weakest && (
        <p className="mb-3 text-sm text-gray-700">
          Strongest: <strong>{strongest.deck.name}</strong> ({pct(strongest.accuracy)}). Needs the
          most attention: <strong>{weakest.deck.name}</strong> ({pct(weakest.accuracy)}).
        </p>
      )}
      <ul className="space-y-3" aria-label="Decks">
        {sorted.map((deck) => (
          <DeckRow
            key={deck.deck.id}
            deck={deck}
            now={now}
            badge={deck === strongest ? 'strongest' : deck === weakest ? 'weakest' : null}
          />
        ))}
      </ul>
    </Section>
  );
}
