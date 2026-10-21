import { SCHEMA_VERSION, type AppData, type Deck, type Timestamp } from './types';

/** Every card created before decks existed is placed in this deck. */
export const DEFAULT_DECK_ID = 'default';
export const DEFAULT_DECK_NAME = 'My Cards';

export function createDefaultDeck(now: Timestamp): Deck {
  return { id: DEFAULT_DECK_ID, name: DEFAULT_DECK_NAME, createdAt: now, updatedAt: now };
}

export function createEmptyAppData(now: Timestamp): AppData {
  return { schemaVersion: SCHEMA_VERSION, decks: [createDefaultDeck(now)], cards: [] };
}
