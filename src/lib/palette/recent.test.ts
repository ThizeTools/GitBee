import { describe, expect, test } from "bun:test";
import {
  RECENT_LIMIT, RECENT_STORAGE_KEY, parseRecent, pushRecent, readRecent, recentFirst, writeRecent,
} from "$lib/palette/recent";

// In-memory stand-in for localStorage: the subset of Storage the module uses.
class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

// Storage that throws on every access, like a blocked or full webview store.
class ThrowingStorage implements Pick<Storage, "getItem" | "setItem"> {
  getItem(): string | null { throw new Error("storage blocked"); }
  setItem(): void { throw new Error("quota exceeded"); }
}

describe("pushRecent", () => {
  test("moves a repeated id to the front without duplicating it", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  test("adds a new id at the front", () => {
    expect(pushRecent(["a"], "z")).toEqual(["z", "a"]);
  });

  test("keeps only the newest RECENT_LIMIT ids", () => {
    const ids = Array.from({ length: RECENT_LIMIT }, (_, i) => `id${i}`);
    const next = pushRecent(ids, "new");
    expect(next).toHaveLength(RECENT_LIMIT);
    expect(next[0]).toBe("new");
    expect(next).not.toContain(`id${RECENT_LIMIT - 1}`);
  });
});

describe("parseRecent", () => {
  test("a missing value reads as empty", () => {
    expect(parseRecent(null)).toEqual([]);
  });

  test("invalid JSON reads as empty instead of throwing", () => {
    expect(parseRecent("{not json")).toEqual([]);
  });

  test("a value that is not an array reads as empty", () => {
    expect(parseRecent('{"a":1}')).toEqual([]);
  });

  test("non-string entries are dropped", () => {
    expect(parseRecent('["a", 3, null, "b"]')).toEqual(["a", "b"]);
  });
});

describe("readRecent and writeRecent", () => {
  test("round-trips the ids through storage", () => {
    const storage = new MemoryStorage();
    writeRecent(storage, ["branch:main", "action:fetch"]);
    expect(readRecent(storage)).toEqual(["branch:main", "action:fetch"]);
  });

  test("uses the versioned storage key", () => {
    const storage = new MemoryStorage();
    writeRecent(storage, ["x"]);
    expect(storage.getItem(RECENT_STORAGE_KEY)).toBe('["x"]');
  });

  test("a null storage reads as empty and writes nothing", () => {
    expect(readRecent(null)).toEqual([]);
    expect(() => writeRecent(null, ["x"])).not.toThrow();
  });

  test("a throwing storage never breaks the palette", () => {
    const storage = new ThrowingStorage();
    expect(readRecent(storage)).toEqual([]);
    expect(() => writeRecent(storage, ["x"])).not.toThrow();
  });
});

describe("recentFirst", () => {
  const items = [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
    { id: "c", title: "C" },
    { id: "d", title: "D" },
  ];

  test("puts the recent ids first, in recency order, and keeps the rest in order", () => {
    expect(recentFirst(items, ["c", "a"]).map((i) => i.id)).toEqual(["c", "a", "b", "d"]);
  });

  test("skips recent ids that no item has", () => {
    expect(recentFirst(items, ["gone", "b"]).map((i) => i.id)).toEqual(["b", "a", "c", "d"]);
  });

  test("an empty recent list leaves the order unchanged", () => {
    expect(recentFirst(items, []).map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("a duplicated recent id appears once", () => {
    expect(recentFirst(items, ["b", "b"]).map((i) => i.id)).toEqual(["b", "a", "c", "d"]);
  });
});
