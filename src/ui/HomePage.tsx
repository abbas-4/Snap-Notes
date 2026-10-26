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
