import { useCallback, useEffect, useReducer, useRef, type RefObject } from 'react';
import { Link } from 'react-router';
import {
  currentLearnCard,
  isLearnEligible,
  learnPhase,
  learnReducer,
  learnResults,
  prepareLearnCards,
  startLearn,
  type LearnState,
} from '../domain/learnSession';
import type { Card } from '../domain/types';
import { useAppData } from './appData';
import { eligibilitySummary } from './cardText';
import EmptyState from './EmptyState';
import { activatesFocusedControl, isShortcutBlocked } from './keyboard';
import ProgressBar from './ProgressBar';
import { primaryButton, secondaryButton } from './styles';
import { useFocusOnChange } from './useFocusOnChange';

const focusRing =
  'rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600';

export default function LearnPage() {
  const { data } = useAppData();
  const eligible = data.cards.filter(isLearnEligible).length;

  if (eligible === 0) {
    return (
      <EmptyState pageTitle="Learn" heading="No cards to learn">
        Learn needs cards with both a term and a definition.{' '}
        {eligibilitySummary(data.cards.length, eligible)}
      </EmptyState>
    );
  }

  // The session works on a snapshot of the cards taken when it starts.
  return <LearnSession cards={data.cards} />;
}

function LearnSession({ cards }: { cards: readonly Card[] }) {
  const [state, dispatch] = useReducer(learnReducer, cards, (initial) =>
    startLearn(prepareLearnCards(initial)),
  );
  const phase = learnPhase(state);
  const { sessionId, turn } = state;
  const card = currentLearnCard(state);
  const total = state.cards.length;
  const masteredCount = state.mastered.length;

  const termRef = useRef<HTMLHeadingElement>(null);
  const definitionRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);

  // Focus follows the screen: to the definition once revealed (the reveal
  // button is gone), to the next term after a grade, or to the results.
  const focusOnChange = useCallback(() => {
    if (phase === 'revealed') definitionRef.current?.focus();
    else if (phase === 'finished') resultsRef.current?.focus();
    else termRef.current?.focus();
  }, [phase]);
  useFocusOnChange(`${sessionId}:${turn}:${phase}`, focusOnChange);

  // Space reveals; 1 and 2 grade. Every action names its session and turn,
  // so the reducer drops any that arrive after the screen has moved on.
  useEffect(() => {
    if (phase === 'finished') return;
    function onKeyDown(event: KeyboardEvent) {
      if (isShortcutBlocked(event) || event.repeat) return;
      if (phase === 'prompt' && event.key === ' ') {
        if (activatesFocusedControl(event)) return;
        event.preventDefault();
        dispatch({ type: 'reveal', sessionId, turn });
      } else if (phase === 'revealed' && (event.key === '1' || event.key === '2')) {
        event.preventDefault();
        dispatch({ type: 'grade', sessionId, turn, knew: event.key === '2' });
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [phase, sessionId, turn]);

  function restart(nextCards: readonly Card[]) {
    dispatch({ type: 'restart', cards: prepareLearnCards(nextCards) });
  }

  let announcement = '';
  if (state.lastGrade && phase !== 'finished') {
    announcement = state.lastGrade.knew
      ? `Marked as known. ${masteredCount} of ${total} mastered.`
      : 'Marked as still learning. It will come back soon.';
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Learn</h1>
        <div className="flex gap-3">
          {phase !== 'finished' && (
            <button
              type="button"
              className={secondaryButton}
              onClick={() => dispatch({ type: 'end', sessionId })}
            >
              End session
            </button>
          )}
          <Link to="/" className={secondaryButton}>
            Exit learn
          </Link>
        </div>
      </div>

      {/* Announces each grade to screen readers. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {phase === 'finished' ? (
        <LearnResultsView
          state={state}
          headingRef={resultsRef}
          onReview={(review) => restart(review)}
          onStartOver={() => restart(cards)}
        />
      ) : (
        card && (
          <>
            <p id="learn-instructions" className="mt-2 text-sm text-gray-600">
              Recall the definition, then check yourself. Cards you’re still learning come back
              later. Keyboard: <kbd>Space</kbd> shows the definition, then <kbd>1</kbd> means still
              learning and <kbd>2</kbd> means you know it.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="shrink-0 text-sm font-medium text-gray-700">
                Mastered {masteredCount} of {total}
              </p>
              <div className="min-w-32 flex-1">
                <ProgressBar value={masteredCount} max={total} label="Cards mastered" />
              </div>
              <p className="shrink-0 text-sm text-gray-700">{state.queue.length} to go</p>
            </div>

            <LearnCardView
              key={`${sessionId}:${turn}`}
              card={card}
              revealed={phase === 'revealed'}
              misses={state.misses.get(card.id) ?? 0}
              termRef={termRef}
              definitionRef={definitionRef}
              onReveal={() => dispatch({ type: 'reveal', sessionId, turn })}
              onGrade={(knew) => dispatch({ type: 'grade', sessionId, turn, knew })}
            />
          </>
        )
      )}
    </div>
  );
}

interface LearnCardViewProps {
  card: Card;
  revealed: boolean;
  /** How many times this card was marked "still learning" so far. */
  misses: number;
  termRef: RefObject<HTMLHeadingElement | null>;
  definitionRef: RefObject<HTMLDivElement | null>;
  onReveal(): void;
  onGrade(knew: boolean): void;
}

function LearnCardView({
  card,
  revealed,
  misses,
  termRef,
  definitionRef,
  onReveal,
  onGrade,
}: LearnCardViewProps) {
  return (
    <section
      aria-labelledby="learn-term"
      aria-describedby="learn-instructions"
      className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">Term</p>
        {misses > 0 && (
          <p className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
            Review · missed {misses} {misses === 1 ? 'time' : 'times'}
          </p>
        )}
      </div>
      <h2
        id="learn-term"
        ref={termRef}
        tabIndex={-1}
        className={`mt-1 text-2xl font-bold break-words whitespace-pre-wrap ${focusRing}`}
      >
        {card.term}
      </h2>

      {revealed ? (
        <>
          <div
            id="learn-definition"
            ref={definitionRef}
            tabIndex={-1}
            className={`mt-6 border-t border-gray-200 pt-6 ${focusRing}`}
          >
            <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
              Definition
            </p>
            <p className="mt-1 text-lg break-words whitespace-pre-wrap text-gray-800">
              {card.definition}
            </p>
          </div>
          <div role="group" aria-labelledby="learn-grade-question" className="mt-6">
            <p id="learn-grade-question" className="font-semibold">
              Did you know it?
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className={`${secondaryButton} border-amber-300 text-amber-900 hover:bg-amber-50`}
                aria-keyshortcuts="1"
                onClick={() => onGrade(false)}
              >
                Still learning
              </button>
              <button
                type="button"
                className={`${primaryButton} bg-green-700 hover:bg-green-800`}
                aria-keyshortcuts="2"
                onClick={() => onGrade(true)}
              >
                I know it
              </button>
            </div>
          </div>
        </>
      ) : (
        <button
          type="button"
          className={`${primaryButton} mt-6`}
          aria-keyshortcuts="Space"
          onClick={onReveal}
        >
          Show definition
        </button>
      )}
    </section>
  );
}

interface LearnResultsViewProps {
  state: LearnState;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onReview(cards: readonly Card[]): void;
  onStartOver(): void;
}

function LearnResultsView({ state, headingRef, onReview, onStartOver }: LearnResultsViewProps) {
  const { total, knownFirstTry, struggled, unfinished } = learnResults(state);
  const mastered = total - unfinished.length;
  // Everything not known on the first try: cards missed along the way and cards never reached.
  const review = state.cards.filter((card) => !knownFirstTry.includes(card));

  return (
    <section aria-labelledby="learn-results" className="mt-6 space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <h2
          id="learn-results"
          ref={headingRef}
          tabIndex={-1}
          className={`text-xl font-bold ${focusRing}`}
        >
          {state.ended ? 'Session ended' : 'All cards mastered'}
        </h2>
        <p className="mt-2 text-3xl font-bold text-indigo-700">
          {mastered} / {total}
        </p>
        <p className="mt-1 text-gray-700">
          You mastered {mastered} of {total} {total === 1 ? 'card' : 'cards'}.{' '}
          {knownFirstTry.length} known on the first try
          {struggled.length > 0 && `, ${struggled.length} needed review`}
          {unfinished.length > 0 && `, ${unfinished.length} not mastered yet`}.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {review.length > 0 && (
            <button type="button" className={primaryButton} onClick={() => onReview(review)}>
              Review {review.length} {review.length === 1 ? 'card' : 'cards'} again
            </button>
          )}
          <button
            type="button"
            className={review.length > 0 ? secondaryButton : primaryButton}
            onClick={onStartOver}
          >
            Start over
          </button>
          <Link to="/" className={secondaryButton}>
            Back to home
          </Link>
        </div>
      </div>

      {struggled.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold">Cards that needed review</h3>
          <ul className="mt-3 space-y-3">
            {struggled.map(({ card, misses, mastered: done }) => (
              <li
                key={card.id}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 font-semibold break-words whitespace-pre-wrap">
                    {card.term}
                  </p>
                  <p className="shrink-0 text-sm text-gray-600">
                    Missed {misses} {misses === 1 ? 'time' : 'times'}
                    {!done && ' · not mastered yet'}
                  </p>
                </div>
                <p className="mt-1 text-sm break-words whitespace-pre-wrap text-gray-700">
                  {card.definition}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
