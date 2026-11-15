import type { ReactNode } from 'react';
import type { Overview } from '../../domain/analytics';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BoltIcon,
  CardsIcon,
  CheckIcon,
  ClockIcon,
  CrossIcon,
  FlameIcon,
  SessionsIcon,
  TargetIcon,
  TrophyIcon,
} from './Icons';
import { count, pct, points, seconds, studyTime } from './format';
import Section from './Section';
import StatCard from './StatCard';

/** Compared with the period before: "+12 vs previous 30 days". */
function Change({ now, before, label }: { now: number; before: number; label: string }) {
  const diff = now - before;
  if (diff === 0) return <span>Same as the {label}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {diff > 0 ? <ArrowUpIcon /> : <ArrowDownIcon />}
      {diff > 0 ? '+' : '−'}
      {Math.abs(diff).toLocaleString()} vs the {label}
    </span>
  );
}

export default function OverviewSection({
  overview,
  periodName,
}: {
  overview: Overview;
  /** "last 30 days", "all time"… */
  periodName: string;
}) {
  const { totals, previous, accuracyTrend, streaks } = overview;
  const previousName = `previous ${overview.range.days} days`;

  let accuracyHint: ReactNode = 'Correct answers, all modes';
  if (accuracyTrend.direction !== 'insufficient' && accuracyTrend.change !== null) {
    accuracyHint = (
      <span className="inline-flex items-center gap-1">
        {accuracyTrend.direction === 'improving' ? (
          <ArrowUpIcon />
        ) : accuracyTrend.direction === 'declining' ? (
          <ArrowDownIcon />
        ) : null}
        {points(accuracyTrend.change)} vs the {previousName}
      </span>
    );
  }

  return (
    <Section
      id="overview"
      title="Overview"
      description={`How much and how well you studied, ${periodName}. Streaks always cover every day you have studied.`}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          index={0}
          label="Study sessions"
          value={totals.sessions.toLocaleString()}
          icon={<SessionsIcon />}
          hint={
            previous ? (
              <Change now={totals.sessions} before={previous.sessions} label={previousName} />
            ) : (
              `${count(totals.activeDays, 'day')} with study`
            )
          }
        />
        <StatCard
          index={1}
          label="Cards reviewed"
          value={totals.answered.toLocaleString()}
          icon={<CardsIcon />}
          hint={
            previous ? (
              <Change now={totals.answered} before={previous.answered} label={previousName} />
            ) : (
              'Answers in every mode'
            )
          }
        />
        <StatCard
          index={2}
          label="Correct answers"
          value={totals.correct.toLocaleString()}
          icon={<CheckIcon />}
          tone="bg-green-50 text-green-700"
          hint={totals.answered > 0 ? `${pct(totals.accuracy)} of answers` : 'None yet'}
        />
        <StatCard
          index={3}
          label="Missed answers"
          value={totals.incorrect.toLocaleString()}
          icon={<CrossIcon />}
          tone="bg-amber-50 text-amber-800"
          hint={totals.answered > 0 ? `${pct(1 - (totals.accuracy ?? 0))} of answers` : 'None yet'}
        />
        <StatCard
          index={4}
          label="Accuracy"
          value={pct(totals.accuracy)}
          icon={<TargetIcon />}
          hint={accuracyHint}
        />
        <StatCard
          index={5}
          label="Study time"
          value={studyTime(totals.studyMs)}
          icon={<ClockIcon />}
          hint={
            totals.untrackedAnswers > 0
              ? `Not known for ${count(totals.untrackedAnswers, 'older review')}`
              : 'Active time in sessions'
          }
        />
        <StatCard
          index={6}
          label="Average response"
          value={totals.averageResponseMs === null ? '—' : seconds(totals.averageResponseMs)}
          icon={<BoltIcon />}
          hint={
            totals.timedAnswers > 0
              ? `Over ${count(totals.timedAnswers, 'timed answer')}`
              : 'Timed in Review, Quiz and Learn'
          }
        />
        <StatCard
          index={7}
          label="Current streak"
          value={count(streaks.current, 'day')}
          icon={<FlameIcon />}
          tone="bg-orange-50 text-orange-700"
          hint={
            streaks.current > 0 && !streaks.studiedToday
              ? 'Study today to keep it'
              : streaks.studiedToday
                ? 'Kept up today'
                : 'Study today to start one'
          }
        />
        <StatCard
          index={8}
          className="col-span-2 sm:col-span-1"
          label="Longest streak"
          value={count(streaks.longest, 'day')}
          icon={<TrophyIcon />}
          tone="bg-yellow-50 text-yellow-800"
          hint={`${count(streaks.totalActiveDays, 'day')} studied in all`}
        />
      </div>
    </Section>
  );
}
