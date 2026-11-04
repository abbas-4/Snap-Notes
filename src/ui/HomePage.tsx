import { Link } from 'react-router';
import { useAppData } from './appData';
import { cardLabel, formatDate } from './cardText';
import ImportExportPanel from './ImportExportPanel';
import { primaryButton, secondaryButton } from './styles';

export default function HomePage() {
  const { data } = useAppData();
  const total = data.cards.length;
  const recent = [...data.cards].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);

  return (
    <div className="space-y-8">
      <section aria-labelledby="home-heading">
        <h1 id="home-heading" className="text-2xl font-bold tracking-tight">
          Your flashcards
        </h1>
        {total === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white p-6">
            <h2 className="font-semibold">No cards yet</h2>
            <p className="mt-1 text-sm text-gray-600">
              Create your first card, or import a backup exported from Snap Notes.
            </p>
            <div className="mt-4">
              <Link to="/add" className={primaryButton}>
                Add your first card
              </Link>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-2 text-gray-700">
              You have <strong>{total}</strong> {total === 1 ? 'card' : 'cards'} saved.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link to="/add" className={primaryButton}>
                Add a card
              </Link>
              <Link to="/list" className={secondaryButton}>
                Browse all cards
              </Link>
            </div>
          </>
        )}
      </section>

      {total > 0 && (
        <section aria-labelledby="review-heading">
          <h2 id="review-heading" className="text-lg font-semibold">
            Review your cards
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="font-semibold">Study</h3>
              <p className="mt-1 text-sm text-gray-600">
                Flip through your cards one at a time, at your own pace.
              </p>
              <Link to="/study" className={`${primaryButton} mt-3`}>
                Study cards
              </Link>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="font-semibold">Quiz</h3>
              <p className="mt-1 text-sm text-gray-600">
                Answer multiple-choice questions built from your definitions.
              </p>
              <Link to="/quiz" className={`${primaryButton} mt-3`}>
                Take a quiz
              </Link>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="font-semibold">Learn</h3>
              <p className="mt-1 text-sm text-gray-600">
                Check yourself card by card; the ones you miss come back until you know them.
              </p>
              <Link to="/learn" className={`${primaryButton} mt-3`}>
                Start learning
              </Link>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="font-semibold">Match</h3>
              <p className="mt-1 text-sm text-gray-600">
                Pair terms with their definitions against the clock.
              </p>
              <Link to="/match" className={`${primaryButton} mt-3`}>
                Play match
              </Link>
            </div>
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="text-lg font-semibold">
            Recently updated
          </h2>
          <ul className="mt-3 space-y-2">
            {recent.map((card) => (
              <li
                key={card.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {card.term.trim() === '' ? (
                      <span className="text-gray-400 italic">(no term)</span>
                    ) : (
                      card.term
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-gray-500">
                    Updated {formatDate(card.updatedAt)}
                  </p>
                </div>
                <Link
                  to={`/edit/${card.id}`}
                  className="shrink-0 text-sm font-medium text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                  aria-label={`Edit ${cardLabel(card)}`}
                >
                  Edit
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="import-export-heading">
        <h2 id="import-export-heading" className="text-lg font-semibold">
          Import and export
        </h2>
        <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <ImportExportPanel />
        </div>
      </section>
    </div>
  );
}
