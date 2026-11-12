import type { ProgressCounts } from '../domain/progressStats';
import ProgressBar from './ProgressBar';
import { percent } from './progressText';

/** One figure with its label, used for the rows of counts on the review and stats pages. */
export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-600">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-sm text-gray-500">{hint}</p>}
    </div>
  );
}

/** The four states a card can be in, in the order it passes through them. */
export function StageChips({ counts }: { counts: ProgressCounts }) {
  const chips = [
    { label: 'New', value: counts.newCards, className: 'bg-gray-100 text-gray-800' },
    { label: 'Learning', value: counts.learning, className: 'bg-amber-100 text-amber-900' },
    { label: 'Reviewing', value: counts.review, className: 'bg-indigo-100 text-indigo-900' },
    { label: 'Mastered', value: counts.mastered, className: 'bg-green-100 text-green-900' },
  ];
  return (
    <ul className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li
          key={chip.label}
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${chip.className}`}
        >
          {chip.label} {chip.value}
        </li>
      ))}
    </ul>
  );
}

/**
 * How far a deck has come, for the deck list and the deck page. The deck's
 * card count is shown by the page itself, so this adds only what reviewing
 * knows: how much is learned, what is waiting, and where the cards stand.
 */
export function DeckProgressLine({ counts }: { counts: ProgressCounts }) {
  if (counts.reviewable === 0) {
    return (
      <p className="text-sm text-gray-500">
        Nothing to review yet — a card needs both a term and a definition.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600">
        <span>{percent(counts.mastery)} learned</span>
        {counts.due > 0 && (
          <>
            {' · '}
            <strong className="text-indigo-800">{counts.due} due</strong>
          </>
        )}
      </p>
      <ProgressBar
        value={Math.round(counts.mastery * 100)}
        max={100}
        label={`Learning progress: ${percent(counts.mastery)}`}
      />
      <StageChips counts={counts} />
    </div>
  );
}
