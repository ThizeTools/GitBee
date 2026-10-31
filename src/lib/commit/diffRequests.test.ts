import { describe, test, expect } from "bun:test";
import { EXPAND_ALL_CAP, expandAllPaths, notRequested } from "./diffRequests";
import type { CommitFileStat } from "$lib/ipc";

function files(n: number): CommitFileStat[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `f${i}.ts`, old_path: null, status: "M", additions: 1, deletions: 0,
  }));
}

describe("expandAllPaths", () => {
  test("requests the first 30 files by default", () => {
    const paths = expandAllPaths(files(EXPAND_ALL_CAP + 5));
    expect(paths.length).toBe(EXPAND_ALL_CAP);
    expect(paths[0]).toBe("f0.ts");
    expect(paths[EXPAND_ALL_CAP - 1]).toBe(`f${EXPAND_ALL_CAP - 1}.ts`);
  });

  test("requests every file when there are fewer than the cap", () => {
    expect(expandAllPaths(files(3))).toEqual(["f0.ts", "f1.ts", "f2.ts"]);
  });

  test("honours a custom cap", () => {
    expect(expandAllPaths(files(10), 2)).toEqual(["f0.ts", "f1.ts"]);
  });
});

describe("notRequested", () => {
  test("lists the paths that are not requested yet, in order", () => {
    expect(notRequested(files(4), { "f1.ts": true, "f3.ts": true })).toEqual(["f0.ts", "f2.ts"]);
  });

  test("is empty when everything is requested", () => {
    expect(notRequested(files(2), { "f0.ts": true, "f1.ts": true })).toEqual([]);
  });
});
