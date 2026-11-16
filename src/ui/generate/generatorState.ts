import {
  LIMITS,
  type CardKind,
  type CardTypeChoice,
  type DifficultyChoice,
  type DiscardCounts,
  type GenerateRequest,
  type GeneratedCard,
} from '../../../supabase/functions/_shared/flashcards/contract.ts';
import type { GenerationFailure } from '../../cloud/generation';
import { convertKind } from '../../domain/generatedCards';

/**
 * The review list on the Generate page, as a reducer: the cards the AI wrote,
 * what the user did to each, and the request in flight. Pure, so every rule
 * (one request at a time, regenerating in place, saved cards staying saved)
 * is tested without rendering anything.
 */

export interface Draft {
  /** Local to this page; a saved card gets a real ID from the collection. */
  id: string;
  card: GeneratedCard;
  selected: boolean;
  /**
   * Set once saved: the new card's ID, or null when the deck already had the
   * same card and it was skipped. A saved draft is never saved again.
   */
  saved: { cardId: string | null } | null;
  /** The user changed it after generation. */
  edited: boolean;
}

/** What a request is for: a fresh set, more cards for the list, or a replacement for one card. */
export type RequestPurpose =
  { kind: 'initial' } | { kind: 'more' } | { kind: 'single'; draftId: string };

export interface PendingRequest {
  purpose: RequestPurpose;
  request: GenerateRequest;
}

export interface LastOutcome {
  purpose: RequestPurpose['kind'];
  requested: number;
  received: number;
  discarded: DiscardCounts;
}

export interface GeneratorState {
  drafts: Draft[];
  pending: (PendingRequest & { startedAt: number }) | null;
  /** The last failure, with the request that failed so it can be retried as it was. */
  error: { failure: GenerationFailure; retry: PendingRequest } | null;
  lastOutcome: LastOutcome | null;
  nextId: number;
}

export const initialGeneratorState: GeneratorState = {
  drafts: [],
  pending: null,
  error: null,
  lastOutcome: null,
  nextId: 1,
};

export type GeneratorAction =
  | { type: 'start'; pending: PendingRequest; now: number }
  | {
      type: 'success';
      cards: GeneratedCard[];
      requested: number;
      discarded: DiscardCounts;
    }
  | { type: 'failure'; failure: GenerationFailure }
  | { type: 'cancelled' }
  | { type: 'dismiss-error' }
  | { type: 'edit'; draftId: string; card: GeneratedCard }
  | { type: 'set-kind'; draftId: string; kind: CardKind }
  | { type: 'toggle'; draftId: string; selected: boolean }
  | { type: 'select-all'; selected: boolean }
  | { type: 'remove'; draftId: string }
  | { type: 'saved'; results: ReadonlyArray<{ draftId: string; cardId: string | null }> }
  | { type: 'clear' };

function newDrafts(state: GeneratorState, cards: readonly GeneratedCard[]) {
  let nextId = state.nextId;
  const drafts = cards.map((card): Draft => ({
    id: `draft-${nextId++}`,
    card,
    selected: true,
    saved: null,
    edited: false,
  }));
  return { drafts, nextId };
}

function updateDraft(
  state: GeneratorState,
  draftId: string,
  change: (draft: Draft) => Draft,
): GeneratorState {
  return {
    ...state,
    drafts: state.drafts.map((draft) =>
      draft.id === draftId && draft.saved === null ? change(draft) : draft,
    ),
  };
}

export function generatorReducer(state: GeneratorState, action: GeneratorAction): GeneratorState {
  switch (action.type) {
    case 'start':
      // One request at a time: a second click while one is running does nothing.
      if (state.pending) return state;
      return { ...state, pending: { ...action.pending, startedAt: action.now }, error: null };

    case 'success': {
      if (!state.pending) return state;
      const purpose = state.pending.purpose;
      const outcome: LastOutcome = {
        purpose: purpose.kind,
        requested: action.requested,
        received: action.cards.length,
        discarded: action.discarded,
      };
      const base = { ...state, pending: null, error: null, lastOutcome: outcome };

      if (purpose.kind === 'single') {
        const replacement = action.cards[0];
        if (!replacement) return base;
        return {
          ...base,
          drafts: state.drafts.map((draft) =>
            draft.id === purpose.draftId && draft.saved === null
              ? { ...draft, card: replacement, edited: false, selected: true }
              : draft,
          ),
        };
      }
      const { drafts, nextId } = newDrafts(state, action.cards);
      return {
        ...base,
        nextId,
        drafts: purpose.kind === 'initial' ? drafts : [...state.drafts, ...drafts],
      };
    }

    case 'failure':
      if (!state.pending) return state;
      return {
        ...state,
        pending: null,
        error: {
          failure: action.failure,
          retry: { purpose: state.pending.purpose, request: state.pending.request },
        },
      };

    case 'cancelled':
      return { ...state, pending: null };

    case 'dismiss-error':
      return { ...state, error: null };

    case 'edit':
      return updateDraft(state, action.draftId, (draft) => ({
        ...draft,
        card: action.card,
        edited: true,
      }));

    case 'set-kind':
      return updateDraft(state, action.draftId, (draft) => ({
        ...draft,
        card: convertKind(draft.card, action.kind),
        edited: true,
      }));

    case 'toggle':
      return updateDraft(state, action.draftId, (draft) => ({
        ...draft,
        selected: action.selected,
      }));

    case 'select-all':
      return {
        ...state,
        drafts: state.drafts.map((draft) =>
          draft.saved === null ? { ...draft, selected: action.selected } : draft,
        ),
      };

    case 'remove':
      return { ...state, drafts: state.drafts.filter((draft) => draft.id !== action.draftId) };

    case 'saved': {
      const results = new Map(action.results.map((r) => [r.draftId, r.cardId]));
      return {
        ...state,
        drafts: state.drafts.map((draft) =>
          results.has(draft.id)
            ? { ...draft, saved: { cardId: results.get(draft.id) ?? null }, selected: false }
            : draft,
        ),
      };
    }

    case 'clear':
      return { ...initialGeneratorState, nextId: state.nextId };
  }
}

export interface GeneratorCounts {
  generated: number;
  selected: number;
  saved: number;
  unsaved: number;
}

export function countDrafts(drafts: readonly Draft[]): GeneratorCounts {
  let selected = 0;
  let saved = 0;
  for (const draft of drafts) {
    if (draft.saved) saved += 1;
    else if (draft.selected) selected += 1;
  }
  return { generated: drafts.length, selected, saved, unsaved: drafts.length - saved };
}

export interface GenerationSettings {
  material: string;
  topic: string;
  cardType: CardTypeChoice;
  difficulty: DifficultyChoice;
  count: number;
}

/**
 * The request for a purpose. Every request lists the questions already in the
 * review list (most recent first, within the server's limits) so new cards do
 * not repeat them.
 */
export function buildRequest(
  settings: GenerationSettings,
  purpose: RequestPurpose,
  drafts: readonly Draft[],
  moreCount: number,
): GenerateRequest {
  const others = purpose.kind === 'initial' ? [] : drafts;
  const avoid = others
    .map((draft) => draft.card.question.slice(0, LIMITS.avoidItemMaxChars))
    .slice(-LIMITS.avoidMax);
  const topic = settings.topic.trim();
  const base = {
    action: 'generate' as const,
    material: settings.material,
    ...(topic ? { topic } : {}),
    avoid,
  };
  if (purpose.kind === 'single') {
    const draft = drafts.find((d) => d.id === purpose.draftId);
    return {
      ...base,
      count: 1,
      cardType: draft?.card.kind ?? settings.cardType,
      difficulty: draft?.card.difficulty ?? settings.difficulty,
    };
  }
  return {
    ...base,
    count: purpose.kind === 'more' ? moreCount : settings.count,
    cardType: settings.cardType,
    difficulty: settings.difficulty,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What the last request produced, in words, when it is worth saying: fewer
 * cards than asked for, and why the rest were left out. Null when every card
 * asked for arrived.
 */
export function describeOutcome(outcome: LastOutcome): string | null {
  const { purpose, requested, received, discarded } = outcome;
  if (received >= requested) return null;
  const reasons = [
    discarded.ungrounded > 0 &&
      `${plural(discarded.ungrounded, 'was', 'were')} not supported by your material`,
    discarded.duplicate > 0 &&
      `${plural(discarded.duplicate, 'repeated', 'repeated')} another card`,
    discarded.invalid > 0 && `${plural(discarded.invalid, 'was', 'were')} incomplete`,
  ].filter((reason): reason is string => typeof reason === 'string');
  const why = reasons.length > 0 ? ` Left out: ${reasons.join(', ')}.` : '';

  if (purpose === 'single') {
    return `A different card could not be written for this one.${why} Try again, or edit the card yourself.`;
  }
  if (received === 0) {
    return purpose === 'more'
      ? `No new cards could be written: the material may already be covered by the cards you have.${why}`
      : `No cards could be written from this material. Check it has enough to learn from, then try again.${why}`;
  }
  return `Wrote ${received} of the ${requested} cards asked for: the material did not support more.${why}`;
}

/** "about 3 minutes", for telling the user when to try again. */
export function describeWait(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `about ${plural(minutes, 'minute', 'minutes')}`;
  return `about ${plural(Math.ceil(minutes / 60), 'hour', 'hours')}`;
}
