// A Map with a size cap: when a new entry would pass the cap, the least
// recently used one is dropped. Pure, so bun test runs it as-is. The avatar
// cache uses it; it was an unbounded map on `window` before, which grew for
// the whole session.

export class LruMap<K, V> {
  private readonly items = new Map<K, V>();
  private readonly limit: number;

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`LruMap limit must be a whole number of at least 1, got ${limit}`);
    }
    this.limit = limit;
  }

  get size(): number {
    return this.items.size;
  }

  has(key: K): boolean {
    return this.items.has(key);
  }

  /** Reading counts as use: the entry moves to the back, away from eviction. */
  get(key: K): V | undefined {
    if (!this.items.has(key)) return undefined;
    const value = this.items.get(key) as V;
    this.items.delete(key);
    this.items.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    // Map keeps insertion order, so delete-then-set moves the key to the back.
    this.items.delete(key);
    this.items.set(key, value);
    this.evictOverLimit();
  }

  delete(key: K): boolean {
    return this.items.delete(key);
  }

  private evictOverLimit(): void {
    while (this.items.size > this.limit) {
      const oldest = this.items.keys().next();
      if (oldest.done) return;
      this.items.delete(oldest.value);
    }
  }
}
