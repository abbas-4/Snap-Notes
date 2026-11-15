import type { ReactNode } from 'react';

/** The white panel every analytics block sits in. */
export const panel = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5';

interface SectionProps {
  id: string;
  title: string;
  /** One line under the heading saying what the section answers. */
  description?: ReactNode;
  /** Controls on the heading's row, such as a sort menu. */
  actions?: ReactNode;
  children: ReactNode;
}

/** One analytics section: a heading, what it shows, then the content. */
export default function Section({ id, title, description, actions, children }: SectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2
            id={headingId}
            tabIndex={-1}
            className="text-lg font-semibold tracking-tight focus:outline-none"
          >
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-gray-600">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
