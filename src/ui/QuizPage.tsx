import {
  useEffect,
  useReducer,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { Link } from 'react-router';
import { buildQuizQuestions, isQuizEligible, type QuizQuestion } from '../domain/quiz';
import {
  quizPhase,
  quizReducer,
  quizResults,
  quizScore,
  startQuiz,
  type QuizState,
} from '../domain/quizSession';
import type { Card } from '../domain/types';
import { useAppData } from './appData';
import { activatesFocusedControl, isShortcutBlocked } from './keyboard';
import ProgressBar from './ProgressBar';
import { primaryButton, secondaryButton } from './styles';

export default function QuizPage() {
  const { data } = useAppData();
  // The quiz works on a snapshot of the cards taken when it starts.
  return <QuizSession cards={data.cards} />;
}

function QuizSession({ cards }: { cards: readonly Card[] }) {
  const [state, dispatch] = useReducer(quizReducer, cards, (initial) =>
    startQuiz(buildQuizQuestions(initial)),
  );
  const phase = quizPhase(state);
  const { sessionId, index } = state;
  const question = state.questions[index];
  const choiceCount = question?.choices.length ?? 0;

  const questionRef = useRef<HTMLHeadingElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);

  // Moves focus whenever the screen changes underneath it: to the Next button
  // after answering, to the new question, or to the results. Skipped on the
  // first render so arriving on the page does not steal focus.
  const focusKey = `${sessionId}:${index}:${phase}`;
  const lastFocusKey = useRef(focusKey);
  useEffect(() => {
    if (lastFocusKey.current === focusKey) return;
    lastFocusKey.current = focusKey;
    if (phase === 'feedback') nextRef.current?.focus();
    else if (phase === 'finished') resultsRef.current?.focus();
    else questionRef.current?.focus();
  }, [focusKey, phase]);

  // Number keys answer; Enter moves on when focus is not already on a control.
  // Only listens while a question is on screen, and every action names the
  // session and question it was meant for, so the reducer drops stale ones.
  useEffect(() => {
    if (phase === 'finished') return;
    function onKeyDown(event: KeyboardEvent) {
      if (isShortcutBlocked(event) || event.repeat) return;
      if (phase === 'answering' && /^[1-9]$/.test(event.key)) {
        const choiceIndex = Number(event.key) - 1;
        if (choiceIndex >= choiceCount) return;
        event.preventDefault();
        dispatch({ type: 'answer', sessionId, questionIndex: index, choiceIndex });
      } else if (phase === 'feedback' && event.key === 'Enter') {
        if (activatesFocusedControl(event)) return;
        event.preventDefault();
        dispatch({ type: 'next', sessionId, questionIndex: index });
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [phase, sessionId, index, choiceCount]);

  function restart() {
    dispatch({ type: 'restart', questions: buildQuizQuestions(cards) });
  }

  if (state.questions.length === 0) return <NotEnoughCards cards={cards} />;

  const total = state.questions.length;
  const score = quizScore(state);
  const lastResult = phase === 'feedback' ? quizResults(state)[index] : undefined;

  let announcement = '';
  if (lastResult) {
    const correctText = lastResult.question.choices.find((c) => c.isCorrect)?.text ?? '';
    announcement = lastResult.isCorrect
      ? `Correct. Score: ${score} of ${index + 1}.`
      : `Incorrect. The correct answer is: ${correctText}. Score: ${score} of ${index + 1}.`;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Quiz</h1>
        <div className="flex gap-3">
          {phase !== 'finished' && (
            <button type="button" className={secondaryButton} onClick={restart}>
              Restart
            </button>
          )}
          <Link to="/" className={secondaryButton}>
            Exit quiz
          </Link>
        </div>
      </div>

      {/* Announces answer feedback to screen readers. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {phase === 'finished' ? (
        <QuizResults state={state} headingRef={resultsRef} onRestart={restart} />
      ) : (
        question && (
          <>
            <p id="quiz-instructions" className="mt-2 text-sm text-gray-600">
              Pick the definition that matches the term. Keyboard: press <kbd>1</kbd>–
              <kbd>{choiceCount}</kbd> to answer, then <kbd>Enter</kbd> to continue.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <p className="shrink-0 text-sm font-medium text-gray-700">
                Question {index + 1} of {total}
              </p>
              <ProgressBar
                value={index + (phase === 'feedback' ? 1 : 0)}
                max={total}
                label="Quiz progress"
              />
              <p className="shrink-0 text-sm text-gray-700">
                Score: <strong>{score}</strong>
              </p>
            </div>
            <QuestionView
              key={`${sessionId}:${index}`}
              question={question}
              chosen={lastResult?.choiceIndex ?? null}
              headingRef={questionRef}
              nextRef={nextRef}
              isLast={index === total - 1}
              onAnswer={(choiceIndex) =>
                dispatch({ type: 'answer', sessionId, questionIndex: index, choiceIndex })
              }
              onNext={() => dispatch({ type: 'next', sessionId, questionIndex: index })}
            />
          </>
        )
      )}
    </div>
  );
}

interface QuestionViewProps {
  question: QuizQuestion;
  /** The picked choice once answered, otherwise null. */
  chosen: number | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
  nextRef: RefObject<HTMLButtonElement | null>;
  isLast: boolean;
  onAnswer(choiceIndex: number): void;
  onNext(): void;
}

function QuestionView({
  question,
  chosen,
  headingRef,
  nextRef,
  isLast,
  onAnswer,
  onNext,
}: QuestionViewProps) {
  const answered = chosen !== null;
  const correctChoice = question.choices.find((c) => c.isCorrect);
  const choseCorrectly = answered && question.choices[chosen]?.isCorrect === true;

  // A held Enter key repeats; it must not run straight through the next question.
  function ignoreRepeat(event: ReactKeyboardEvent) {
    if (event.repeat) event.preventDefault();
  }

  return (
    <section
      aria-labelledby="quiz-question"
      aria-describedby="quiz-instructions"
      className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">Term</p>
      <h2
        id="quiz-question"
        ref={headingRef}
        tabIndex={-1}
        className="mt-1 rounded text-2xl font-bold break-words whitespace-pre-wrap focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600"
      >
        {question.prompt}
      </h2>

      <ol aria-label="Answer choices" className="mt-6 grid gap-3">
        {question.choices.map((choice, i) => {
          const isChosen = chosen === i;
          let tone = 'border-gray-300 bg-white hover:border-indigo-400 hover:bg-indigo-50';
          let note: string | null = null;
          if (answered) {
            if (choice.isCorrect) {
              tone = 'border-green-500 bg-green-50 text-green-900';
              note = isChosen ? 'Your answer — correct' : 'Correct answer';
            } else if (isChosen) {
              tone = 'border-red-500 bg-red-50 text-red-900';
              note = 'Your answer — incorrect';
            } else {
              tone = 'border-gray-200 bg-white text-gray-500';
            }
          }
          return (
            <li key={i}>
              {/* aria-disabled keeps answered choices focusable and readable for review. */}
              <button
                type="button"
                className={`flex w-full items-start gap-3 rounded-lg border-2 px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 aria-disabled:cursor-default ${tone}`}
                aria-disabled={answered}
                aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
                onClick={() => onAnswer(i)}
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-current text-xs font-semibold"
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words whitespace-pre-wrap">{choice.text}</span>
                  {note && <span className="mt-1 block text-sm font-semibold">{note}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {answered && (
        <div
          className={`mt-6 rounded-lg border px-4 py-3 ${
            choseCorrectly ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
          }`}
        >
          <p className={`font-semibold ${choseCorrectly ? 'text-green-900' : 'text-red-900'}`}>
            {choseCorrectly ? 'Correct!' : 'Not quite.'}
          </p>
          {!choseCorrectly && correctChoice && (
            <p className="mt-1 text-sm break-words whitespace-pre-wrap text-red-900">
              The correct answer is: {correctChoice.text}
            </p>
          )}
          <button
            ref={nextRef}
            type="button"
            className={`${primaryButton} mt-3`}
            onKeyDown={ignoreRepeat}
            onClick={onNext}
          >
            {isLast ? 'See results' : 'Next question'}
          </button>
        </div>
      )}
    </section>
  );
}

interface QuizResultsProps {
  state: QuizState;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onRestart(): void;
}

function QuizResults({ state, headingRef, onRestart }: QuizResultsProps) {
  const results = quizResults(state);
  const total = state.questions.length;
  const score = quizScore(state);
  const percent = Math.round((score / total) * 100);
  const missed = results.filter((result) => !result.isCorrect);

  return (
    <section aria-labelledby="quiz-results" className="mt-6 space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <h2
          id="quiz-results"
          ref={headingRef}
          tabIndex={-1}
          className="rounded text-xl font-bold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600"
        >
          Quiz complete
        </h2>
        <p className="mt-2 text-3xl font-bold text-indigo-700">
          {score} / {total}
        </p>
        <p className="mt-1 text-gray-700">
          You answered {score} of {total} {total === 1 ? 'question' : 'questions'} correctly (
          {percent}%).
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button type="button" className={primaryButton} onClick={onRestart}>
            Restart quiz
          </button>
          <Link to="/" className={secondaryButton}>
            Back to home
          </Link>
        </div>
      </div>

      {missed.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold">Review your mistakes</h3>
          <ul className="mt-3 space-y-3">
            {missed.map(({ question, choiceIndex }) => (
              <li
                key={question.cardId}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <p className="font-semibold break-words whitespace-pre-wrap">{question.prompt}</p>
                <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-3">
                  <dt className="text-gray-500">Your answer</dt>
                  <dd className="break-words whitespace-pre-wrap text-red-800">
                    {question.choices[choiceIndex]?.text}
                  </dd>
                  <dt className="text-gray-500">Correct answer</dt>
                  <dd className="break-words whitespace-pre-wrap text-green-800">
                    {question.choices.find((c) => c.isCorrect)?.text}
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function NotEnoughCards({ cards }: { cards: readonly Card[] }) {
  const eligible = cards.filter(isQuizEligible).length;
  const left = cards.length - eligible;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Quiz</h1>
      <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-6">
        <h2 className="font-semibold">Not enough cards for a quiz</h2>
        <p className="mt-1 text-sm text-gray-600">
          A quiz needs at least two cards with different definitions, so every question has a wrong
          answer to choose from.{' '}
          {cards.length === 0
            ? 'You have no cards yet.'
            : `You have ${eligible} ${eligible === 1 ? 'card' : 'cards'} with both a term and a definition.`}
          {left > 0 &&
            ` ${left} ${left === 1 ? 'card is' : 'cards are'} missing a term or definition and can’t be quizzed.`}
        </p>
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
