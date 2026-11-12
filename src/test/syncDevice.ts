import { createEmptyAppData } from '../domain/appData';
import * as deckOps from '../domain/deckOps';
import { gradeProgress, type ReviewGrade } from '../domain/srs';
import type { AppData, Card } from '../domain/types';
import { emptyProgress, recordActivity, reconcileProgress } from '../storage/progressStore';
import { appDataSchema, describeIssues } from '../storage/schemas';
import { linkAccount, runSync, type LocalStore, type SyncTransport } from '../sync/engine';
import type { LinkChoice } from '../sync/link';
import type { LocalSnapshot } from '../sync/records';
import type { SyncState } from '../sync/state';

let ids = 0;

/**
 * One simulated device for sync tests: its own data, its own sync state, and
 * the same domain operations the app uses to change them.
 */
export class TestDevice {
  snapshot: LocalSnapshot;
  state: SyncState | null = null;
  clock: number;
  /** Refuse the next local writes, as a full browser storage would. */
  failWrites = 0;
  /** Refuse to save sync state, as a full browser storage would. */
  failStateSaves = false;
  readonly name: string;

  constructor(name: string, data?: AppData, clock = 1_700_000_000_000) {
    this.name = name;
    this.clock = clock;
    this.snapshot = { data: data ?? createEmptyAppData(clock), progress: emptyProgress() };
  }

  readonly local: LocalStore = {
    read: () => structuredClone(this.snapshot),
    write: (next) => {
      if (this.failWrites > 0) {
        this.failWrites -= 1;
        return { ok: false, message: 'Browser storage is full.' };
      }
      const valid = appDataSchema.safeParse(next.data);
      if (!valid.success) return { ok: false, message: describeIssues(valid.error) };
      this.snapshot = structuredClone(next);
      return { ok: true };
    },
  };

  private context(transport: SyncTransport, batchSize?: number) {
    return {
      transport,
      local: this.local,
      saveState: (state: SyncState) => {
        if (this.failStateSaves) return false;
        this.state = structuredClone(state);
        return true;
      },
      now: () => this.clock,
      batchSize,
    };
  }

  async link(transport: SyncTransport, choice: LinkChoice = 'merge', userId = 'user-1') {
    const result = await linkAccount(this.context(transport), { userId, email: null }, choice);
    return result;
  }

  async sync(transport: SyncTransport, batchSize?: number) {
    if (!this.state) throw new Error(`${this.name} is not linked`);
    return runSync(this.context(transport, batchSize), this.state);
  }

  tick(ms = 60_000) {
    this.clock += ms;
  }

  get cards(): Card[] {
    return this.snapshot.data.cards;
  }

  card(id: string): Card | undefined {
    return this.snapshot.data.cards.find((card) => card.id === id);
  }

  addCard(term: string, definition: string, deckId = 'default', id?: string): Card {
    this.tick();
    ids += 1;
    const card: Card = {
      id: id ?? `${this.name}-card-${ids}`,
      deckId,
      term,
      definition,
      createdAt: this.clock,
      updatedAt: this.clock,
    };
    this.snapshot = {
      ...this.snapshot,
      data: { ...this.snapshot.data, cards: [...this.snapshot.data.cards, card] },
    };
    return card;
  }

  editCard(id: string, changes: Partial<Pick<Card, 'term' | 'definition' | 'deckId'>>) {
    this.tick();
    this.snapshot = {
      ...this.snapshot,
      data: {
        ...this.snapshot.data,
        cards: this.snapshot.data.cards.map((card) =>
          card.id === id ? { ...card, ...changes, updatedAt: this.clock } : card,
        ),
      },
    };
  }

  deleteCard(id: string) {
    this.tick();
    const data = {
      ...this.snapshot.data,
      cards: this.snapshot.data.cards.filter((card) => card.id !== id),
    };
    this.snapshot = {
      data,
      progress: {
        ...this.snapshot.progress,
        records: reconcileProgress(this.snapshot.progress.records, data).records,
      },
    };
  }

  createDeck(name: string, id: string) {
    this.tick();
    const result = deckOps.createDeck(this.snapshot.data, name, {
      now: this.clock,
      createId: () => id,
    });
    if (!result.ok) throw new Error(result.message);
    this.snapshot = { ...this.snapshot, data: result.data };
  }

  renameDeck(id: string, name: string) {
    this.tick();
    const result = deckOps.renameDeck(this.snapshot.data, id, name, { now: this.clock });
    if (!result.ok) throw new Error(result.message);
    this.snapshot = { ...this.snapshot, data: result.data };
  }

  deleteDeck(id: string, moveTo: string) {
    this.tick();
    const result = deckOps.deleteDeck(this.snapshot.data, id, moveTo, { now: this.clock });
    if (!result.ok) throw new Error(result.message);
    this.snapshot = { ...this.snapshot, data: result.data };
  }

  review(cardId: string, grade: ReviewGrade) {
    this.tick();
    const card = this.card(cardId);
    if (!card) throw new Error(`no card ${cardId}`);
    const current = this.snapshot.progress.records.find((r) => r.cardId === cardId);
    const updated = gradeProgress(current, grade, {
      cardId,
      deckId: card.deckId,
      now: this.clock,
    });
    this.snapshot = {
      ...this.snapshot,
      progress: {
        ...this.snapshot.progress,
        records: [...this.snapshot.progress.records.filter((r) => r.cardId !== cardId), updated],
        history: recordActivity(this.snapshot.progress.history, this.clock, grade !== 'again'),
      },
    };
  }

  progressOf(cardId: string) {
    return this.snapshot.progress.records.find((r) => r.cardId === cardId);
  }
}
