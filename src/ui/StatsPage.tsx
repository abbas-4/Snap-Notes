import { Link } from 'react-router';
import {
  countProgress,
  recentActivity,
  studyStats,
  timestampFromDayKey,
  upcomingReviews,
} from '../domain/progressStats';
import { useAppData } from './appData';
import { useProgress } from './progress';
import {
  cardsLabel,
  fullDate,
  percent,
  relativeDay,
  reviewsLabel,
  weekdayLabel,
} from './progressText';
import { StageChips, StatTile } from './ProgressSummary';
import ResetProgressPanel from './ResetProgressPanel';
import { primaryButton, secondaryButton } from './styles';
import { useNow } from './useNow';

/** How many days of activity the chart shows. */
const ACTIVITY_DAYS = 14;

/**
 * What the user's reviewing adds up to.
 *
 * Every figure is read from the saved records and the day-by-day activity log;
 * nothing here is estimated, and a collection that has never been reviewed
 * shows zeroes rather than an invented history.
 */
export default function StatsPage() {
  const { data } = useAppData();
  const { records, history, resetAll } = useProgress();
  const now = useNow(true, 60_000);

  const stats = studyStats(records, history, now);
  const counts = countProgress(data.cards, records, now);
  const activity = recentActivity(history, now, ACTIVITY_DAYS);
  const upcoming = upcomingReviews(records, now).filter((day) => day.count > 0);
  const busiest = Math.max(1, ...activity.map((day) => day.reviews));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Your progress</h1>
        <Link to="/review" className={primaryButton}>
          Back to review
        </Link>
      </div>

      {stats.totalReviews === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6">
          <h2 className="font-semibold">No reviews yet</h2>
          <p className="mt-1 text-sm text-gray-600">
            Your statistics appear here once you have reviewed a card. Nothing is estimated: every
            figure comes from the reviews you have actually done.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to="/review" className={primaryButton}>
              Start reviewing
            </Link>
            <Link to="/add" className={secondaryButton}>
              Add a card
            </Link>
          </div>
        </div>
      ) : (
        <>
          <section aria-labelledby="stats-totals-heading">
            <h2 id="stats-totals-heading" className="text-lg font-semibold">
              Reviewing
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <StatTile
                label="Reviews completed"
                value={String(stats.totalReviews)}
                hint={`${stats.correct} correct · ${stats.incorrect} missed`}
              />
              <StatTile
                label="Accuracy"
                value={percent(stats.accuracy)}
                hint="Across every answer"
              />
              <StatTile
                label="Reviewed today"
                value={reviewsLabel(stats.reviewsToday)}
                hint={counts.due > 0 ? `${counts.due} still due` : 'All caught up'}
              />
              <StatTile
                label="Current streak"
                value={`${stats.currentStreak} ${stats.currentStreak === 1 ? 'day' : 'days'}`}
                hint={stats.reviewsToday === 0 ? 'Review today to keep it' : 'Kept up today'}
              />
              <StatTile
                label="Longest streak"
                value={`${stats.longestStreak} ${stats.longestStreak === 1 ? 'day' : 'days'}`}
                hint="Your best run"
              />
              <StatTile
                label="Cards mastered"
                value={`${stats.cardsMastered} of ${counts.reviewable}`}
                hint="Scheduled three weeks or more ahead"
              />
            </div>
          </section>

          <section aria-labelledby="stats-stages-heading">
            <h2 id="stats-stages-heading" className="text-lg font-semibold">
              Your collection
            </h2>
            <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-600">
                {cardsLabel(counts.total)} in {data.decks.length}{' '}
                {data.decks.length === 1 ? 'deck' : 'decks'} · {percent(counts.mastery)} learned
              </p>
              <div className="mt-3">
                <StageChips counts={counts} />
              </div>
            </div>
          </section>

          <section aria-labelledby="stats-activity-heading">
            <h2 id="stats-activity-heading" className="text-lg font-semibold">
              Last {ACTIVITY_DAYS} days
            </h2>
            <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <ul className="flex items-end justify-between gap-1" aria-hidden="true">
                {activity.map((day) => {
                  const at = timestampFromDayKey(day.day) ?? now;
                  const height = day.reviews === 0 ? 4 : Math.round((day.reviews / busiest) * 72);
                  return (
                    <li key={day.day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                      <div
                        className={`w-full rounded-t ${day.reviews > 0 ? 'bg-indigo-600' : 'bg-gray-200'}`}
                        style={{ height: `${Math.max(4, height)}px` }}
                      />
                      <span className="truncate text-[10px] text-gray-500">
                        {weekdayLabel(at).slice(0, 1)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {/* The same figures as text, which is what a screen reader reads. */}
              <ul className="sr-only">
                {activity.map((day) => {
                  const at = timestampFromDayKey(day.day) ?? now;
                  return (
                    <li key={day.day}>
                      {fullDate(at)}: {reviewsLabel(day.reviews)}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-sm text-gray-600">
                {activity.reduce((total, day) => total + day.reviews, 0)} reviews in the last{' '}
                {ACTIVITY_DAYS} days.
              </p>
            </div>
          </section>

          <section aria-labelledby="stats-upcoming-heading">
            <h2 id="stats-upcoming-heading" className="text-lg font-semibold">
              Coming up
            </h2>
            <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              {upcoming.length === 0 ? (
                <p className="text-sm text-gray-600">
                  Nothing is scheduled in the next week.{' '}
                  {counts.newCards > 0 && `You have ${counts.newCards} new cards to start on.`}
                </p>
              ) : (
                <ul className="space-y-2">
                  {upcoming.map((day) => (
                    <li key={day.day} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-gray-700">
                        {relativeDay(day.at, now)} · {fullDate(day.at)}
                      </span>
                      <span className="font-semibold">{cardsLabel(day.count)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}

      <section aria-labelledby="stats-reset-heading">
        <h2 id="stats-reset-heading" className="text-lg font-semibold">
          Reset all learning progress
        </h2>
        <div className="mt-3">
          <ResetProgressPanel
            label="Reset all progress"
            question="Reset the learning progress for every card?"
            disabled={stats.totalReviews === 0 && history.length === 0}
            disabledHint="There is no learning progress to reset yet."
            onReset={resetAll}
            successMessage="All learning progress has been reset. Your cards and decks are unchanged."
          >
            This forgets every card’s review history, your streaks and these statistics, and starts
            every card again as new. Your cards, decks and settings are not touched.
          </ResetProgressPanel>
        </div>
      </section>
    </div>
  );
}
