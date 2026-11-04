import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { primaryButton, secondaryButton } from './styles';

interface EmptyStateProps {
  /** The page's own heading, such as "Learn". */
  pageTitle: string;
  /** Why the mode can't start, such as "No cards to learn". */
  heading: string;
  children: ReactNode;
}

/** Shown in place of a study mode when there aren't enough usable cards. */
export default function EmptyState({ pageTitle, heading, children }: EmptyStateProps) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{pageTitle}</h1>
      <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-6">
        <h2 className="font-semibold">{heading}</h2>
        <p className="mt-1 text-sm text-gray-600">{children}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/add" className={primaryButton}>
            Add a card
          </Link>
          <Link to="/" className={secondaryButton}>
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
