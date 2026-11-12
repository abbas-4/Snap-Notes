import { Link, useSearchParams } from 'react-router';
import { countProgress, countProgressByDeck, nextDueAt } from '../domain/progressStats';
import { isReviewMode, queueSizes, type ReviewMode } from '../domain/reviewQueue';
import { useAppData } from './appData';
import DeckNotFound from './DeckNotFound';
import { reviewLink, useDeckScope } from './deckScope';
import DeckScopeNotice from './DeckScopeNotice';
import { useProgress } from './progress';
import { cardsLabel, percent, relativeDay } from './progressText';
import { StageChips, StatTile } from './ProgressSummary';
import ReviewSession from './ReviewSession';
import { primaryButton, secondaryButton } from './styles';
import { useNow } from './useNow';

/** The sessions offered below the due cards, in the order they are shown. */
const OTHER_MODES: { mode: Exclude<ReviewMode, 'due'>; title: string; description: string }[] = [
  {
    mode: 'new',
    title: 'Learn new cards',
    description: 'Cards you have never reviewed, oldest first.',
  },
  {
    mode: 'difficult',
    title: 'Practise difficult cards',
    description: 'The ones you keep forgetting, whether or not they are due.',
  },
  {
    mode: 'all',
    title: 'Review everything',
    description: 'Every card here, with the ones waiting longest first.',
  },
];

/**
 * The review dashboard, and the session it starts.
 *
 * `?mode=` decides which: without it the page says what is waiting, and with
 * it the session runs. Keeping the mode in the URL means a session can be
 * linked to, reloaded, and reached from a deck with `?deck=` alongside.
 */
export default function ReviewPage() {
  const { deck, deckId, unknownDeck, cards } = useDeckScope();
  const mode = useSearchParams()[0].get('mode');

  if (unknownDeck) return <DeckNotFound />;

  if (isReviewMode(mode)) {
    // Keyed so changing mode or deck starts a new session rather than reusing the queue.
    return (
      <ReviewSession
        key={`${mode}:${deckId ?? 'all'}`}
        cards={cards}
        mode={mode}
        deck={deck}
        deckId={deckId}
      />
    );
  }

  return <ReviewDashboard />;
}

function ReviewDashboard() {
  const { data } = useAppData();
  const { deck, deckId, cards } = useDeckScope();
  const { records } = useProgress();
  // Refreshed every minute, so a card falling due appears without a reload.
  const now = useNow(true, 60_000);

  const counts = countProgress(cards, records, now);
  const sizes = queueSizes(cards, records, { now });
  const upNext = nextDueAt(records, now);
  const byDeck = countProgressByDeck(data, records, now);
  const otherDecks = [...data.decks].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-8">
      {deck && <DeckScopeNotice deck={deck} />}

      <section aria-labelledby="review-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 id="review-heading" className="text-2xl font-bold tracking-tight">
            Review
          </h1>
          <Link to="/stats" className={secondaryButton}>
            Your statistics
          </Link>
        </div>

        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {counts.due > 0 ? (
            <>
              <h2 className="text-lg font-semibold">
                {cardsLabel(counts.due)} ready to review
                {deck ? ` in ${deck.name}` : ''}
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                {counts.overdue === 0
                  ? 'These are today’s reviews. The ones you find hardest come back soonest.'
                  : counts.overdue === 1
                    ? 'One has been waiting since an earlier day, so it comes first.'
                    : `${counts.overdue} have been waiting since an earlier day, so they come first.`}
              </p>
              <Link to={reviewLink('due', deckId)} className={`${primaryButton} mt-4`}>
                Start reviewing {counts.due}
              </Link>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">You’re all caught up!</h2>
              <p className="mt-1 text-sm text-gray-600">
                {counts.reviewed === 0
                  ? 'Nothing has been reviewed yet. Start with a few new cards below.'
                  : upNext !== null
                    ? `Today’s reviews are done. The next card is due ${relativeDay(upNext, now)}.`
                    : 'Today’s reviews are done.'}
              </p>
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="review-counts-heading">
        <h2 id="review-counts-heading" className="text-lg font-semibold">
          Where your cards stand
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <StatTile
            label="Due now"
            value={String(counts.due)}
            hint={counts.overdue > 0 ? `${counts.overdue} overdue` : 'Nothing overdue'}
          />
          <StatTile label="New" value={String(counts.newCards)} hint="Never reviewed" />
          <StatTile
            label="Learning"
            value={String(counts.learning)}
            hint="Not yet on a long schedule"
          />
          <StatTile label="Mastered" value={String(counts.mastered)} hint="Three weeks or more" />
          <StatTile
            label="Cards reviewed"
            value={`${counts.reviewed} of ${counts.reviewable}`}
            hint="At least once"
          />
          <StatTile label="Learned" value={percent(counts.mastery)} hint="Across the cards here" />
        </div>
      </section>

      <section aria-labelledby="review-modes-heading">
        <h2 id="review-modes-heading" className="text-lg font-semibold">
          Other ways to study
        </h2>
        <ul className="mt-3 space-y-3">
          {OTHER_MODES.map(({ mode, title, description }) => (
            <li
              key={mode}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="min-w-0">
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-0.5 text-sm text-gray-600">{description}</p>
              </div>
              {sizes[mode] > 0 ? (
                <Link
                  to={reviewLink(mode, deckId)}
                  className={secondaryButton}
                  aria-label={`${title} (${sizes[mode]})`}
                >
                  Start ({sizes[mode]})
                </Link>
              ) : (
                <p className="text-sm text-gray-500">None right now</p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {!deck && data.decks.length > 1 && (
        <section aria-labelledby="review-decks-heading">
          <h2 id="review-decks-heading" className="text-lg font-semibold">
            By deck
          </h2>
          <ul className="mt-3 space-y-3">
            {otherDecks.map((item) => {
              const deckCounts = byDeck.get(item.id);
              if (!deckCounts) return null;
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="min-w-0">
                    <h3 className="font-semibold break-words">
                      <Link
                        to={`/decks/${item.id}`}
                        className="text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                      >
                        {item.name}
                      </Link>
                    </h3>
                    <p className="mt-0.5 text-sm text-gray-600">
                      {deckCounts.due > 0 ? `${deckCounts.due} due` : 'Nothing due'} ·{' '}
                      {cardsLabel(deckCounts.total)}
                    </p>
                    <div className="mt-2">
                      <StageChips counts={deckCounts} />
                    </div>
                  </div>
                  <Link
                    to={`/review?deck=${encodeURIComponent(item.id)}`}
                    className={secondaryButton}
                    aria-label={`Review ${item.name}`}
                  >
                    Review
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
