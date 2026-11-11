import { Link } from 'react-router';
import { primaryButton, secondaryButton } from './styles';

/** Shown when a route or `?deck=` names a deck that is not there any more. */
export default function DeckNotFound() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Deck not found</h1>
      <p className="mt-2 text-gray-700">
        This deck does not exist. It may have been deleted, or the link may be wrong.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link to="/decks" className={primaryButton}>
          Back to decks
        </Link>
        <Link to="/list" className={secondaryButton}>
          Show all cards
        </Link>
      </div>
    </div>
  );
}
