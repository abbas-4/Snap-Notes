import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string;
  icon: ReactNode;
  /** A short line of context under the value. */
  hint?: ReactNode;
  /** Tailwind classes for the icon's badge, such as "bg-green-50 text-green-700". */
  tone?: string;
  /** Position in its grid, to stagger the entrance slightly. */
  index?: number;
  /** Extra classes for its place in the grid. */
  className?: string;
}

/** One headline figure with its icon. Fades in once, and not at all with reduced motion. */
export default function StatCard({
  label,
  value,
  icon,
  hint,
  tone = 'bg-indigo-50 text-indigo-700',
  index = 0,
  className = '',
}: StatCardProps) {
  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md motion-safe:animate-rise ${className}`}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-gray-600">{label}</p>
        <span className={`rounded-lg p-1.5 ${tone}`}>{icon}</span>
      </div>
      <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      {hint && <div className="mt-0.5 text-sm text-gray-500">{hint}</div>}
    </div>
  );
}
