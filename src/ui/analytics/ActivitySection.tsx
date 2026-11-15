import { useEffect, useRef, useState } from 'react';
import type { HeatmapCell, StreakSummary, WeekSummary } from '../../domain/analytics';
import { count, longDate, pct, shortDate, studyTime } from './format';
import Section, { panel } from './Section';

const LEVELS = ['bg-gray-100', 'bg-indigo-200', 'bg-indigo-400', 'bg-indigo-600', 'bg-indigo-800'];
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

export default function ActivitySection({
  heatmap,
  streaks,
  weeks,
}: {
  heatmap: HeatmapCell[][];
  streaks: StreakSummary;
  weeks: WeekSummary[];
}) {
  const [hovered, setHovered] = useState<HeatmapCell | null>(null);
  // On a narrow screen the calendar scrolls sideways; it opens on the latest weeks.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, []);
  const cells = heatmap.flat().filter((cell) => !cell.future);
  const activeInYear = cells.filter((cell) => cell.answered > 0).length;

  return (
    <Section
      id="activity"
      title="Study activity"
      description="Every day you studied over the last year. A day counts once you answer at least one card, in any mode."
    >
      <div className={panel}>
        <dl className="grid grid-cols-3 gap-3 text-center">
          <div>
            <dt className="text-sm text-gray-600">Current streak</dt>
            <dd className="text-xl font-bold">{count(streaks.current, 'day')}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-600">Longest streak</dt>
            <dd className="text-xl font-bold">{count(streaks.longest, 'day')}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-600">Days studied</dt>
            <dd className="text-xl font-bold">{streaks.totalActiveDays.toLocaleString()}</dd>
          </div>
        </dl>

        <p className="sr-only">
          {count(activeInYear, 'day')} with study in the last year. The weekly table below lists the
          recent weeks.
        </p>
        <div ref={scroller} className="mt-4 overflow-x-auto pb-1" aria-hidden="true">
          <div className="flex w-max gap-[3px]" onMouseLeave={() => setHovered(null)}>
            <div className="mr-1 flex flex-col gap-[3px] pt-4">
              {WEEKDAYS.map((label, i) => (
                <span key={i} className="h-[11px] text-[9px] leading-[11px] text-gray-500">
                  {label}
                </span>
              ))}
            </div>
            {heatmap.map((week, w) => {
              const first = week[0] as HeatmapCell;
              const previous = heatmap[w - 1]?.[0];
              const newMonth =
                !previous || new Date(previous.at).getMonth() !== new Date(first.at).getMonth();
              return (
                <div key={first.day} className="flex flex-col gap-[3px]">
                  <span className="h-[13px] text-[9px] whitespace-nowrap text-gray-500">
                    {newMonth && w < heatmap.length - 2
                      ? new Date(first.at).toLocaleDateString(undefined, { month: 'short' })
                      : ''}
                  </span>
                  {week.map((cell) => (
                    <span
                      key={cell.day}
                      className={`h-[11px] w-[11px] rounded-[2px] ${
                        cell.future ? 'bg-transparent' : LEVELS[cell.level]
                      } ${hovered?.day === cell.day ? 'ring-2 ring-gray-900' : ''}`}
                      title={
                        cell.future
                          ? undefined
                          : `${longDate(cell.at)}: ${count(cell.answered, 'answer')}`
                      }
                      onMouseEnter={() => setHovered(cell.future ? null : cell)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
          <p aria-hidden="true" className="min-h-4">
            {hovered
              ? `${longDate(hovered.at)}: ${count(hovered.answered, 'answer')}`
              : 'Point at a day to see its activity.'}
          </p>
          <div className="flex items-center gap-1" aria-hidden="true">
            Less
            {LEVELS.map((level) => (
              <span key={level} className={`h-[11px] w-[11px] rounded-[2px] ${level}`} />
            ))}
            More
          </div>
        </div>
      </div>

      <div className={`${panel} mt-3`}>
        <h3 className="font-semibold">Weekly summary</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <caption className="sr-only">Study activity by week, newest first</caption>
            <thead className="text-gray-600">
              <tr>
                <th scope="col" className="py-1 font-medium">
                  Week
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Days
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Sessions
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Answers
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Accuracy
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, i) => (
                <tr key={week.start} className="border-t border-gray-100">
                  <th scope="row" className="py-1.5 font-normal">
                    {i === 0 ? 'This week' : `${shortDate(week.start)} – ${shortDate(week.end)}`}
                  </th>
                  <td className="py-1.5 text-right tabular-nums">{week.totals.activeDays} / 7</td>
                  <td className="py-1.5 text-right tabular-nums">{week.totals.sessions}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {week.totals.answered.toLocaleString()}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{pct(week.totals.accuracy)}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {week.totals.sessions > 0 ? studyTime(week.totals.studyMs) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Weeks run Monday to Sunday. Streaks use your device’s calendar days, so a day is never
          split by a time zone or clock change, and today does not break a streak before it ends.
        </p>
      </div>
    </Section>
  );
}
