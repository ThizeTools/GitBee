import { describe, test, expect } from "bun:test";
import type { Hunk } from "$lib/ipc";
import {
  NO_PICK, extendPick, linesSelection, pickOnly, pickedInHunk, toggleLine,
} from "./lineSelection";
import { add, ctx, del, hunkOf } from "./testing";

// Two hunks: hunk 0 = ctx, del, add, ctx, add; hunk 1 = add, ctx, del.
const HUNKS: Hunk[] = [
  hunkOf([ctx("a", 1, 1), del("b", 2), add("B", 2), ctx("c", 3, 3), add("D", 4)]),
  hunkOf([add("E", 10), ctx("f", 11, 11), del("g", 12)]),
];

describe("pickOnly and toggleLine", () => {
  test("a plain pick replaces the lines with one line and anchors on it", () => {
    expect(pickOnly({ hunk: 0, line: 1 })).toEqual({ refs: [{ hunk: 0, line: 1 }], anchor: { hunk: 0, line: 1 } });
  });

  test("toggling an unpicked line adds it; toggling a picked line removes it", () => {
    const first = toggleLine(NO_PICK, { hunk: 0, line: 1 });
    const second = toggleLine(first, { hunk: 0, line: 2 });
    expect(second.refs).toEqual([{ hunk: 0, line: 1 }, { hunk: 0, line: 2 }]);
    expect(toggleLine(second, { hunk: 0, line: 1 }).refs).toEqual([{ hunk: 0, line: 2 }]);
  });
});

describe("extendPick", () => {
  test("a Shift+click picks the changed lines from the anchor to the clicked line", () => {
    const anchored = pickOnly({ hunk: 0, line: 1 });
    const range = extendPick(anchored, { hunk: 0, line: 4 }, HUNKS);
    expect(range.refs).toEqual([
      { hunk: 0, line: 1 }, { hunk: 0, line: 2 }, { hunk: 0, line: 4 },
    ]);
  });

  test("the range skips context lines, which cannot be picked", () => {
    const range = extendPick(pickOnly({ hunk: 0, line: 2 }), { hunk: 0, line: 3 }, HUNKS);
    expect(range.refs).toEqual([{ hunk: 0, line: 2 }]);
  });

  test("a Shift+click in another hunk is a plain pick", () => {
    const range = extendPick(pickOnly({ hunk: 0, line: 1 }), { hunk: 1, line: 0 }, HUNKS);
    expect(range).toEqual(pickOnly({ hunk: 1, line: 0 }));
  });

  test("a Shift+click with no anchor is a plain pick", () => {
    expect(extendPick(NO_PICK, { hunk: 0, line: 4 }, HUNKS)).toEqual(pickOnly({ hunk: 0, line: 4 }));
  });

  test("a Shift+click backwards picks the same range", () => {
    const range = extendPick(pickOnly({ hunk: 0, line: 4 }), { hunk: 0, line: 1 }, HUNKS);
    expect(range.refs.map((r) => r.line)).toEqual([1, 2, 4]);
  });
});

describe("pickedInHunk and linesSelection", () => {
  test("pickedInHunk returns the picked line indexes of one hunk only", () => {
    const pick = { refs: [{ hunk: 0, line: 1 }, { hunk: 1, line: 0 }], anchor: null };
    expect([...pickedInHunk(pick, 0)]).toEqual([1]);
    expect([...pickedInHunk(pick, 1)]).toEqual([0]);
    expect(pickedInHunk(NO_PICK, 0).size).toBe(0);
  });

  test("linesSelection carries the picked refs into a patch selection", () => {
    const pick = pickOnly({ hunk: 0, line: 2 });
    expect(linesSelection(pick)).toEqual({ kind: "lines", lines: [{ hunk: 0, line: 2 }] });
  });
});
