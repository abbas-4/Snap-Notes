import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * A small, dependency-free chart: stacked columns or a line, drawn as SVG at
 * the width of its container. Hover (or focus and the arrow keys) shows every
 * value at that point; the same figures are always in the table underneath.
 */

export interface ChartSeries {
  key: string;
  label: string;
  /** Mark colour. Text never uses it. */
  color: string;
  /** One value per point; null leaves a gap (a line only). */
  values: (number | null)[];
}

interface TrendChartProps {
  kind: 'bar' | 'line';
  title: string;
  /** One sentence summing the chart up, read before the chart itself. */
  summary: string;
  /** Short axis labels, one per point. */
  labels: string[];
  /** Full names for the tooltip and the table, one per point. */
  names: string[];
  series: ChartSeries[];
  formatValue(value: number): string;
  /** Fixed top of the scale, such as 1 for a percentage. */
  max?: number;
  /** Extra lines for the tooltip at a point, such as "3 sessions". */
  details?: (index: number) => string[];
}

const HEIGHT = 220;
const MARGIN = { top: 12, right: 12, bottom: 28, left: 44 };

function niceStep(max: number, ticks: number): number {
  const rough = max / ticks;
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / power;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return nice * power;
}

/** The chart's width, following its container. jsdom has no layout, so tests get a fixed width. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) setWidth(Math.round(next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** A column with rounded corners at its data end and a square base. */
function columnPath(x: number, y: number, w: number, h: number, round: boolean): string {
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

export default function TrendChart({
  kind,
  title,
  summary,
  labels,
  names,
  series,
  formatValue,
  max,
  details,
}: TrendChartProps) {
  const { ref, width } = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const summaryId = useId();
  const count = labels.length;

  const plotWidth = Math.max(80, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const band = count > 0 ? plotWidth / count : plotWidth;

  const totals = labels.map((_, i) =>
    kind === 'bar'
      ? series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)
      : Math.max(0, ...series.map((s) => s.values[i] ?? 0)),
  );
  const dataMax = Math.max(0, ...totals);
  const step = niceStep(max ?? Math.max(dataMax, 1), 4);
  const top = max ?? Math.max(step, Math.ceil(dataMax / step) * step);
  const ticks: number[] = [];
  for (let t = 0; t <= top + 1e-9; t += step) ticks.push(t);

  const y = (value: number) => MARGIN.top + plotHeight - (value / top) * plotHeight;
  const xCenter = (i: number) => MARGIN.left + band * i + band / 2;
  const barWidth = Math.max(2, Math.min(24, band - 2));
  // Thin the axis labels so they never collide; the last point is labelled
  // too when it is far enough from the previous label.
  const labelEvery = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(plotWidth / 64))));
  const shownLabels = new Set<number>();
  for (let i = 0; i < count; i += labelEvery) shownLabels.add(i);
  const lastShown = Math.floor((count - 1) / labelEvery) * labelEvery;
  if (count > 0 && count - 1 - lastShown >= Math.ceil(labelEvery / 2)) shownLabels.add(count - 1);

  function pointAt(clientX: number, element: SVGSVGElement): number | null {
    const box = element.getBoundingClientRect();
    const scale = box.width > 0 ? width / box.width : 1;
    const x = (clientX - box.left) * scale - MARGIN.left;
    if (count === 0) return null;
    return Math.min(count - 1, Math.max(0, Math.floor(x / band)));
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    setActive(pointAt(event.clientX, event.currentTarget));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (count === 0) return;
    const current = active ?? count - 1;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = Math.max(0, current - 1);
    else if (event.key === 'ArrowRight') next = Math.min(count - 1, current + 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    else if (event.key === 'Escape') {
      setActive(null);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  }

  const readout =
    active === null
      ? null
      : {
          name: names[active] ?? '',
          rows: series.map((s) => ({
            key: s.key,
            label: s.label,
            color: s.color,
            value: s.values[active] ?? null,
          })),
          extra: details?.(active) ?? [],
        };

  // Beside the point, never on top of it: to its right in the left half of
  // the chart, to its left in the right half. 176px is the tooltip's width.
  const TOOLTIP = 176;
  const tooltipLeft =
    active === null
      ? 0
      : xCenter(active) < width / 2
        ? Math.min(xCenter(active) + barWidth / 2 + 8, width - TOOLTIP)
        : Math.max(0, xCenter(active) - barWidth / 2 - 8 - TOOLTIP);

  return (
    <figure className="m-0">
      <figcaption id={summaryId} className="text-sm text-gray-600">
        {summary}
      </figcaption>
      {series.length > 1 && (
        <ul className="mt-2 flex flex-wrap gap-4 text-xs text-gray-700" aria-hidden="true">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                className={kind === 'bar' ? 'h-2.5 w-2.5 rounded-sm' : 'h-0.5 w-3 rounded'}
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div
        ref={ref}
        className="relative mt-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        tabIndex={0}
        role="group"
        aria-label={`${title}. Use the left and right arrow keys to read each point.`}
        aria-describedby={summaryId}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block max-w-full touch-pan-y"
          aria-hidden="true"
          onPointerMove={onPointerMove}
          onPointerDown={onPointerMove}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + plotWidth}
                y1={y(tick)}
                y2={y(tick)}
                stroke={tick === 0 ? '#d1d5db' : '#f3f4f6'}
                strokeWidth={1}
              />
              <text
                x={MARGIN.left - 8}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-gray-500 text-[11px]"
              >
                {formatValue(tick)}
              </text>
            </g>
          ))}

          {labels.map((label, i) =>
            shownLabels.has(i) ? (
              <text
                key={`label-${i}`}
                x={xCenter(i)}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="fill-gray-500 text-[11px]"
              >
                {label}
              </text>
            ) : null,
          )}

          {kind === 'bar' &&
            labels.map((_, i) => {
              let base = 0;
              const segments = series
                .map((s) => ({ s, value: s.values[i] ?? 0 }))
                .filter((part) => part.value > 0);
              return (
                <g key={`bar-${i}`} opacity={active === null || active === i ? 1 : 0.45}>
                  {segments.map((part, index) => {
                    const yTop = y(base + part.value);
                    const yBottom = y(base);
                    base += part.value;
                    const isTop = index === segments.length - 1;
                    // A 2px gap in the surface colour between stacked segments.
                    const height = Math.max(1, yBottom - yTop - (index > 0 ? 2 : 0));
                    return (
                      <path
                        key={part.s.key}
                        d={columnPath(xCenter(i) - barWidth / 2, yTop, barWidth, height, isTop)}
                        fill={part.s.color}
                      />
                    );
                  })}
                </g>
              );
            })}

          {kind === 'line' &&
            series.map((s) => {
              const runs: string[] = [];
              let run: string[] = [];
              s.values.forEach((value, i) => {
                if (value === null) {
                  if (run.length) runs.push(run.join(' '));
                  run = [];
                } else run.push(`${xCenter(i)},${y(value)}`);
              });
              if (run.length) runs.push(run.join(' '));
              const showDots = count <= 31;
              return (
                <g key={s.key}>
                  {runs.map((points, index) => (
                    <polyline
                      key={index}
                      points={points}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ))}
                  {s.values.map((value, i) =>
                    value !== null && (showDots || active === i || runs.length > 1) ? (
                      <circle
                        key={i}
                        cx={xCenter(i)}
                        cy={y(value)}
                        r={active === i ? 5 : 4}
                        fill={s.color}
                        stroke="#ffffff"
                        strokeWidth={2}
                      />
                    ) : null,
                  )}
                </g>
              );
            })}

          {kind === 'line' && active !== null && (
            <line
              x1={xCenter(active)}
              x2={xCenter(active)}
              y1={MARGIN.top}
              y2={MARGIN.top + plotHeight}
              stroke="#9ca3af"
              strokeWidth={1}
            />
          )}
        </svg>

        {readout && (
          <div
            className="pointer-events-none absolute top-1 z-10 w-44 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg"
            style={{ left: tooltipLeft }}
          >
            <p className="font-medium text-gray-600">{readout.name}</p>
            <ul className="mt-1 space-y-0.5">
              {readout.rows.map((row) => (
                <li key={row.key} className="flex items-center gap-2">
                  <span className="h-0.5 w-3 rounded" style={{ backgroundColor: row.color }} />
                  <strong className="text-gray-900">
                    {row.value === null ? '—' : formatValue(row.value)}
                  </strong>
                  <span className="text-gray-600">{row.label}</span>
                </li>
              ))}
              {readout.extra.map((line) => (
                <li key={line} className="text-gray-600">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* What the focused point says, for screen readers. */}
      <p className="sr-only" aria-live="polite">
        {readout
          ? `${readout.name}: ${readout.rows
              .map(
                (row) => `${row.value === null ? 'no data' : formatValue(row.value)} ${row.label}`,
              )
              .join(', ')}`
          : ''}
      </p>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-indigo-700 hover:underline">
          Show as a table
        </summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-gray-200">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-gray-50 text-gray-600">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  Period
                </th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="px-3 py-1.5 font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {names.map((name, i) => (
                <tr key={`${name}-${i}`} className="border-t border-gray-100">
                  <th scope="row" className="px-3 py-1.5 font-normal text-gray-700">
                    {name}
                  </th>
                  {series.map((s) => {
                    const value = s.values[i] ?? null;
                    return (
                      <td key={s.key} className="px-3 py-1.5 tabular-nums">
                        {value === null ? '—' : formatValue(value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
