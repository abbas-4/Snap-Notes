import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import App from '../App';
import { createDefaultDeck } from '../domain/appData';
import type { DailyActivity } from '../domain/progressStats';
import { START_EASE, type CardProgress } from '../domain/srs';
import { SCHEMA_VERSION, type AppData, type Card, type Deck } from '../domain/types';
import { STORAGE_KEY } from '../storage/localStore';
import {
  PROGRESS_STORAGE_KEY,
  PROGRESS_VERSION,
  type ProgressData,
} from '../storage/progressStore';
import { MemoryStorage } from './memoryStorage';

const BASE_TIME = 1_700_000_000_000;
let counter = 0;

/** A valid card with distinct, increasing timestamps. Override what a test cares about. */
export function makeCard(overrides: Partial<Card> = {}): Card {
  counter += 1;
  return {
    id: `card-${counter}`,
    deckId: 'default',
    term: `Term ${counter}`,
    definition: `Definition ${counter}`,
    createdAt: BASE_TIME + counter * 1000,
    updatedAt: BASE_TIME + counter * 1000,
    ...overrides,
  };
}

/** A valid deck. Pass `id` and `name` when cards need to point at it. */
export function makeDeck(overrides: Partial<Deck> = {}): Deck {
  counter += 1;
  return {
    id: `deck-${counter}`,
    name: `Deck ${counter}`,
    createdAt: BASE_TIME + counter * 1000,
    updatedAt: BASE_TIME + counter * 1000,
    ...overrides,
  };
}

/** Defaults to the single "My Cards" deck every collection starts with. */
export function makeAppData(cards: Card[] = [], decks?: Deck[]): AppData {
  return { schemaVersion: SCHEMA_VERSION, decks: decks ?? [createDefaultDeck(BASE_TIME)], cards };
}

/** Storage pre-seeded with valid v2 data holding the given cards. */
export function storageWithCards(cards: Card[]): MemoryStorage {
  return new MemoryStorage({ [STORAGE_KEY]: JSON.stringify(makeAppData(cards)) });
}

/** Storage pre-seeded with whole v2 data, for tests that need several decks. */
export function storageWithData(data: AppData): MemoryStorage {
  return new MemoryStorage({ [STORAGE_KEY]: JSON.stringify(data) });
}

/** A learning record for a card, already scheduled. Override what a test cares about. */
export function makeProgress(overrides: Partial<CardProgress> & { cardId: string }): CardProgress {
  const now = Date.now();
  return {
    deckId: 'default',
    reviews: 1,
    correct: 1,
    incorrect: 0,
    stage: 'review',
    intervalDays: 1,
    ease: START_EASE,
    lastReviewedAt: now - 86_400_000,
    dueAt: now + 86_400_000,
    streak: 1,
    ...overrides,
  };
}

/** Storage holding cards, decks and saved learning progress. */
export function storageWithProgress(
  data: AppData,
  records: CardProgress[] = [],
  history: DailyActivity[] = [],
): MemoryStorage {
  return new MemoryStorage({
    [STORAGE_KEY]: JSON.stringify(data),
    [PROGRESS_STORAGE_KEY]: JSON.stringify({
      version: PROGRESS_VERSION,
      records,
      history,
    } satisfies ProgressData),
  });
}

/** The progress as it is saved right now, for checking what a click wrote. */
export function storedProgress(storage: MemoryStorage): ProgressData {
  const raw = storage.getItem(PROGRESS_STORAGE_KEY);
  if (raw === null) return { version: PROGRESS_VERSION, records: [], history: [] };
  return JSON.parse(raw) as ProgressData;
}

export function storedCards(storage: MemoryStorage): Card[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  return (JSON.parse(raw) as AppData).cards;
}

export function storedDecks(storage: MemoryStorage): Deck[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  return (JSON.parse(raw) as AppData).decks;
}

interface RenderAppOptions {
  storage?: Storage | null;
  route?: string;
}

export function renderApp({ storage = new MemoryStorage(), route = '/' }: RenderAppOptions = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App storage={storage} />
    </MemoryRouter>,
  );
}
