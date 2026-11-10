import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Deck } from '../domain/types';

const noticeLink =
  'font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600';

interface DeckScopeNoticeProps {
  deck: Deck;
  /** Extra escape links, such as "Show all cards" on the card list. */
  children?: ReactNode;
}

/** Says which deck a page has been narrowed to, and offers a way out of it. */
export default function DeckScopeNotice({ deck, children }: DeckScopeNoticeProps) {
  return (
    <p className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
      <span>
        Showing only the cards in <strong>{deck.name}</strong>.
      </span>
      <Link to={`/decks/${deck.id}`} className={noticeLink}>
        Back to the deck
      </Link>
      {children}
    </p>
  );
}
