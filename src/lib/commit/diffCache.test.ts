import { describe, test, expect } from "bun:test";
import { DiffCache, type DiffKey } from "./diffCache";
import type { FileDiff } from "$lib/ipc";

function diffFor(file: string): FileDiff {
  return { old_path: file, new_path: file, hunks: [], binary: false, omitted_lines: 0 };
}

function key(file: string, ignoreWs = false): DiffKey {
  return { repo: "/repo", sha: "abc", file, ignoreWs };
}

/** Records every load and fails the next one on request. */
class FakeLoader {
  readonly calls: DiffKey[] = [];
  failNext = false;

  load = (k: DiffKey): Promise<FileDiff[]> => {
    this.calls.push(k);
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error("git failed"));
    }
    return Promise.resolve([diffFor(k.file)]);
  };
}

describe("DiffCache", () => {
  test("returns the cached diff for a key without loading it again", async () => {
    const loader = new FakeLoader();
    const cache = new DiffCache(loader.load, 10);
    await cache.get(key("a.ts"));
    const again = await cache.get(key("a.ts"));
    expect(loader.calls.length).toBe(1);
    expect(again[0].new_path).toBe("a.ts");
  });

  test("shares one in-flight load between concurrent requests", async () => {
    const loader = new FakeLoader();
    const cache = new DiffCache(loader.load, 10);
    const [first, second] = await Promise.all([cache.get(key("a.ts")), cache.get(key("a.ts"))]);
    expect(loader.calls.length).toBe(1);
    expect(second).toBe(first);
  });

  test("keeps the -w and exact diffs apart", async () => {
    const loader = new FakeLoader();
    const cache = new DiffCache(loader.load, 10);
    await cache.get(key("a.ts", false));
    await cache.get(key("a.ts", true));
    expect(loader.calls.length).toBe(2);
  });

  test("keeps a rename's diff apart from the plain diff of the same new name", async () => {
    const loader = new FakeLoader();
    const cache = new DiffCache(loader.load, 10);
    await cache.get(key("new.ts"));
    await cache.get({ ...key("new.ts"), oldFile: "old.ts" });
    await cache.get({ ...key("new.ts"), oldFile: "old.ts" });
    expect(loader.calls.length).toBe(2);
    expect(loader.calls[1].oldFile).toBe("old.ts");
  });

  test("does not keep a failed load, so the next request retries", async () => {
    const loader = new FakeLoader();
    const cache = new DiffCache(loader.load, 10);
    loader.failNext = true;
    await expect(cache.get(key("a.ts"))).rejects.toThrow("git failed");
    await cache.get(key("a.ts"));
    expect(loader.calls.length).toBe(2);
    expect(cache.size).toBe(1);
  });

  test("evicts the least recently used entry past the limit", async () => {
    const loader = new FakeLoader();
    const cache = new DiffCache(loader.load, 2);
    await cache.get(key("a.ts"));
    await cache.get(key("b.ts"));
    await cache.get(key("a.ts"));
    await cache.get(key("c.ts"));
    expect(cache.size).toBe(2);
    await cache.get(key("a.ts"));
    expect(loader.calls.map((k) => k.file)).toEqual(["a.ts", "b.ts", "c.ts"]);
    await cache.get(key("b.ts"));
    expect(loader.calls.map((k) => k.file)).toEqual(["a.ts", "b.ts", "c.ts", "b.ts"]);
  });
});
