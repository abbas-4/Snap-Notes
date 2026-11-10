import { useCallback, useReducer, useRef, type RefObject } from 'react';
import { Link } from 'react-router';
import { hasBothSides } from '../domain/cardText';
import {
  buildMatchRound,
  matchableCards,
  MIN_PAIR_COUNT,
  type MatchRound,
  type MatchTile,
} from '../domain/match';
import {
  elapsedMs,
  findTile,
  isTileMatched,
  matchAccuracy,
  matchPhase,
  matchReducer,
  mistakeCount,
  pairCount,
  startMatch,
  type MatchState,
} from '../domain/matchSession';
import type { Card } from '../domain/types';
import { eligibilitySummary } from './cardText';
import DeckNotFound from './DeckNotFound';
import { useDeckScope, withDeck } from './deckScope';
import DeckScopeNotice from './DeckScopeNotice';
import EmptyState from './EmptyState';
import { formatElapsed, spokenDuration } from './formatDuration';
import ProgressBar from './ProgressBar';
import { primaryButton, secondaryButton } from './styles';
import { useFocusOnChange } from './useFocusOnChange';
import { useNow } from './useNow';

const focusRing =
  'rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600';

export default function MatchPage() {
  const { deck, deckId, unknownDeck, cards } = useDeckScope();

  if (unknownDeck) return <DeckNotFound />;

  if (matchableCards(cards).length < MIN_PAIR_COUNT) {
    const eligible = cards.filter(hasBothSides).length;
    return (
      <EmptyState
        pageTitle="Match"
        heading="Not enough cards to match"
        addHref={withDeck('/add', deckId)}
        backHref={deck ? `/decks/${deck.id}` : '/'}
        backLabel={deck ? 'Back to the deck' : 'Back to home'}
      >
        Match needs at least two cards with different terms and definitions.{' '}
        {eligibilitySummary(cards.length, eligible)}
      </EmptyState>
    );
  }

  // The round works on a snapshot of the cards taken when it starts.
  return (
    <>
      {deck && <DeckScopeNotice deck={deck} />}
      <MatchSession cards={cards} />
    </>
  );
}

/** An empty round, only used if the cards change between the check above and the build. */
const NO_ROUND: MatchRound = { terms: [], definitions: [] };

function newRound(cards: readonly Card[]): MatchRound {
  return buildMatchRound(cards) ?? NO_ROUND;
}

function MatchSession({ cards }: { cards: readonly Card[] }) {
  const [state, dispatch] = useReducer(matchReducer, cards, (initial) =>
    startMatch(newRound(initial)),
  );
  const phase = matchPhase(state);
  const { sessionId } = state;
  const total = pairCount(state);
  const matchedCount = state.matched.length;
  const mistakes = mistakeCount(state);

  const running = state.startedAt !== null && phase === 'playing';
  const now = useNow(running);
  const elapsed = elapsedMs(state, now);

  const termsHeadingRef = useRef<HTMLHeadingElement>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);

  // To the results when the round ends; back to the top of the board on a new round.
  const focusOnChange = useCallback(() => {
    if (phase === 'finished') resultsRef.current?.focus();
    else termsHeadingRef.current?.focus();
  }, [phase]);
  useFocusOnChange(`${sessionId}:${phase}`, focusOnChange);

  function select(tileId: string) {
    dispatch({ type: 'select', sessionId, tileId, at: Date.now() });
  }

  function restart() {
    dispatch({ type: 'restart', round: newRound(cards) });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Match</h1>
        <div className="flex gap-3">
          {phase === 'playing' && (
            <button type="button" className={secondaryButton} onClick={restart}>
              New round
            </button>
          )}
          <Link to="/" className={secondaryButton}>
            Exit match
          </Link>
        </div>
      </div>

      {/* Announces selections and the result of each pair to screen readers. */}
      <p role="status" className="sr-only">
        {announcement(state)}
      </p>

      {phase === 'finished' ? (
        <MatchResults state={state} headingRef={resultsRef} onRestart={restart} />
      ) : (
        <>
          <p id="match-instructions" className="mt-2 text-sm text-gray-600">
            Select a term, then the definition that goes with it (or the other way round). The timer
            starts with your first pick. Keyboard: <kbd>Tab</kbd> moves between tiles,{' '}
            <kbd>Enter</kbd> or <kbd>Space</kbd> selects.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="shrink-0 text-sm font-medium text-gray-700">
              Matched {matchedCount} of {total}
            </p>
            <div className="min-w-32 flex-1">
              <ProgressBar value={matchedCount} max={total} label="Pairs matched" />
            </div>
            <p className="shrink-0 text-sm text-gray-700">
              Mistakes: <strong>{mistakes}</strong>
            </p>
            <p className="shrink-0 text-sm text-gray-700">
              Time:{' '}
              <strong role="timer" aria-label={`Time ${spokenDuration(elapsed)}`}>
                {formatElapsed(elapsed)}
              </strong>
            </p>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <TileList
              id="match-terms"
              title="Terms"
              tiles={state.round.terms}
              state={state}
              headingRef={termsHeadingRef}
              onSelect={select}
            />
            <TileList
              id="match-definitions"
              title="Definitions"
              tiles={state.round.definitions}
              state={state}
              onSelect={select}
            />
          </div>
        </>
      )}
    </div>
  );
}

function announcement(state: MatchState): string {
  if (matchPhase(state) === 'finished') return '';
  const { lastAttempt } = state;
  if (lastAttempt) {
    const term = findTile(state, lastAttempt.termId)?.text ?? '';
    const definition = findTile(state, lastAttempt.definitionId)?.text ?? '';
    return lastAttempt.correct
      ? `Match: ${term} — ${definition}. ${state.matched.length} of ${pairCount(state)} matched.`
      : `Not a match: ${term} and ${definition}. Mistakes: ${mistakeCount(state)}.`;
  }
  const selected = state.selected === null ? undefined : findTile(state, state.selected);
  if (!selected) return '';
  return selected.side === 'term'
    ? `Selected term: ${selected.text}. Now choose its definition.`
    : `Selected definition: ${selected.text}. Now choose its term.`;
}

interface TileListProps {
  id: string;
  title: string;
  tiles: readonly MatchTile[];
  state: MatchState;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  onSelect(tileId: string): void;
}

function TileList({ id, title, tiles, state, headingRef, onSelect }: TileListProps) {
  const { lastAttempt } = state;
  const missed =
    lastAttempt && !lastAttempt.correct
      ? [lastAttempt.termId, lastAttempt.definitionId]
      : ([] as string[]);

  return (
    <section aria-labelledby={`${id}-heading`}>
      <h2
        id={`${id}-heading`}
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className={`text-xs font-semibold tracking-wide text-gray-500 uppercase ${focusRing}`}
      >
        {title}
      </h2>
      <ul aria-labelledby={`${id}-heading`} className="mt-2 grid gap-2">
        {tiles.map((tile) => {
          const matched = isTileMatched(state, tile);
          const selected = state.selected === tile.id;
          const wrong = missed.includes(tile.id);

          let tone = 'border-gray-300 bg-white hover:border-indigo-400 hover:bg-indigo-50';
          let note: { icon: string; text: string } | null = null;
          if (matched) {
            tone = 'border-green-500 bg-green-50 text-green-900';
            note = { icon: '✓', text: 'Matched' };
          } else if (wrong) {
            tone = 'border-red-500 bg-red-50 text-red-900';
            note = { icon: '✗', text: 'Not a match' };
          } else if (selected) {
            tone = 'border-indigo-600 bg-indigo-50 text-indigo-950 ring-2 ring-indigo-600';
            note = { icon: '•', text: 'Selected' };
          }

          return (
            <li key={tile.id}>
              {/* aria-disabled keeps matched tiles focusable, so focus never drops to the page. */}
              <button
                type="button"
                className={`flex min-h-12 w-full flex-col items-start justify-center rounded-lg border-2 px-4 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 aria-disabled:cursor-default ${tone}`}
                aria-pressed={matched ? undefined : selected}
                aria-disabled={matched}
                onClick={() => onSelect(tile.id)}
              >
                <span className="block w-full break-words whitespace-pre-wrap">{tile.text}</span>
                {note && (
                  <span className="mt-0.5 block text-xs font-semibold">
                    <span aria-hidden="true">{note.icon} </span>
                    {note.text}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface MatchResultsProps {
  state: MatchState;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onRestart(): void;
}

function MatchResults({ state, headingRef, onRestart }: MatchResultsProps) {
  const total = pairCount(state);
  const mistakes = mistakeCount(state);
  const time = elapsedMs(state, state.finishedAt ?? 0);
  const percent = Math.round(matchAccuracy(state) * 100);

  return (
    <section
      aria-labelledby="match-results"
      className="mt-6 rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8"
    >
      <h2
        id="match-results"
        ref={headingRef}
        tabIndex={-1}
        className={`text-xl font-bold ${focusRing}`}
      >
        All matched!
      </h2>
      <p className="mt-2 text-3xl font-bold text-indigo-700">
        <span aria-hidden="true">{formatElapsed(time)}</span>
        <span className="sr-only">{spokenDuration(time)}</span>
      </p>
      <p className="mt-1 text-gray-700">
        You matched {total} {total === 1 ? 'pair' : 'pairs'} in {spokenDuration(time)} with{' '}
        {mistakes} {mistakes === 1 ? 'mistake' : 'mistakes'} ({percent}% accuracy).
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <button type="button" className={primaryButton} onClick={onRestart}>
          Play again
        </button>
        <Link to="/" className={secondaryButton}>
          Back to home
        </Link>
      </div>
    </section>
  );
}
