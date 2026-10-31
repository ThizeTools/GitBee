import { describe, test, expect } from "bun:test";
import {
  loadOlderUntil, MAX_OLDER_PAGES, olderMatches, remoteShasFor, REMOTE_DEBOUNCE_MS,
  shouldSearchRemote, TrailingDebounce, type OlderLoadDeps, type RemoteHits, type Timers,
} from "./historySearch";

/** A repo of `total` commits named c0 (newest) .. c{total-1}. The first `loaded`
 * are in the graph. `busyCalls` makes the next loadPage calls no-ops, like a
 * scroll-triggered page that is still in flight. */
class FakeGraphPager implements OlderLoadDeps {
  loaded: number;
  readonly total: number;
  readonly pageSize: number;
  busyCalls: number;
  pagesLoaded = 0;
  waits = 0;
  cancelFlag = false;

  constructor(loaded: number, total: number, pageSize: number, busyCalls = 0) {
    this.loaded = loaded;
    this.total = total;
    this.pageSize = pageSize;
    this.busyCalls = busyCalls;
  }

  isLoaded(sha: string): boolean {
    return Number(sha.slice(1)) < this.loaded;
  }

  hasMore(): boolean {
    return this.loaded < this.total;
  }

  async loadPage(): Promise<boolean> {
    if (this.busyCalls > 0) {
      this.busyCalls--;
      return false;
    }
    this.loaded = Math.min(this.total, this.loaded + this.pageSize);
    this.pagesLoaded++;
    return true;
  }

  async wait(): Promise<void> {
    this.waits++;
  }

  cancelled(): boolean {
    return this.cancelFlag;
  }
}

/** Records scheduled callbacks and runs them on `fire()`, so debounce tests need no real time. */
class FakeTimers implements Timers {
  pending: { id: number; callback: () => void; ms: number }[] = [];
  cleared: number[] = [];
  private nextId = 1;

  set(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.pending.push({ id, callback, ms });
    return id;
  }

  clear(handle: unknown): void {
    const id = handle as number;
    this.cleared.push(id);
    this.pending = this.pending.filter((p) => p.id !== id);
  }

  fire(): void {
    const batch = this.pending;
    this.pending = [];
    for (const p of batch) p.callback();
  }
}

describe("shouldSearchRemote", () => {
  test("needs three characters after trimming", () => {
    expect(shouldSearchRemote("ab")).toBe(false);
    expect(shouldSearchRemote("  ab  ")).toBe(false);
    expect(shouldSearchRemote("abc")).toBe(true);
    expect(shouldSearchRemote("   ")).toBe(false);
  });
});

describe("remoteShasFor", () => {
  const hits: RemoteHits = { query: "fix login", shas: ["b", "a"] };

  test("returns the shas for the query that produced them", () => {
    expect(remoteShasFor(hits, "fix login")).toEqual(["b", "a"]);
    expect(remoteShasFor(hits, "  fix login ")).toEqual(["b", "a"]);
  });

  test("ignores hits from an earlier query", () => {
    expect(remoteShasFor(hits, "fix")).toEqual([]);
  });

  test("empty when there are no hits", () => {
    expect(remoteShasFor(null, "fix login")).toEqual([]);
  });
});

describe("olderMatches", () => {
  test("keeps only shas that are not loaded, in the given order", () => {
    expect(olderMatches(["d", "c", "b", "a"], new Set(["a", "c"]))).toEqual(["d", "b"]);
  });

  test("empty when every hit is loaded", () => {
    expect(olderMatches(["a"], new Set(["a"]))).toEqual([]);
  });
});

describe("loadOlderUntil", () => {
  test("loads nothing when the target is already in the graph", async () => {
    const pager = new FakeGraphPager(2000, 10000, 2000);
    expect(await loadOlderUntil("c5", pager)).toBe(true);
    expect(pager.pagesLoaded).toBe(0);
  });

  test("loads only as many pages as the target needs", async () => {
    const pager = new FakeGraphPager(2000, 10000, 2000);
    expect(await loadOlderUntil("c5000", pager)).toBe(true);
    expect(pager.pagesLoaded).toBe(2);
    expect(pager.loaded).toBe(6000);
  });

  test("stops at the page cap when the target is far away", async () => {
    const pager = new FakeGraphPager(1000, 100000, 1000);
    expect(await loadOlderUntil("c50000", pager)).toBe(false);
    expect(pager.pagesLoaded).toBe(MAX_OLDER_PAGES);
  });

  test("stops when the history has no more commits", async () => {
    const pager = new FakeGraphPager(1000, 1000, 1000);
    expect(await loadOlderUntil("c5000", pager)).toBe(false);
    expect(pager.pagesLoaded).toBe(0);
  });

  test("waits and retries when a page is already in flight", async () => {
    const pager = new FakeGraphPager(1000, 10000, 1000, 2);
    expect(await loadOlderUntil("c1500", pager)).toBe(true);
    expect(pager.waits).toBe(2);
    expect(pager.pagesLoaded).toBe(1);
  });

  test("does nothing once cancelled", async () => {
    const pager = new FakeGraphPager(1000, 10000, 1000);
    pager.cancelFlag = true;
    expect(await loadOlderUntil("c5000", pager)).toBe(false);
    expect(pager.pagesLoaded).toBe(0);
  });
});

describe("TrailingDebounce", () => {
  test("runs once, after the delay, for the last schedule", () => {
    const timers = new FakeTimers();
    const debounce = new TrailingDebounce(REMOTE_DEBOUNCE_MS, timers);
    const calls: string[] = [];
    debounce.schedule(() => calls.push("first"));
    debounce.schedule(() => calls.push("second"));
    expect(timers.pending.map((p) => p.ms)).toEqual([REMOTE_DEBOUNCE_MS]);
    timers.fire();
    expect(calls).toEqual(["second"]);
  });

  test("cancel drops the pending run", () => {
    const timers = new FakeTimers();
    const debounce = new TrailingDebounce(REMOTE_DEBOUNCE_MS, timers);
    let ran = false;
    debounce.schedule(() => { ran = true; });
    debounce.cancel();
    timers.fire();
    expect(ran).toBe(false);
    expect(timers.cleared).toHaveLength(1);
  });

  test("cancel after the run has fired clears nothing", () => {
    const timers = new FakeTimers();
    const debounce = new TrailingDebounce(REMOTE_DEBOUNCE_MS, timers);
    debounce.schedule(() => {});
    timers.fire();
    debounce.cancel();
    expect(timers.cleared).toHaveLength(0);
  });
});
