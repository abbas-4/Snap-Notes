import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  CARD_KIND_LABELS,
  cardProblem,
  CARD_TYPE_CHOICES,
  DIFFICULTY_CHOICES,
  LIMITS,
  materialProblem,
  type CardTypeChoice,
  type DifficultyChoice,
} from '../../../supabase/functions/_shared/flashcards/contract.ts';
import type { GenerationClient } from '../../cloud/generation';
import { DEFAULT_DECK_ID } from '../../domain/appData';
import { textKey } from '../../domain/cardText';
import { toCardText, type SaveTarget } from '../../domain/generatedCards';
import { useAuth } from '../account/cloud';
import Notice from '../account/Notice';
import { useAppData } from '../appData';
import { DECK_PARAM, reviewLink, withDeck } from '../deckScope';
import { primaryButton, secondaryButton, selectField, textField } from '../styles';
import { useUnsavedChanges } from '../unsavedChanges';
import DraftCard from './DraftCard';
import {
  buildRequest,
  countDrafts,
  describeOutcome,
  describeWait,
  generatorReducer,
  initialGeneratorState,
  type GenerationSettings,
  type PendingRequest,
  type RequestPurpose,
} from './generatorState';
import MaterialInput from './MaterialInput';

const COUNT_OPTIONS = [5, 10, 15, 20, 25, 30] as const;
const MORE_OPTIONS = [3, 5, 10] as const;
const NEW_DECK = '__new__';

const TYPE_LABELS: Record<CardTypeChoice, string> = { ...CARD_KIND_LABELS, mixed: 'Mixed' };
const DIFFICULTY_LABELS: Record<DifficultyChoice, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  mixed: 'Mixed',
};

function PageHeader() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Generate cards with AI</h1>
      <p className="mt-2 text-gray-700">
        Turn your notes, a chapter or an article into flashcards. You review and edit every card
        before anything is saved.
      </p>
    </div>
  );
}

/**
 * The Generate page. Generation runs on Snap Notes’ server, which needs an
 * account: it keeps the provider’s key away from the browser and limits how
 * much each account can generate.
 */
export default function GeneratePage() {
  const auth = useAuth();

  if (auth.status === 'disabled') {
    return (
      <div className="space-y-6">
        <PageHeader />
        <Notice tone="info">
          AI card generation needs a Snap Notes server, and this copy of the app is running without
          one. Everything else works as usual, and you can always{' '}
          <Link to="/add" className="font-medium underline">
            add cards yourself
          </Link>
          .
        </Notice>
      </div>
    );
  }
  if (auth.status === 'loading') {
    return (
      <p role="status" className="text-gray-600">
        Loading…
      </p>
    );
  }
  if (auth.status !== 'signed-in' || !auth.services) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Sign in to generate cards</h2>
          <p className="mt-1 text-sm text-gray-600">
            AI generation needs a Snap Notes account: it runs on the Snap Notes server, which keeps
            each account to a fair share of generation, and your new cards sync like the rest.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to="/account/sign-in" className={primaryButton}>
              Sign in
            </Link>
            <Link to="/account/sign-up" className={secondaryButton}>
              Create an account
            </Link>
          </div>
        </div>
      </div>
    );
  }
  return <Generator client={auth.services.generation} />;
}

type ProviderStatus =
  | { state: 'checking' }
  | { state: 'ready'; configured: boolean; provider: string | null }
  | { state: 'unknown' };

function useProviderStatus(client: GenerationClient): ProviderStatus {
  const [status, setStatus] = useState<ProviderStatus>({ state: 'checking' });
  useEffect(() => {
    let live = true;
    void client.status().then((result) => {
      if (!live) return;
      setStatus(
        result.ok
          ? { state: 'ready', configured: result.value.configured, provider: result.value.provider }
          : { state: 'unknown' },
      );
    });
    return () => {
      live = false;
    };
  }, [client]);
  return status;
}

/** Ticks once a second while `running`, for "12 s" on the progress message. */
function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, Math.round((now - startedAt) / 1000));
}

interface SaveSummary {
  deckId: string;
  deckName: string;
  added: number;
  skipped: number;
}

function Generator({ client }: { client: GenerationClient }) {
  const { data, addCards } = useAppData();
  const { setDirty } = useUnsavedChanges();
  const [searchParams] = useSearchParams();
  const provider = useProviderStatus(client);

  // ----- Settings ---------------------------------------------------------
  const [material, setMaterial] = useState('');
  const [topic, setTopic] = useState('');
  const [cardType, setCardType] = useState<CardTypeChoice>('mixed');
  const [difficulty, setDifficulty] = useState<DifficultyChoice>('mixed');
  const [count, setCount] = useState(10);
  const [moreCount, setMoreCount] = useState(5);
  const [deckChoice, setDeckChoice] = useState(() => {
    const fromLink = searchParams.get(DECK_PARAM);
    if (fromLink && data.decks.some((d) => d.id === fromLink)) return fromLink;
    return data.decks.find((d) => d.id === DEFAULT_DECK_ID)?.id ?? data.decks[0]?.id ?? NEW_DECK;
  });
  const [newDeckName, setNewDeckName] = useState('');
  // A deck chosen earlier may have been deleted in another tab, or by sync.
  const deckExists = data.decks.some((d) => d.id === deckChoice);
  const effectiveDeck = deckChoice === NEW_DECK || deckExists ? deckChoice : NEW_DECK;
  const targetDeck = data.decks.find((d) => d.id === effectiveDeck);

  // ----- Generation -------------------------------------------------------
  const [state, dispatch] = useReducer(generatorReducer, initialGeneratorState);
  const pendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const elapsed = useElapsed(state.pending?.startedAt ?? null);
  const counts = countDrafts(state.drafts);
  const busy = state.pending !== null;
  const [saveSummary, setSaveSummary] = useState<SaveSummary | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);

  const settings: GenerationSettings = { material, topic, cardType, difficulty, count };
  const problem = materialProblem(material);
  const available = !(provider.state === 'ready' && !provider.configured);

  // Unsaved generated cards are protected like an unsaved card form.
  const dirty = counts.unsaved > 0;
  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  // Leaving the page abandons a request in flight.
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async (pending: PendingRequest) => {
      // A second click while one request runs is ignored, before React re-renders.
      if (pendingRef.current) return;
      pendingRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      setSaveError(null);
      dispatch({ type: 'start', pending, now: Date.now() });
      try {
        const result = await client.generate(pending.request, controller.signal);
        if (result.ok) {
          dispatch({
            type: 'success',
            cards: result.value.cards,
            requested: result.value.requested,
            discarded: result.value.discarded,
          });
          if (pending.purpose.kind === 'initial' && result.value.cards.length > 0) {
            requestAnimationFrame(() => reviewHeading.current?.focus());
          }
        } else if (result.code === 'cancelled') {
          dispatch({ type: 'cancelled' });
        } else {
          dispatch({ type: 'failure', failure: result });
        }
      } finally {
        pendingRef.current = false;
        abortRef.current = null;
      }
    },
    [client],
  );

  function start(purpose: RequestPurpose) {
    void run({ purpose, request: buildRequest(settings, purpose, state.drafts, moreCount) });
  }

  function generateNew() {
    if (problem !== null || busy) return;
    if (
      counts.unsaved > 0 &&
      !window.confirm(
        `Replace the ${counts.unsaved} unsaved ${counts.unsaved === 1 ? 'card' : 'cards'} below with a new set? They have not been saved.`,
      )
    ) {
      return;
    }
    setSaveSummary(null);
    start({ kind: 'initial' });
  }

  // ----- Saving -----------------------------------------------------------
  const deckCardKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const card of data.cards) {
      if (card.deckId === effectiveDeck)
        keys.add(`${textKey(card.term)}\u0000${textKey(card.definition)}`);
    }
    return keys;
  }, [data.cards, effectiveDeck]);

  function duplicateIn(draftCard: Parameters<typeof toCardText>[0]): string | null {
    if (!targetDeck) return null;
    const text = toCardText(draftCard);
    return deckCardKeys.has(`${textKey(text.term)}\u0000${textKey(text.definition)}`)
      ? targetDeck.name
      : null;
  }

  function save() {
    setSaveError(null);
    const chosen = state.drafts.filter((draft) => draft.selected && draft.saved === null);
    if (chosen.length === 0) return;
    const broken = chosen.filter((draft) => cardProblem(draft.card) !== null);
    if (broken.length > 0) {
      setSaveError(
        `${broken.length === 1 ? 'One selected card needs' : `${broken.length} selected cards need`} fixing first (marked in red), or untick ${broken.length === 1 ? 'it' : 'them'}.`,
      );
      document.getElementById(`draft-${broken[0]!.id}-question`)?.focus();
      return;
    }
    const name = newDeckName.trim() || topic.trim() || 'Generated cards';
    const target: SaveTarget =
      effectiveDeck === NEW_DECK ? { newDeckName: name } : { deckId: effectiveDeck };
    const result = addCards(
      target,
      chosen.map((draft) => toCardText(draft.card)),
    );
    if (!result.ok) {
      setSaveError(result.message);
      return;
    }
    dispatch({
      type: 'saved',
      results: chosen.map((draft, i) => ({ draftId: draft.id, cardId: result.cardIds[i] ?? null })),
    });
    // Later saves go to the same deck, rather than creating another one.
    setDeckChoice(result.deckId);
    setNewDeckName('');
    const added = result.cardIds.filter((id) => id !== null).length;
    setSaveSummary({
      deckId: result.deckId,
      deckName: 'newDeckName' in target ? name : (targetDeck?.name ?? 'your deck'),
      added,
      skipped: result.cardIds.length - added,
    });
  }

  const outcomeText = state.lastOutcome ? describeOutcome(state.lastOutcome) : null;
  const failure = state.error?.failure;
  const pendingPurpose = state.pending?.purpose;
  const saveLabel =
    effectiveDeck === NEW_DECK
      ? `Save ${counts.selected} ${counts.selected === 1 ? 'card' : 'cards'} to a new deck`
      : `Save ${counts.selected} ${counts.selected === 1 ? 'card' : 'cards'} to “${targetDeck?.name ?? ''}”`;

  return (
    <div className="space-y-8">
      <PageHeader />

      {provider.state === 'ready' && !provider.configured ? (
        <Notice tone="warning" role="status">
          AI card generation is not set up on this Snap Notes server yet, so cards cannot be
          generated right now. You can still{' '}
          <Link to="/add" className="font-medium underline">
            add cards yourself
          </Link>
          .
        </Notice>
      ) : (
        <Notice tone="info">
          <p>
            <strong>How your material is used:</strong> when you generate, the text below is sent
            through Snap Notes’ server to{' '}
            {provider.state === 'ready' && provider.provider ? provider.provider : 'an AI provider'}{' '}
            to write the cards. Snap Notes does not store the text. Documents you choose are read on
            this device first.
          </p>
          <p className="mt-1">
            AI-written cards can contain mistakes. Check each one against your material before you
            study it.
          </p>
        </Notice>
      )}

      <section aria-labelledby="generate-material-heading" className="space-y-3">
        <h2 id="generate-material-heading" className="text-lg font-semibold">
          1. Your material
        </h2>
        <MaterialInput value={material} onChange={setMaterial} disabled={busy} problem={problem} />
      </section>

      <section aria-labelledby="generate-settings-heading" className="space-y-4">
        <h2 id="generate-settings-heading" className="text-lg font-semibold">
          2. Settings
        </h2>
        <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="generate-topic" className="block text-sm font-medium text-gray-700">
              Topic <span className="font-normal text-gray-500">(optional)</span>
            </label>
            <input
              id="generate-topic"
              type="text"
              className={`${textField} mt-1`}
              maxLength={LIMITS.topicMaxChars}
              placeholder="For example: Cell biology"
              value={topic}
              disabled={busy}
              onChange={(event) => setTopic(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="generate-type" className="block text-sm font-medium text-gray-700">
              Card type
            </label>
            <select
              id="generate-type"
              className={`${selectField} mt-1 w-full`}
              value={cardType}
              disabled={busy}
              onChange={(event) => setCardType(event.target.value as CardTypeChoice)}
            >
              {CARD_TYPE_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {TYPE_LABELS[choice]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="generate-difficulty"
              className="block text-sm font-medium text-gray-700"
            >
              Difficulty
            </label>
            <select
              id="generate-difficulty"
              className={`${selectField} mt-1 w-full`}
              value={difficulty}
              disabled={busy}
              onChange={(event) => setDifficulty(event.target.value as DifficultyChoice)}
            >
              {DIFFICULTY_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {DIFFICULTY_LABELS[choice]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="generate-count" className="block text-sm font-medium text-gray-700">
              Number of cards
            </label>
            <select
              id="generate-count"
              className={`${selectField} mt-1 w-full`}
              value={count}
              disabled={busy}
              onChange={(event) => setCount(Number(event.target.value))}
              aria-describedby="generate-count-hint"
            >
              {COUNT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <p id="generate-count-hint" className="mt-1 text-xs text-gray-500">
              Up to {LIMITS.countMax} at a time. Fewer may come back if the material is short.
            </p>
          </div>
          <div>
            <label htmlFor="generate-deck" className="block text-sm font-medium text-gray-700">
              Save cards to
            </label>
            <select
              id="generate-deck"
              className={`${selectField} mt-1 w-full`}
              value={effectiveDeck}
              disabled={busy}
              onChange={(event) => {
                setDeckChoice(event.target.value);
                setSaveError(null);
              }}
            >
              {data.decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name}
                </option>
              ))}
              <option value={NEW_DECK}>New deck…</option>
            </select>
            {effectiveDeck === NEW_DECK && (
              <div className="mt-2">
                <label
                  htmlFor="generate-new-deck"
                  className="block text-sm font-medium text-gray-700"
                >
                  New deck name
                </label>
                <input
                  id="generate-new-deck"
                  type="text"
                  className={`${textField} mt-1`}
                  placeholder={topic.trim() || 'Generated cards'}
                  value={newDeckName}
                  disabled={busy}
                  onChange={(event) => {
                    setNewDeckName(event.target.value);
                    setSaveError(null);
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={primaryButton}
            onClick={generateNew}
            disabled={busy || problem !== null || !available}
            aria-describedby={problem && material === '' ? 'generate-needs-material' : undefined}
          >
            {pendingPurpose?.kind === 'initial'
              ? 'Generating…'
              : state.drafts.length > 0
                ? 'Generate a new set'
                : 'Generate cards'}
          </button>
          {busy && (
            <button
              type="button"
              className={secondaryButton}
              onClick={() => abortRef.current?.abort()}
            >
              Cancel
            </button>
          )}
          {!busy && problem && material === '' && (
            <p id="generate-needs-material" className="text-sm text-gray-600">
              Add some study material to begin.
            </p>
          )}
        </div>

        {state.pending && (
          <div role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
            <p className="text-sm font-medium text-indigo-900">
              {state.pending.purpose.kind === 'single'
                ? 'Writing a replacement card…'
                : `Reading your material and writing ${state.pending.request.count} ${state.pending.request.count === 1 ? 'card' : 'cards'}…`}{' '}
              <span className="tabular-nums text-indigo-700">{elapsed} s</span>
            </p>
            <div
              className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-indigo-100"
              aria-hidden="true"
            >
              <div className="h-full w-1/3 animate-generate-progress rounded-full bg-indigo-600 motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60" />
            </div>
            <p className="mt-2 text-xs text-indigo-800">
              This usually takes 15–60 seconds, depending on how many cards you asked for.
            </p>
          </div>
        )}

        {failure && state.error && (
          <Notice tone="error" role="alert">
            <p>{failure.message}</p>
            {failure.retryAfterSeconds && (
              <p className="mt-1">
                You can try again in {describeWait(failure.retryAfterSeconds)}.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-3">
              {failure.code === 'unauthenticated' ? (
                <Link to="/account/sign-in" className={secondaryButton}>
                  Sign in again
                </Link>
              ) : (
                failure.code !== 'not-configured' &&
                failure.code !== 'invalid-request' && (
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={() => {
                      const retry = state.error?.retry;
                      if (retry) void run(retry);
                    }}
                  >
                    Try again
                  </button>
                )
              )}
              <button
                type="button"
                className={secondaryButton}
                onClick={() => dispatch({ type: 'dismiss-error' })}
              >
                Dismiss
              </button>
            </div>
          </Notice>
        )}
      </section>

      {(state.drafts.length > 0 || state.lastOutcome) && (
        <section aria-labelledby="generate-review-heading" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2
              id="generate-review-heading"
              ref={reviewHeading}
              tabIndex={-1}
              className="text-lg font-semibold focus:outline-none"
            >
              3. Review and save
            </h2>
            {state.drafts.length > 0 && (
              <p className="text-sm text-gray-700" aria-live="polite" data-testid="draft-counts">
                <span className="font-semibold">{counts.generated}</span> generated ·{' '}
                <span className="font-semibold">{counts.selected}</span> selected ·{' '}
                <span className="font-semibold">{counts.saved}</span> saved
              </p>
            )}
          </div>

          {outcomeText && (
            <Notice tone={state.drafts.length === 0 ? 'warning' : 'info'} role="status">
              {outcomeText}
            </Notice>
          )}

          {state.drafts.length > 0 && (
            <>
              {counts.unsaved > 0 && (
                <div className="flex flex-wrap gap-3 text-sm">
                  <button
                    type="button"
                    className="font-medium text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-50"
                    onClick={() => dispatch({ type: 'select-all', selected: true })}
                    disabled={busy}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="font-medium text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-50"
                    onClick={() => dispatch({ type: 'select-all', selected: false })}
                    disabled={busy}
                  >
                    Select none
                  </button>
                </div>
              )}

              <ol className="space-y-4" aria-label="Generated cards">
                {state.drafts.map((draft, index) => (
                  <DraftCard
                    key={draft.id}
                    draft={draft}
                    number={index + 1}
                    duplicateOf={draft.saved ? null : duplicateIn(draft.card)}
                    busy={busy}
                    regenerating={
                      pendingPurpose?.kind === 'single' && pendingPurpose.draftId === draft.id
                    }
                    onEdit={(card) => dispatch({ type: 'edit', draftId: draft.id, card })}
                    onKind={(kind) => dispatch({ type: 'set-kind', draftId: draft.id, kind })}
                    onToggle={(selected) =>
                      dispatch({ type: 'toggle', draftId: draft.id, selected })
                    }
                    onRegenerate={() => start({ kind: 'single', draftId: draft.id })}
                    onRemove={() => dispatch({ type: 'remove', draftId: draft.id })}
                  />
                ))}
              </ol>

              <div className="flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-gray-300 bg-white p-4">
                <div>
                  <label
                    htmlFor="generate-more-count"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Need more?
                  </label>
                  <select
                    id="generate-more-count"
                    className={`${selectField} mt-1`}
                    value={moreCount}
                    disabled={busy}
                    onChange={(event) => setMoreCount(Number(event.target.value))}
                  >
                    {MORE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n} more
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => start({ kind: 'more' })}
                  disabled={busy || problem !== null || !available}
                >
                  {pendingPurpose?.kind === 'more' ? 'Generating…' : 'Generate more cards'}
                </button>
                <p className="w-full text-xs text-gray-500">
                  New cards avoid the questions already in this list.
                </p>
              </div>
            </>
          )}

          {saveError && (
            <Notice tone="error" role="alert">
              {saveError}
            </Notice>
          )}

          {saveSummary && (
            <Notice tone="success" role="status">
              <p>
                Saved {saveSummary.added} {saveSummary.added === 1 ? 'card' : 'cards'} to “
                {saveSummary.deckName}”.
                {saveSummary.skipped > 0 &&
                  ` ${saveSummary.skipped} ${saveSummary.skipped === 1 ? 'was' : 'were'} already in the deck and ${saveSummary.skipped === 1 ? 'was' : 'were'} not added again.`}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Link to={reviewLink('new', saveSummary.deckId)} className={primaryButton}>
                  Study the new cards
                </Link>
                <Link
                  to={`/decks/${encodeURIComponent(saveSummary.deckId)}`}
                  className={secondaryButton}
                >
                  Open the deck
                </Link>
                <Link to={withDeck('/list', saveSummary.deckId)} className={secondaryButton}>
                  See its cards
                </Link>
              </div>
            </Notice>
          )}

          {counts.unsaved > 0 && (
            <div className="sticky bottom-0 -mx-4 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-700">
                  {counts.selected === 0
                    ? 'Tick the cards you want to keep.'
                    : `${counts.selected} of ${counts.unsaved} unsaved ${counts.unsaved === 1 ? 'card' : 'cards'} selected.`}
                </p>
                <button
                  type="button"
                  className={primaryButton}
                  onClick={save}
                  disabled={busy || counts.selected === 0}
                >
                  {saveLabel}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
