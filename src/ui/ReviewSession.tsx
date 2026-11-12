import { useCallback, useEffect, useReducer, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router';
import {
  GRADE_LABELS,
  buildReviewQueue,
  isReviewable,
  type ReviewMode,
} from '../domain/reviewQueue';
import {
  currentReviewCard,
  reviewPhase,
  reviewReducer,
  reviewSummary,
  startReview,
  type ReviewState,
} from '../domain/reviewSession';
import { REVIEW_GRADES, RELEARN_MINUTES, gradeProgress, type ReviewGrade } from '../domain/srs';
import type { Card, Deck, Timestamp } from '../domain/types';
import { eligibilitySummary } from './cardText';
import { withDeck } from './deckScope';
import DeckScopeNotice from './DeckScopeNotice';
import { activatesFocusedControl, isShortcutBlocked } from './keyboard';
import { useProgress } from './progress';
import ProgressBar from './ProgressBar';
import { percent } from './progressText';
import {
  cautionButton,
  dangerButton,
  primaryButton,
  secondaryButton,
  successButton,
} from './styles';
import { useFocusOnChange } from './useFocusOnChange';

const focusRing =
  'rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600';

/** The button for each grade, in the order they are shown and numbered. */
const GRADE_STYLES: Record<ReviewGrade, string> = {
  again: dangerButton,
  hard: cautionButton,
  good: primaryButton,
  easy: successButton,
};

const MODE_EMPTY: Record<ReviewMode, { heading: string; detail: string }> = {
  due: {
    heading: 'Nothing is due right now',
    detail: 'You have reviewed everything that was waiting.',
  },
  new: {
    heading: 'No new cards',
    detail: 'Every card here has been reviewed at least once.',
  },
  difficult: {
    heading: 'No difficult cards',
    detail: 'Cards you keep forgetting show up here, so you can give them extra attention.',
  },
  all: { heading: 'Nothing to review', detail: 'There are no cards that can be reviewed here.' },
};

interface ReviewSessionProps {
  cards: readonly Card[];
  mode: ReviewMode;
  deck: Deck | undefined;
  deckId: string | null;
}

/**
 * One review session: the queue is chosen when the session starts and does not
 * change under the user, even as their answers reschedule the cards in it.
 */
export default function ReviewSession({ cards, mode, deck, deckId }: ReviewSessionProps) {
  const { records, gradeCard } = useProgress();
  // The clock is read once, so the whole queue is judged against one moment.
  const [startedAt] = useState(() => Date.now());
  const [queued] = useState(() => buildReviewQueue(cards, records, { now: startedAt, mode }));
  const [state, dispatch] = useReducer(reviewReducer, queued, (initial) => startReview(initial));
  const [saveError, setSaveError] = useState<string | null>(null);

  const phase = reviewPhase(state);
  const { sessionId, turn } = state;
  const card = currentReviewCard(state);
  const summary = reviewSummary(state);

  const termRef = useRef<HTMLHeadingElement>(null);
  const definitionRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);

  const focusOnChange = useCallback(() => {
    if (phase === 'revealed') definitionRef.current?.focus();
    else if (phase === 'finished') resultsRef.current?.focus();
    else termRef.current?.focus();
  }, [phase]);
  useFocusOnChange(`${sessionId}:${turn}:${phase}`, focusOnChange);

  const grade = useCallback(
    (value: ReviewGrade) => {
      const current = currentReviewCard(state);
      if (!current || reviewPhase(state) !== 'revealed') return;
      // Saved first: if the answer cannot be recorded, the session stays where
      // it is rather than moving on from a card whose progress was lost.
      const saved = gradeCard(current, value);
      if (!saved.ok) {
        setSaveError(saved.message);
        return;
      }
      setSaveError(null);
      dispatch({ type: 'grade', sessionId: state.sessionId, turn: state.turn, grade: value });
    },
    [gradeCard, state],
  );

  // Space reveals the answer; 1 to 4 grade it.
  useEffect(() => {
    if (phase === 'finished') return;
    function onKeyDown(event: KeyboardEvent) {
      if (isShortcutBlocked(event) || event.repeat) return;
      if (phase === 'prompt' && event.key === ' ') {
        if (activatesFocusedControl(event)) return;
        event.preventDefault();
        dispatch({ type: 'reveal', sessionId, turn });
        return;
      }
      if (phase !== 'revealed') return;
      const index = Number(event.key);
      const chosen = REVIEW_GRADES[index - 1];
      if (!chosen) return;
      event.preventDefault();
      grade(chosen);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [grade, phase, sessionId, turn]);

  if (state.cards.length === 0) {
    const { heading, detail } = MODE_EMPTY[mode];
    const eligible = cards.filter(isReviewable);
    return (
      <div>
        {deck && <DeckScopeNotice deck={deck} />}
        <h1 className="text-2xl font-bold tracking-tight">Review</h1>
        <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-6">
          <h2 className="font-semibold">{heading}</h2>
          <p className="mt-1 text-sm text-gray-600">
            {detail} {eligible.length === 0 && eligibilitySummary(cards.length, eligible.length)}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to={withDeck('/review', deckId)} className={primaryButton}>
              Back to review
            </Link>
            <Link to={withDeck('/add', deckId)} className={secondaryButton}>
              Add a card
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const answered = summary.completed;
  const total = state.cards.length;

  return (
    <div>
      {deck && <DeckScopeNotice deck={deck} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Review</h1>
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
          <Link to={withDeck('/review', deckId)} className={secondaryButton}>
            Exit review
          </Link>
        </div>
      </div>

      {saveError && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          Your answer could not be saved: {saveError}
        </p>
      )}

      {phase === 'finished' ? (
        <ReviewResults
          state={state}
          headingRef={resultsRef}
          deckId={deckId}
          onRestart={(next) => dispatch({ type: 'restart', cards: next })}
        />
      ) : (
        card && (
          <>
            <p id="review-instructions" className="mt-2 text-sm text-gray-600">
              Recall the answer, then say how well you knew it. Keyboard: <kbd>Space</kbd> shows the
              answer, then <kbd>1</kbd>–<kbd>4</kbd> grade it.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="shrink-0 text-sm font-medium text-gray-700">
                {answered} of {total} done
              </p>
              <div className="min-w-32 flex-1">
                <ProgressBar value={answered} max={total} label="Cards reviewed this session" />
              </div>
              <p className="shrink-0 text-sm text-gray-700">{state.queue.length} to go</p>
            </div>

            <ReviewCardView
              key={`${sessionId}:${turn}`}
              card={card}
              revealed={phase === 'revealed'}
              now={startedAt}
              termRef={termRef}
              definitionRef={definitionRef}
              onReveal={() => dispatch({ type: 'reveal', sessionId, turn })}
              onGrade={grade}
            />
          </>
        )
      )}
    </div>
  );
}

/**
 * What answering with this grade would schedule, shown under the button.
 *
 * The interval itself does not depend on when the answer is given, so the time
 * the session started is enough to work it out.
 */
function useNextIntervalText(card: Card, value: ReviewGrade, now: Timestamp): string {
  const { records } = useProgress();
  if (value === 'again') return `${RELEARN_MINUTES} min`;
  const next = gradeProgress(records.get(card.id), value, {
    cardId: card.id,
    deckId: card.deckId,
    now,
  });
  return next.intervalDays === 1 ? '1 day' : `${next.intervalDays} days`;
}

function GradeButton({
  card,
  value,
  index,
  now,
  onGrade,
}: {
  card: Card;
  value: ReviewGrade;
  index: number;
  now: Timestamp;
  onGrade(grade: ReviewGrade): void;
}) {
  const { label, hint } = GRADE_LABELS[value];
  const interval = useNextIntervalText(card, value, now);
  return (
    <button
      type="button"
      className={`${GRADE_STYLES[value]} flex-col gap-0.5 py-2`}
      aria-keyshortcuts={String(index)}
      aria-label={`${label} — ${hint}. Next review in ${interval}.`}
      onClick={() => onGrade(value)}
    >
      <span>{label}</span>
      <span className="text-xs font-normal opacity-90">{interval}</span>
    </button>
  );
}

interface ReviewCardViewProps {
  card: Card;
  revealed: boolean;
  /** When the session started; the grade buttons show what each would schedule. */
  now: Timestamp;
  termRef: RefObject<HTMLHeadingElement | null>;
  definitionRef: RefObject<HTMLDivElement | null>;
  onReveal(): void;
  onGrade(grade: ReviewGrade): void;
}

function ReviewCardView({
  card,
  revealed,
  now,
  termRef,
  definitionRef,
  onReveal,
  onGrade,
}: ReviewCardViewProps) {
  const { records } = useProgress();
  const progress = records.get(card.id);

  return (
    <section
      aria-labelledby="review-term"
      aria-describedby="review-instructions"
      className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">Term</p>
        <p className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
          {progress
            ? `Seen ${progress.reviews} ${progress.reviews === 1 ? 'time' : 'times'} · ${percent(
                progress.correct / Math.max(1, progress.reviews),
              )} correct`
            : 'New card'}
        </p>
      </div>
      <h2
        id="review-term"
        ref={termRef}
        tabIndex={-1}
        className={`mt-1 text-2xl font-bold break-words whitespace-pre-wrap ${focusRing}`}
      >
        {card.term}
      </h2>

      {revealed ? (
        <>
          <div
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
          <div role="group" aria-labelledby="review-grade-question" className="mt-6">
            <p id="review-grade-question" className="font-semibold">
              How well did you remember it?
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              {REVIEW_GRADES.map((value, index) => (
                <GradeButton
                  key={value}
                  card={card}
                  value={value}
                  index={index + 1}
                  now={now}
                  onGrade={onGrade}
                />
              ))}
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
          Show answer
        </button>
      )}
    </section>
  );
}

interface ReviewResultsProps {
  state: ReviewState;
  headingRef: RefObject<HTMLHeadingElement | null>;
  deckId: string | null;
  onRestart(cards: readonly Card[]): void;
}

function ReviewResults({ state, headingRef, deckId, onRestart }: ReviewResultsProps) {
  const summary = reviewSummary(state);
  const unfinished = state.cards.filter((card) => state.queue.includes(card.id));

  return (
    <section aria-labelledby="review-results" className="mt-6 space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <h2
          id="review-results"
          ref={headingRef}
          tabIndex={-1}
          className={`text-xl font-bold ${focusRing}`}
        >
          {state.ended ? 'Session ended' : 'Review complete'}
        </h2>
        <p className="mt-2 text-3xl font-bold text-indigo-700">
          {summary.completed} / {summary.total}
        </p>
        <p className="mt-1 text-gray-700">
          {summary.graded === 0
            ? 'No cards were graded, so nothing was rescheduled.'
            : `You graded ${summary.graded} ${summary.graded === 1 ? 'answer' : 'answers'}, ${percent(summary.accuracy)} remembered. Every card has been rescheduled.`}
        </p>
        <ul className="mt-4 flex flex-wrap justify-center gap-2 text-sm">
          {REVIEW_GRADES.map((value) => (
            <li
              key={value}
              className="rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-800"
            >
              {GRADE_LABELS[value].label} {summary.byGrade[value]}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {unfinished.length > 0 && (
            <button type="button" className={primaryButton} onClick={() => onRestart(unfinished)}>
              Finish the last {unfinished.length}
            </button>
          )}
          <Link
            to={withDeck('/review', deckId)}
            className={unfinished.length > 0 ? secondaryButton : primaryButton}
          >
            Back to review
          </Link>
          <Link to="/stats" className={secondaryButton}>
            See your statistics
          </Link>
        </div>
      </div>
    </section>
  );
}
