import { useEffect, useReducer } from 'react';
import { Link } from 'react-router';
import { shuffle } from '../domain/shuffle';
import {
  currentStudyCard,
  isFirstStudyCard,
  isLastStudyCard,
  startStudy,
  studyReducer,
} from '../domain/studySession';
import type { Card } from '../domain/types';
import DeckNotFound from './DeckNotFound';
import { useDeckScope, withDeck } from './deckScope';
import DeckScopeNotice from './DeckScopeNotice';
import { activatesFocusedControl, isShortcutBlocked } from './keyboard';
import ProgressBar from './ProgressBar';
import { primaryButton, secondaryButton } from './styles';

export default function StudyPage() {
  const { deck, deckId, unknownDeck, cards } = useDeckScope();

  if (unknownDeck) return <DeckNotFound />;

  if (cards.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Study</h1>
        <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-6">
          <h2 className="font-semibold">No cards to study</h2>
          <p className="mt-1 text-sm text-gray-600">
            {deck
              ? `There are no cards in ${deck.name} yet. Add one, then come back to flip through them.`
              : 'Add a few cards first, then come back to flip through them.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to={withDeck('/add', deckId)} className={primaryButton}>
              Add a card
            </Link>
            <Link to={deck ? `/decks/${deck.id}` : '/'} className={secondaryButton}>
              {deck ? 'Back to the deck' : 'Back to home'}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // The session works on a snapshot of the cards taken when it starts.
  return (
    <>
      {deck && <DeckScopeNotice deck={deck} />}
      <StudySession cards={cards} />
    </>
  );
}

function StudySession({ cards }: { cards: readonly Card[] }) {
  const [state, dispatch] = useReducer(studyReducer, cards, startStudy);
  const card = currentStudyCard(state);
  const total = state.cards.length;
  const { index, revealed } = state;
  const first = isFirstStudyCard(state);
  const last = isLastStudyCard(state);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isShortcutBlocked(event) || activatesFocusedControl(event)) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        dispatch({ type: 'next', index });
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        dispatch({ type: 'previous', index });
      } else if (event.key === ' ') {
        // Stops the page from scrolling; holding the key must not flicker the card.
        event.preventDefault();
        if (!event.repeat) dispatch({ type: 'toggle', index });
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [index]);

  if (!card) return null;

  const term = card.term.trim() === '' ? null : card.term;
  const definition = card.definition.trim() === '' ? null : card.definition;
  const position = `Card ${index + 1} of ${total}`;
  const announcement = revealed
    ? `Definition: ${definition ?? 'no definition'}`
    : `${position}${last && total > 1 ? ', the last card' : ''}. ${term ?? 'No term'}`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Study</h1>
        <Link to="/" className={secondaryButton}>
          Exit study
        </Link>
      </div>
      <p id="study-instructions" className="mt-2 text-sm text-gray-600">
        Read the term, then show the definition to check yourself. Keyboard: <kbd>Space</kbd> shows
        or hides the definition, <kbd>←</kbd> and <kbd>→</kbd> move between cards.
      </p>

      <div className="mt-6 flex items-center gap-3">
        <p className="shrink-0 text-sm font-medium text-gray-700">{position}</p>
        <ProgressBar value={index + 1} max={total} label="Study progress" />
      </div>

      {/* Announces each card and each revealed definition to screen readers. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <section
        aria-label="Current card"
        aria-describedby="study-instructions"
        className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">Term</p>
        <h2 className="mt-1 text-2xl font-bold break-words whitespace-pre-wrap">
          {term ?? <span className="font-normal text-gray-400 italic">(no term)</span>}
        </h2>

        <div
          id="study-definition"
          hidden={!revealed}
          className="mt-6 border-t border-gray-200 pt-6"
        >
          <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">Definition</p>
          <p className="mt-1 text-lg break-words whitespace-pre-wrap text-gray-800">
            {definition ?? <span className="text-gray-400 italic">(no definition)</span>}
          </p>
        </div>

        <button
          type="button"
          className={`${primaryButton} mt-6`}
          aria-expanded={revealed}
          aria-controls="study-definition"
          aria-keyshortcuts="Space"
          onClick={() => dispatch({ type: 'toggle', index })}
        >
          {revealed ? 'Hide definition' : 'Show definition'}
        </button>
      </section>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-3">
          {/* aria-disabled rather than disabled, so focus stays put at either end. */}
          <button
            type="button"
            className={secondaryButton}
            aria-disabled={first}
            aria-keyshortcuts="ArrowLeft"
            onClick={() => dispatch({ type: 'previous', index })}
          >
            Previous
          </button>
          <button
            type="button"
            className={secondaryButton}
            aria-disabled={last}
            aria-keyshortcuts="ArrowRight"
            onClick={() => dispatch({ type: 'next', index })}
          >
            Next
          </button>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            className={secondaryButton}
            aria-pressed={state.shuffled}
            aria-disabled={total < 2}
            onClick={() =>
              dispatch(
                state.shuffled
                  ? { type: 'unshuffle' }
                  : { type: 'shuffle', cards: shuffle(state.original) },
              )
            }
          >
            Shuffle
          </button>
          <button
            type="button"
            className={secondaryButton}
            aria-disabled={first}
            onClick={() => dispatch({ type: 'restart' })}
          >
            Start over
          </button>
        </div>
      </div>

      {last && total > 1 && (
        <p className="mt-4 text-sm text-gray-600">
          That’s the last card. Choose <strong>Start over</strong> to go through them again, or turn
          on <strong>Shuffle</strong> for a new order.
        </p>
      )}
    </div>
  );
}
