import { useId, useState } from 'react';
import {
  NO_HISTORY_FILTER,
  paginate,
  performanceBand,
  studyHistory,
  type AnalyticsBase,
  type HistoryEntry,
  type HistoryFilter,
  type PerformanceBand,
} from '../../domain/analytics';
import { timestampFromDayKey } from '../../domain/progressStats';
import { secondaryButton, selectField, textField } from '../styles';
import { MODE_LABELS, count, longDate, pct, studyTime, timeOfDay } from './format';
import Section, { panel } from './Section';

const PAGE_SIZE = 10;

const BANDS: { id: PerformanceBand; label: string }[] = [
  { id: 'all', label: 'Any accuracy' },
  { id: 'strong', label: 'Strong (80% or more)' },
  { id: 'fair', label: 'Fair (50–79%)' },
  { id: 'weak', label: 'Weak (under 50%)' },
];

const BAND_STYLE = {
  strong: 'bg-green-100 text-green-900',
  fair: 'bg-amber-100 text-amber-900',
  weak: 'bg-red-100 text-red-900',
} as const;

function deckLabel(entry: HistoryEntry, base: AnalyticsBase): string {
  if (entry.deckDeleted) return 'Deleted deck';
  if (entry.session.deckId !== null) {
    return base.decks.get(entry.session.deckId)?.name ?? 'Deleted deck';
  }
  const names = entry.deckIds.map((id) => base.decks.get(id)?.name).filter(Boolean);
  if (names.length === 0) return 'All decks';
  if (names.length === 1) return `All decks (${names[0]})`;
  return `All decks (${names.length} decks)`;
}

export default function HistorySection({
  base,
  untrackedDays,
}: {
  base: AnalyticsBase;
  /** Days of Review answers recorded before sessions were. */
  untrackedDays: number;
}) {
  const [filter, setFilter] = useState<HistoryFilter>(NO_HISTORY_FILTER);
  const [page, setPage] = useState(1);
  const ids = { from: useId(), to: useId(), deck: useId(), band: useId() };

  const update = (change: Partial<HistoryFilter>) => {
    setFilter((current) => ({ ...current, ...change }));
    setPage(1);
  };

  const invalidRange = filter.from !== null && filter.to !== null && filter.from > filter.to;
  const entries = invalidRange ? [] : studyHistory(base, filter);
  const current = paginate(entries, page, PAGE_SIZE);
  const filtered =
    filter.from !== null ||
    filter.to !== null ||
    filter.deckId !== null ||
    filter.performance !== 'all';
  const decks = [...base.decks.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Section
      id="history"
      title="Study history"
      description="Every recorded study session, newest first."
    >
      <div className={panel}>
        <fieldset>
          <legend className="sr-only">Filter study history</legend>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label htmlFor={ids.from} className="block text-sm font-medium text-gray-700">
                From
              </label>
              <input
                id={ids.from}
                type="date"
                className={`${textField} mt-1 py-1.5 text-sm`}
                value={filter.from ?? ''}
                max={filter.to ?? undefined}
                onChange={(event) => update({ from: event.target.value || null })}
              />
            </div>
            <div>
              <label htmlFor={ids.to} className="block text-sm font-medium text-gray-700">
                To
              </label>
              <input
                id={ids.to}
                type="date"
                className={`${textField} mt-1 py-1.5 text-sm`}
                value={filter.to ?? ''}
                min={filter.from ?? undefined}
                onChange={(event) => update({ to: event.target.value || null })}
              />
            </div>
            <div>
              <label htmlFor={ids.deck} className="block text-sm font-medium text-gray-700">
                Deck
              </label>
              <select
                id={ids.deck}
                className={`${selectField} mt-1 w-full py-1.5 text-sm`}
                value={filter.deckId ?? ''}
                onChange={(event) => update({ deckId: event.target.value || null })}
              >
                <option value="">Every deck</option>
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={ids.band} className="block text-sm font-medium text-gray-700">
                Performance
              </label>
              <select
                id={ids.band}
                className={`${selectField} mt-1 w-full py-1.5 text-sm`}
                value={filter.performance}
                onChange={(event) => update({ performance: event.target.value as PerformanceBand })}
              >
                {BANDS.map((band) => (
                  <option key={band.id} value={band.id}>
                    {band.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>
        {filtered && (
          <button
            type="button"
            className="mt-2 text-sm font-semibold text-indigo-700 hover:underline"
            onClick={() => update(NO_HISTORY_FILTER)}
          >
            Clear filters
          </button>
        )}
        {invalidRange && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            The start date is after the end date.
          </p>
        )}

        <p className="mt-3 text-sm text-gray-600" aria-live="polite">
          {entries.length === 0
            ? filtered
              ? 'No sessions match these filters.'
              : 'No sessions recorded yet. Every Review, Quiz, Learn and Match session you finish an answer in will be listed here.'
            : `${count(entries.length, 'session')}${filtered ? ' match' : ''}.`}
        </p>

        {current.items.length > 0 && (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Study sessions, page {current.page}</caption>
              <thead className="text-gray-600">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    Session
                  </th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                    Cards
                  </th>
                  <th
                    scope="col"
                    className="hidden py-1.5 pr-3 text-right font-medium sm:table-cell"
                  >
                    Correct
                  </th>
                  <th
                    scope="col"
                    className="hidden py-1.5 pr-3 text-right font-medium sm:table-cell"
                  >
                    Missed
                  </th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                    Accuracy
                  </th>
                  <th scope="col" className="hidden py-1.5 text-right font-medium md:table-cell">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody>
                {current.items.map((entry) => {
                  const { session } = entry;
                  const band = performanceBand(entry.accuracy);
                  const day = timestampFromDayKey(session.day) ?? session.startedAt;
                  return (
                    <tr key={session.id} className="border-t border-gray-100 align-top">
                      <th scope="row" className="py-2 pr-3 font-normal">
                        <span className="block font-medium text-gray-900">
                          {longDate(day)}, {timeOfDay(session.startedAt)}
                        </span>
                        <span className="block text-gray-600">
                          {MODE_LABELS[session.mode]} · {deckLabel(entry, base)}
                        </span>
                        <span className="block text-gray-500 sm:hidden">
                          {session.correct} correct · {entry.incorrect} missed
                        </span>
                      </th>
                      <td className="py-2 pr-3 text-right tabular-nums">{session.answered}</td>
                      <td className="hidden py-2 pr-3 text-right tabular-nums sm:table-cell">
                        {session.correct}
                      </td>
                      <td className="hidden py-2 pr-3 text-right tabular-nums sm:table-cell">
                        {entry.incorrect}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${band ? BAND_STYLE[band] : ''}`}
                        >
                          {pct(entry.accuracy)}
                        </span>
                      </td>
                      <td className="hidden py-2 text-right tabular-nums md:table-cell">
                        {studyTime(session.durationMs)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {current.pages > 1 && (
          <nav
            aria-label="Study history pages"
            className="mt-3 flex items-center justify-between gap-3"
          >
            <button
              type="button"
              className={secondaryButton}
              disabled={current.page <= 1}
              onClick={() => setPage(current.page - 1)}
            >
              Newer
            </button>
            <p className="text-sm text-gray-600">
              Page {current.page} of {current.pages}
            </p>
            <button
              type="button"
              className={secondaryButton}
              disabled={current.page >= current.pages}
              onClick={() => setPage(current.page + 1)}
            >
              Older
            </button>
          </nav>
        )}

        {untrackedDays > 0 && (
          <p className="mt-3 text-xs text-gray-500">
            Reviews from {count(untrackedDays, 'day')} were saved before sessions were recorded,
            only as daily totals. They count in the charts, streaks and totals, but are not listed
            here and have no recorded time.
          </p>
        )}
      </div>
    </Section>
  );
}
