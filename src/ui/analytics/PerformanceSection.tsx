import type { ModeTotals, RetentionEstimate, Trend } from '../../domain/analytics';
import { MODE_LABELS, count, pct, points, studyTime } from './format';
import Section, { panel } from './Section';

function trendSentence(trend: Trend, previousName: string | null): string {
  if (previousName === null) {
    return 'Pick a 7, 30 or 90 day period to compare with the one before it.';
  }
  if (trend.direction === 'insufficient' || trend.change === null) {
    return `Not enough answers to compare with the ${previousName} yet (at least 10 in each is needed).`;
  }
  const change = points(trend.change);
  if (trend.direction === 'improving') {
    return `Improving: ${pct(trend.later)} correct, up from ${pct(trend.earlier)} in the ${previousName} (${change}).`;
  }
  if (trend.direction === 'declining') {
    return `Slipping: ${pct(trend.later)} correct, down from ${pct(trend.earlier)} in the ${previousName} (${change}).`;
  }
  return `Steady: ${pct(trend.later)} correct, against ${pct(trend.earlier)} in the ${previousName}.`;
}

const STAGES = [
  { key: 'newCards', label: 'New', color: 'bg-gray-300' },
  { key: 'learning', label: 'Learning', color: 'bg-amber-400' },
  { key: 'review', label: 'Reviewing', color: 'bg-indigo-400' },
  { key: 'mastered', label: 'Mastered', color: 'bg-indigo-700' },
] as const;

export default function PerformanceSection({
  modes,
  trend,
  previousName,
  retention,
  periodName,
}: {
  modes: ModeTotals[];
  trend: Trend;
  previousName: string | null;
  retention: RetentionEstimate;
  periodName: string;
}) {
  const { counts } = retention;
  const total = Math.max(1, counts.reviewable);
  return (
    <Section
      id="performance"
      title="Learning performance"
      description="How accurately you answer, kept separate from what your review schedule estimates you remember."
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className={panel}>
          <h3 className="font-semibold">Observed accuracy</h3>
          <p className="mt-0.5 text-sm text-gray-600">Measured from your answers {periodName}.</p>
          <p className="mt-3 text-sm text-gray-800">{trendSentence(trend, previousName)}</p>
          <table className="mt-3 w-full text-left text-sm">
            <caption className="sr-only">Answers by study mode, {periodName}</caption>
            <thead className="text-gray-600">
              <tr>
                <th scope="col" className="py-1 font-medium">
                  Mode
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Answers
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Accuracy
                </th>
                <th scope="col" className="hidden py-1 text-right font-medium sm:table-cell">
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {modes.map((mode) => (
                <tr key={mode.mode} className="border-t border-gray-100">
                  <th scope="row" className="py-1.5 font-normal">
                    {MODE_LABELS[mode.mode]}
                  </th>
                  <td className="py-1.5 text-right tabular-nums">
                    {mode.answered.toLocaleString()}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{pct(mode.accuracy)}</td>
                  <td className="hidden py-1.5 text-right tabular-nums sm:table-cell">
                    {mode.sessions > 0 ? studyTime(mode.studyMs) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-gray-500">
            Accuracy shows how you answered, not how much you will remember later. Quiz and Match
            answers can be helped by recognising the choices.
          </p>
        </div>

        <div className={panel}>
          <h3 className="font-semibold">Estimated memory strength</h3>
          <p className="mt-0.5 text-sm text-gray-600">
            An estimate from your spaced repetition schedule, not a measurement.
          </p>
          {counts.reviewable === 0 ? (
            <p className="mt-3 text-sm text-gray-600">
              Add cards with a term and a definition to see where they stand.
            </p>
          ) : (
            <>
              <div
                className="mt-4 flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
                aria-hidden="true"
              >
                {STAGES.map((stage) =>
                  counts[stage.key] > 0 ? (
                    <div
                      key={stage.key}
                      className={stage.color}
                      style={{ width: `${(counts[stage.key] / total) * 100}%` }}
                    />
                  ) : null,
                )}
              </div>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {STAGES.map((stage) => (
                  <li key={stage.key} className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-sm ${stage.color}`} aria-hidden="true" />
                    <span className="text-gray-700">{stage.label}</span>
                    <span className="ml-auto font-semibold tabular-nums">
                      {counts[stage.key].toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-gray-600">Recall in Review (observed)</dt>
                  <dd className="font-semibold">
                    {retention.reviewAnswered > 0
                      ? `${pct(retention.reviewAccuracy)} of ${count(retention.reviewAnswered, 'answer')}`
                      : 'No reviews yet'}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-600">Average interval</dt>
                  <dd className="font-semibold">
                    {retention.averageIntervalDays === null
                      ? '—'
                      : count(Math.round(retention.averageIntervalDays), 'day')}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-600">Overdue, at risk</dt>
                  <dd className="font-semibold">{count(counts.overdue, 'card')}</dd>
                </div>
                <div>
                  <dt className="text-gray-600">Learned overall</dt>
                  <dd className="font-semibold">{pct(counts.mastery)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-gray-500">
                Mastered cards are scheduled three weeks or more ahead. The schedule only knows how
                you answered in Review, so treat these figures as a guide.
              </p>
            </>
          )}
        </div>
      </div>
    </Section>
  );
}
