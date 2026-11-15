import { useEffect, useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import {
  activityHeatmap,
  activitySeries,
  cardPerformance,
  deckPerformance,
  findWeakCards,
  goalProgress,
  granularityFor,
  isAnalyticsPeriod,
  modeBreakdown,
  overview,
  retentionEstimate,
  untrackedDays,
  weeklySummaries,
  type AnalyticsPeriod,
} from '../../domain/analytics';
import { countProgress } from '../../domain/progressStats';
import { recommend } from '../../domain/recommendations';
import { dayKey } from '../../domain/srs';
import { useOptionalSync } from '../account/cloud';
import { useStudyLog } from '../studyLog';
import { useAnalyticsBase } from '../useAnalytics';
import { useNow } from '../useNow';
import ActivitySection from './ActivitySection';
import AnalyticsErrorBoundary from './AnalyticsErrorBoundary';
import DeckSection from './DeckSection';
import GoalsSection from './GoalsSection';
import HistorySection from './HistorySection';
import OverviewSection from './OverviewSection';
import PerformanceSection from './PerformanceSection';
import ProgressCharts from './ProgressCharts';
import RecommendationsSection from './RecommendationsSection';
import WeakCardsSection from './WeakCardsSection';

const PERIOD_PARAM = 'period';
const DEFAULT_PERIOD: AnalyticsPeriod = '30d';

const PERIOD_OPTIONS: { id: AnalyticsPeriod; label: string; name: string }[] = [
  { id: '7d', label: '7 days', name: 'in the last 7 days' },
  { id: '30d', label: '30 days', name: 'in the last 30 days' },
  { id: '90d', label: '90 days', name: 'in the last 90 days' },
  { id: 'all', label: 'All time', name: 'since you started' },
];

const SECTIONS = [
  { id: 'recommendations', label: 'Next steps' },
  { id: 'overview', label: 'Overview' },
  { id: 'progress', label: 'Progress' },
  { id: 'performance', label: 'Performance' },
  { id: 'decks', label: 'Decks' },
  { id: 'weak-cards', label: 'Weak cards' },
  { id: 'activity', label: 'Activity' },
  { id: 'goals', label: 'Goals' },
  { id: 'history', label: 'History' },
];

function scrollToSection(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  element.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  element.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

/**
 * Learning analytics, from the user's own data. Every figure is worked out by
 * the pure functions in `domain/analytics.ts`; this page only chooses the
 * period and lays the results out.
 */
export default function AnalyticsPage() {
  return (
    <AnalyticsErrorBoundary>
      <AnalyticsDashboard />
    </AnalyticsErrorBoundary>
  );
}

function AnalyticsDashboard() {
  const [params, setParams] = useSearchParams();
  const requested = params.get(PERIOD_PARAM);
  const period: AnalyticsPeriod = isAnalyticsPeriod(requested) ? requested : DEFAULT_PERIOD;
  const option = PERIOD_OPTIONS.find((p) => p.id === period) ?? PERIOD_OPTIONS[1]!;
  const { goals, setGoal } = useStudyLog();
  const sync = useOptionalSync();
  const { hash } = useLocation();

  // Refreshed every minute, so "today" moves on at midnight; the figures only
  // change when the day or the data does.
  const clock = useNow(true, 60_000);
  const today = dayKey(clock);
  const base = useAnalyticsBase();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed per day, not per tick
  const now = useMemo(() => clock, [today, base]);

  const figures = useMemo(() => {
    const summary = overview(base, period, now);
    const granularity = granularityFor(summary.range);
    const performance = cardPerformance(base);
    const weakCards = findWeakCards(performance);
    const decks = deckPerformance(base, period, now);
    const goalsProgress = goalProgress(base, now);
    const counts = countProgress(base.input.data.cards, base.input.records, now);
    const totalAnswered = base.activeDays.reduce((sum, day) => sum + day.answered, 0);
    return {
      summary,
      granularity,
      series: activitySeries(base, summary.range, granularity),
      modes: modeBreakdown(base, summary.range),
      retention: retentionEstimate(base, summary.range, now),
      decks,
      weakCards,
      goalsProgress,
      heatmap: activityHeatmap(base, now),
      weeks: weeklySummaries(base, now),
      untracked: untrackedDays(base),
      recommendations: recommend({
        now,
        counts,
        streaks: summary.streaks,
        decks,
        weakCards,
        goals: goalsProgress,
        totalAnswered,
      }),
      hasActivity: totalAnswered > 0,
    };
  }, [base, now, period]);

  // `#/analytics#weak-cards` and similar links land on their section.
  useEffect(() => {
    const id = hash.replace(/^#/, '');
    if (id && SECTIONS.some((section) => section.id === id)) scrollToSection(id);
  }, [hash]);

  function choosePeriod(next: AnalyticsPeriod) {
    const updated = new URLSearchParams(params);
    if (next === DEFAULT_PERIOD) updated.delete(PERIOD_PARAM);
    else updated.set(PERIOD_PARAM, next);
    setParams(updated, { replace: true });
  }

  const syncing = sync !== null && (sync.status === 'syncing' || sync.status === 'linking');
  const signedIn =
    sync !== null && !['disabled', 'signed-out', 'session-expired'].includes(sync.status);
  const previousName = period === 'all' ? null : `previous ${figures.summary.range.days} days`;

  return (
    <div className="space-y-10">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
            <p className="mt-0.5 text-sm text-gray-600">
              Worked out from what you have actually studied. Nothing here is invented.
            </p>
          </div>
          <div role="status" className="text-sm text-gray-600">
            {syncing && (
              <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-indigo-900">
                <span className="h-2 w-2 rounded-full bg-indigo-500 motion-safe:animate-pulse" />
                Updating from your other devices…
              </span>
            )}
          </div>
        </div>

        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">Period</legend>
          {PERIOD_OPTIONS.map((p) => (
            <label
              key={p.id}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-indigo-600 ${
                period === p.id
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="analytics-period"
                className="sr-only"
                value={p.id}
                checked={period === p.id}
                onChange={() => choosePeriod(p.id)}
                aria-label={p.id === 'all' ? 'All time' : `Last ${p.label}`}
              />
              {p.label}
            </label>
          ))}
        </fieldset>

        <nav aria-label="Analytics sections" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-indigo-600"
              onClick={() => scrollToSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </nav>
      </header>

      <RecommendationsSection result={figures.recommendations} />

      {figures.hasActivity ? (
        <>
          <OverviewSection overview={figures.summary} periodName={option.name} />
          <ProgressCharts
            points={figures.series}
            granularity={figures.granularity}
            periodName={option.name}
          />
          <PerformanceSection
            modes={figures.modes}
            trend={figures.summary.accuracyTrend}
            previousName={previousName}
            retention={figures.retention}
            periodName={option.name}
          />
        </>
      ) : (
        <section
          id="overview"
          aria-labelledby="overview-heading"
          className="rounded-xl border border-dashed border-gray-300 bg-white p-6"
        >
          <h2 id="overview-heading" className="text-lg font-semibold">
            No study activity yet
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Your statistics, charts and activity calendar appear here as soon as you answer a card
            in Review, Quiz, Learn or Match. Every figure comes from what you actually study: a
            collection that has never been studied shows nothing rather than invented numbers.
          </p>
        </section>
      )}

      <DeckSection
        decks={figures.decks}
        now={now}
        periodName={option.name}
        lifetimeReviews={period === 'all'}
      />

      {figures.hasActivity && (
        <>
          <WeakCardsSection weakCards={figures.weakCards} decks={base.decks} now={now} />
          <ActivitySection
            heatmap={figures.heatmap}
            streaks={figures.summary.streaks}
            weeks={figures.weeks}
          />
        </>
      )}

      <GoalsSection
        goals={goals}
        progress={figures.goalsProgress}
        onSave={(kind, target) => setGoal(kind, target)}
        synced={signedIn}
      />

      {figures.hasActivity && <HistorySection base={base} untrackedDays={figures.untracked} />}
    </div>
  );
}
