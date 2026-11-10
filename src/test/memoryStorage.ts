/**
 * In-memory `Storage` for tests, so no test ever touches a real browser's
 * localStorage. Records every write and can be told to fail.
 */
export class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  readonly writes: Array<{ method: 'setItem' | 'removeItem' | 'clear'; key?: string }> = [];
  failReads: Error | null = null;
  /** Thrown by every write. */
  failWrites: Error | null = null;
  /** Thrown by writes to the keys this picks, so one key can fail while others work. */
  failWritesFor: ((key: string) => Error | null) | null = null;
  /** Accept writes without storing them, as some private browsing modes do. */
  dropWrites = false;

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.items.set(key, value);
    createdStorages.push(this);
  }

  get length() {
    return this.items.size;
  }

  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }

  getItem(key: string) {
    if (this.failReads) throw this.failReads;
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.writes.push({ method: 'setItem', key });
    const error = this.failWrites ?? this.failWritesFor?.(key);
    if (error) throw error;
    if (!this.dropWrites) this.items.set(key, String(value));
  }

  removeItem(key: string) {
    this.writes.push({ method: 'removeItem', key });
    this.items.delete(key);
  }

  clear() {
    this.writes.push({ method: 'clear' });
    this.items.clear();
  }
}

/** Every storage made since the last test, so the test setup can check them all. */
export const createdStorages: MemoryStorage[] = [];
