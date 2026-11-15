import { useId, useState, type KeyboardEvent } from 'react';
import type { Granularity, SeriesPoint } from '../../domain/analytics';
import { bucketLabel, bucketName, count, pct, studyTime } from './format';
import Section, { panel } from './Section';
import TrendChart from './TrendChart';

/** Mark colours (validated for colour-blind separation; text never uses them). */
const CORRECT = '#4f46e5';
const MISSED = '#f59e0b';
const NEUTRAL = '#4f46e5';

type Tab = 'reviewed' | 'accuracy' | 'time' | 'sessions';

const TABS: { id: Tab; label: string }[] = [
  { id: 'reviewed', label: 'Cards reviewed' },
  { id: 'accuracy', label: 'Accuracy' },
  { id: 'time', label: 'Study time' },
  { id: 'sessions', label: 'Sessions' },
];

const UNIT: Record<Granularity, string> = { day: 'day', week: 'week', month: 'month' };

export default function ProgressCharts({
  points: series,
  granularity,
  periodName,
}: {
  points: SeriesPoint[];
  granularity: Granularity;
  periodName: string;
}) {
  const [tab, setTab] = useState<Tab>('reviewed');
  const baseId = useId();
  const labels = series.map((p) => bucketLabel(p.start, granularity));
  const names = series.map((p) => bucketName(p.start, p.end, granularity));
  const unit = UNIT[granularity];

  const answered = series.reduce((sum, p) => sum + p.answered, 0);
  const busiest = series.reduce<SeriesPoint | null>(
    (best, p) => (p.answered > (best?.answered ?? 0) ? p : best),
    null,
  );
  const correct = series.reduce((sum, p) => sum + p.correct, 0);
  const accuracies = series.flatMap((p) => (p.accuracy === null ? [] : [p.accuracy]));
  const lowest = accuracies.length > 0 ? Math.min(...accuracies) : null;
  const highest = accuracies.length > 0 ? Math.max(...accuracies) : null;
  const studyMs = series.reduce((sum, p) => sum + p.studyMs, 0);
  const sessions = series.reduce((sum, p) => sum + p.sessions, 0);
  const untracked = series.reduce((sum, p) => sum + p.untrackedAnswers, 0);

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = TABS[next] as (typeof TABS)[number];
    setTab(target.id);
    document.getElementById(`${baseId}-tab-${target.id}`)?.focus();
  }

  let chart;
  if (tab === 'reviewed') {
    chart = (
      <TrendChart
        kind="bar"
        title={`Cards reviewed per ${unit}`}
        summary={
          answered === 0
            ? `No answers recorded ${periodName}.`
            : `${count(answered, 'answer')} ${periodName}${busiest ? `; the busiest ${unit} was ${bucketName(busiest.start, busiest.end, granularity)} with ${busiest.answered.toLocaleString()}` : ''}.`
        }
        labels={labels}
        names={names}
        series={[
          {
            key: 'correct',
            label: 'Correct',
            color: CORRECT,
            values: series.map((p) => p.correct),
          },
          { key: 'missed', label: 'Missed', color: MISSED, values: series.map((p) => p.incorrect) },
        ]}
        formatValue={(v) => Math.round(v).toLocaleString()}
        details={(i) => {
          const p = series[i];
          return p ? [`${pct(p.accuracy)} correct`, count(p.sessions, 'session')] : [];
        }}
      />
    );
  } else if (tab === 'accuracy') {
    chart = (
      <TrendChart
        kind="line"
        title={`Accuracy per ${unit}`}
        summary={
          answered === 0
            ? `No answers recorded ${periodName}.`
            : `${pct(correct / answered)} of answers were right ${periodName}, ranging from ${pct(lowest)} to ${pct(highest)} per ${unit}. Gaps are ${unit}s without answers.`
        }
        labels={labels}
        names={names}
        series={[
          {
            key: 'accuracy',
            label: 'Correct',
            color: NEUTRAL,
            values: series.map((p) => p.accuracy),
          },
        ]}
        formatValue={(v) => pct(v)}
        max={1}
        details={(i) => {
          const p = series[i];
          return p ? [`${count(p.answered, 'answer')}`] : [];
        }}
      />
    );
  } else if (tab === 'time') {
    chart = (
      <TrendChart
        kind="bar"
        title={`Study time per ${unit}`}
        summary={`${studyTime(studyMs)} of active study ${periodName}.${untracked > 0 ? ` Time is not known for ${count(untracked, 'review')} recorded before sessions were tracked.` : ''}`}
        labels={labels}
        names={names}
        series={[
          {
            key: 'minutes',
            label: 'Minutes',
            color: NEUTRAL,
            values: series.map((p) => Math.round(p.studyMs / 60_000)),
          },
        ]}
        formatValue={(v) => `${Math.round(v)} min`}
      />
    );
  } else {
    chart = (
      <TrendChart
        kind="bar"
        title={`Study sessions per ${unit}`}
        summary={`${count(sessions, 'session')} ${periodName}.`}
        labels={labels}
        names={names}
        series={[
          {
            key: 'sessions',
            label: 'Sessions',
            color: NEUTRAL,
            values: series.map((p) => p.sessions),
          },
        ]}
        formatValue={(v) => Math.round(v).toLocaleString()}
      />
    );
  }

  return (
    <Section
      id="progress"
      title="Progress over time"
      description={`Your study activity ${periodName}, by ${unit}.`}
    >
      <div className={panel}>
        <div
          role="tablist"
          aria-label="Chart"
          className="flex flex-wrap gap-1 border-b border-gray-100 pb-3"
        >
          {TABS.map((item, index) => (
            <button
              key={item.id}
              id={`${baseId}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`${baseId}-panel`}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => setTab(item.id)}
              onKeyDown={(event) => onTabKey(event, index)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
                tab === item.id
                  ? 'bg-indigo-100 text-indigo-900'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div
          id={`${baseId}-panel`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${tab}`}
          className="mt-4"
        >
          {chart}
        </div>
      </div>
    </Section>
  );
}
