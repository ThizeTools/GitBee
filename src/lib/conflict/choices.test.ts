import { describe, expect, test } from "bun:test";
import {
  allResolved,
  canSave,
  indexSegments,
  pickNextConflictedPath,
  resolvedCount,
  stepConflict,
} from "./choices";
import { parseConflicts } from "./parse";

const TWO_BLOCKS_WITH_TEXT = [
  "top",
  "<<<<<<< HEAD", "a1", "=======", "a2", ">>>>>>> f",
  "mid",
  "<<<<<<< HEAD", "b1", "=======", "b2", ">>>>>>> f",
  "end",
].join("\n");

describe("indexSegments", () => {
  test("labels plain text with -1 and blocks with their file-order index", () => {
    const doc = parseConflicts(TWO_BLOCKS_WITH_TEXT);
    expect(indexSegments(doc).map((r) => r.blockIndex)).toEqual([-1, 0, -1, 1, -1]);
  });
});

const TWO_BLOCKS = [
  "<<<<<<< HEAD", "a1", "=======", "a2", ">>>>>>> f",
  "mid",
  "<<<<<<< HEAD", "b1", "=======", "b2", ">>>>>>> f",
  "",
].join("\n");

describe("resolvedCount and allResolved", () => {
  const doc = parseConflicts(TWO_BLOCKS);

  test("counts only blocks that have a choice", () => {
    expect(resolvedCount(doc, {})).toBe(0);
    expect(resolvedCount(doc, { 1: "ours" })).toBe(1);
    expect(allResolved(doc, { 1: "ours" })).toBe(false);
    expect(allResolved(doc, { 0: "theirs", 1: "ours" })).toBe(true);
  });

  test("a file with no blocks is already resolved", () => {
    expect(allResolved(parseConflicts("plain\n"), {})).toBe(true);
  });
});

describe("canSave", () => {
  const doc = parseConflicts(TWO_BLOCKS);

  test("refuses while any block is undecided", () => {
    expect(canSave(doc, { 0: "ours" })).toBe(false);
  });

  test("allows Save once every block is decided and no marker is left", () => {
    expect(canSave(doc, { 0: "ours", 1: "both" })).toBe(true);
  });

  test("refuses when a custom edit typed a marker back in", () => {
    expect(canSave(doc, { 0: "ours", 1: { custom: "<<<<<<< HEAD" } })).toBe(false);
  });

  test("refuses a malformed file that keeps an unterminated marker", () => {
    const broken = parseConflicts("a\n<<<<<<< HEAD\nx\n");
    expect(canSave(broken, {})).toBe(false);
  });
});

describe("stepConflict", () => {
  test("moves one block at a time and clamps at both ends", () => {
    expect(stepConflict(0, 3, 1)).toBe(1);
    expect(stepConflict(2, 3, 1)).toBe(2);
    expect(stepConflict(0, 3, -1)).toBe(0);
    expect(stepConflict(1, 3, -1)).toBe(0);
  });

  test("returns 0 when there are no blocks", () => {
    expect(stepConflict(0, 0, 1)).toBe(0);
  });
});

describe("pickNextConflictedPath", () => {
  const entries = [
    { path: "a.ts", conflicted: true },
    { path: "b.ts", conflicted: false },
    { path: "c.ts", conflicted: true },
  ];

  test("returns the next conflicted file that is not the current one", () => {
    expect(pickNextConflictedPath(entries, "a.ts")).toBe("c.ts");
  });

  test("returns null when the current file is the only conflicted one", () => {
    expect(pickNextConflictedPath(entries, "c.ts")).toBe("a.ts");
    expect(pickNextConflictedPath([{ path: "a.ts", conflicted: true }], "a.ts")).toBeNull();
  });

  test("ignores non-conflicted entries", () => {
    expect(pickNextConflictedPath([{ path: "b.ts", conflicted: false }], "x")).toBeNull();
  });
});
