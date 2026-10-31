import { describe, expect, test } from "bun:test";
import type { CommitStat } from "$lib/ipc";
import {
  chunk, CommitStatCache, lruPut, lruTouch, shasToFetch, STATS_CHUNK_MAX, type StatsFetcher,
} from "./commitStatsCore";

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Named fake for the git call. Records every request, can hold responses open
// and can fail the next call, so the timing and error paths are testable.
class FakeStatsFetcher {
  readonly calls: { repo: string; shas: string[] }[] = [];
  failNext = false;
  gate: Promise<void> | null = null;
  readonly fetch: StatsFetcher = async (repo, requested) => {
    this.calls.push({ repo, shas: [...requested] });
    if (this.gate) await this.gate;
    if (this.failNext) {
      this.failNext = false;
      throw new Error("git failed");
    }
    return requested.map((sha): CommitStat => ({ sha, files: 1, additions: 2, deletions: 1 }));
  };
}

function makeCache(fake: FakeStatsFetcher, warnings: string[] = [], cap?: number): CommitStatCache {
  return new CommitStatCache({
    fetchStats: fake.fetch,
    onLanded: () => {},
    warn: (msg) => warnings.push(msg),
    debounceMs: 5,
    cap,
  });
}

function shaList(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `sha${i}`);
}

describe("chunk", () => {
  test("splits into calls of at most the size, keeping the short tail", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test("an empty list makes no calls", () => {
    expect(chunk([], STATS_CHUNK_MAX)).toEqual([]);
  });

  test("a size below 1 throws and names the value", () => {
    expect(() => chunk([1], 0)).toThrow("got 0");
  });
});

describe("shasToFetch", () => {
  test("skips cached and in-flight shas", () => {
    const cached = new Map<string, CommitStat>([["a", { sha: "a", files: 1, additions: 1, deletions: 0 }]]);
    expect(shasToFetch(["a", "b", "c"], cached, new Set(["c"]))).toEqual(["b"]);
  });

  test("de-duplicates and keeps window order", () => {
    expect(shasToFetch(["x", "y", "x", "z", "y"], new Map(), new Set())).toEqual(["x", "y", "z"]);
  });
});

describe("lruTouch", () => {
  test("moves the touched keys to the newest end", () => {
    const map = new Map([["a", 1], ["b", 2], ["c", 3]]);
    lruTouch(map, ["a"]);
    expect([...map.keys()]).toEqual(["b", "c", "a"]);
  });

  test("ignores keys that are not in the map", () => {
    const map = new Map([["a", 1]]);
    lruTouch(map, ["zz"]);
    expect([...map.keys()]).toEqual(["a"]);
  });
});

describe("lruPut", () => {
  test("evicts the oldest entry once the cap is exceeded", () => {
    const map = new Map([["a", 1], ["b", 2]]);
    lruPut(map, "c", 3, 2);
    expect([...map.keys()]).toEqual(["b", "c"]);
  });

  test("re-putting a key replaces its value and makes it the newest", () => {
    const map = new Map([["a", 1], ["b", 2]]);
    lruPut(map, "a", 9, 2);
    expect([...map.keys()]).toEqual(["b", "a"]);
    expect(map.get("a")).toBe(9);
  });
});

describe("CommitStatCache", () => {
  test("waits out the debounce, then fetches the visible shas once", async () => {
    const fake = new FakeStatsFetcher();
    const cache = makeCache(fake);
    cache.request("repoA", ["a", "b"]);
    expect(fake.calls).toHaveLength(0);
    await wait(30);
    expect(fake.calls).toEqual([{ repo: "repoA", shas: ["a", "b"] }]);
    expect(cache.get("repoA", "a")?.additions).toBe(2);
    expect(cache.get("repoB", "a")).toBeUndefined();
  });

  test("rapid requests collapse to the last window", async () => {
    const fake = new FakeStatsFetcher();
    const cache = makeCache(fake);
    cache.request("r", ["a"]);
    cache.request("r", ["b"]);
    await wait(30);
    expect(fake.calls.map((c) => c.shas)).toEqual([["b"]]);
  });

  test("cancel drops a pending request", async () => {
    const fake = new FakeStatsFetcher();
    const cache = makeCache(fake);
    cache.request("r", ["a"]);
    cache.cancel();
    await wait(30);
    expect(fake.calls).toHaveLength(0);
  });

  test("a cached sha is not requested again", async () => {
    const fake = new FakeStatsFetcher();
    const cache = makeCache(fake);
    cache.request("r", ["a"]);
    await wait(30);
    cache.request("r", ["a", "b"]);
    await wait(30);
    expect(fake.calls.map((c) => c.shas)).toEqual([["a"], ["b"]]);
  });

  test("a sha in flight is not sent again by a second request", async () => {
    const fake = new FakeStatsFetcher();
    let release: () => void = () => {};
    fake.gate = new Promise<void>((resolve) => { release = resolve; });
    const cache = makeCache(fake);
    cache.request("r", ["a"]);
    await wait(20);
    cache.request("r", ["a", "b"]);
    await wait(20);
    expect(fake.calls.map((c) => c.shas)).toEqual([["a"], ["b"]]);
    release();
    await wait(10);
  });

  test("requests larger than the backend cap are split into chunks", async () => {
    const fake = new FakeStatsFetcher();
    const cache = makeCache(fake);
    cache.request("r", shaList(STATS_CHUNK_MAX * 2 + 50));
    await wait(30);
    expect(fake.calls.map((c) => c.shas.length)).toEqual([200, 200, 50]);
  });

  test("a failed call is logged, not thrown, and its shas are asked for again", async () => {
    const fake = new FakeStatsFetcher();
    const warnings: string[] = [];
    const cache = makeCache(fake, warnings);
    fake.failNext = true;
    cache.request("r", ["a"]);
    await wait(20);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("git failed");
    cache.request("r", ["a"]);
    await wait(20);
    expect(fake.calls).toHaveLength(2);
    expect(cache.get("r", "a")).toBeDefined();
  });

  test("the per-repo cap keeps the newest entries", async () => {
    const fake = new FakeStatsFetcher();
    const cache = makeCache(fake, [], 2);
    cache.request("r", ["a", "b", "c"]);
    await wait(30);
    expect(cache.get("r", "a")).toBeUndefined();
    expect(cache.get("r", "b")).toBeDefined();
    expect(cache.get("r", "c")).toBeDefined();
  });
});
