import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import App from '../App';
import { createDefaultDeck } from '../domain/appData';
import { SCHEMA_VERSION, type AppData, type Card } from '../domain/types';
import { STORAGE_KEY } from '../storage/localStore';
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

export function makeAppData(cards: Card[] = []): AppData {
  return { schemaVersion: SCHEMA_VERSION, decks: [createDefaultDeck(BASE_TIME)], cards };
}

/** Storage pre-seeded with valid v2 data holding the given cards. */
export function storageWithCards(cards: Card[]): MemoryStorage {
  return new MemoryStorage({ [STORAGE_KEY]: JSON.stringify(makeAppData(cards)) });
}

export function storedCards(storage: MemoryStorage): Card[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  return (JSON.parse(raw) as AppData).cards;
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
