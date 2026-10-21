/** Version of the data format kept in localStorage and written to export files. */
export const SCHEMA_VERSION = 2;

/** Milliseconds since the Unix epoch, as returned by `Date.now()`. */
export type Timestamp = number;

export interface Deck {
  id: string;
  name: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Card {
  id: string;
  deckId: string;
  term: string;
  definition: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Everything the app stores: the shape saved under the v2 storage key. */
export interface AppData {
  schemaVersion: typeof SCHEMA_VERSION;
  decks: Deck[];
  cards: Card[];
}
