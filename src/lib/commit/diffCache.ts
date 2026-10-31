// Cache of per-file commit diffs. Pure: the loader is injected, so the cache
// is tested without git or Tauri.
import type { FileDiff } from "$lib/ipc";

/**
 * One per-file commit diff. `ignoreWs` is part of the key because `-w`
 * changes which hunks git emits, so the two results are different diffs.
 */
export interface DiffKey {
  repo: string;
  sha: string;
  file: string;
  ignoreWs: boolean;
}

export type DiffLoader = (key: DiffKey) => Promise<FileDiff[]>;

/**
 * Keeps loaded diffs so re-expanding a file does not run git again. Concurrent
 * requests for one key share one promise. A failed load is dropped, so the
 * next request retries. Past `maxEntries` the least recently used entry goes,
 * which bounds memory when many large diffs were opened.
 */
export class DiffCache {
  private readonly entries = new Map<string, Promise<FileDiff[]>>();
  private readonly loader: DiffLoader;
  private readonly maxEntries: number;

  constructor(loader: DiffLoader, maxEntries: number) {
    this.loader = loader;
    this.maxEntries = maxEntries;
  }

  get(key: DiffKey): Promise<FileDiff[]> {
    const id = keyId(key);
    const hit = this.entries.get(id);
    if (hit) {
      this.touch(id, hit);
      return hit;
    }
    const pending = this.loader(key);
    this.entries.set(id, pending);
    pending.catch(() => {
      if (this.entries.get(id) === pending) this.entries.delete(id);
    });
    this.evict();
    return pending;
  }

  /** Number of cached entries, loaded or in flight. */
  get size(): number {
    return this.entries.size;
  }

  // Map keeps insertion order, so re-inserting moves an entry to the back,
  // which makes the front the least recently used.
  private touch(id: string, value: Promise<FileDiff[]>): void {
    this.entries.delete(id);
    this.entries.set(id, value);
  }

  private evict(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest: string | undefined = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }
}

function keyId(key: DiffKey): string {
  return JSON.stringify([key.repo, key.sha, key.ignoreWs, key.file]);
}
