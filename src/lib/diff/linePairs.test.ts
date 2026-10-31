import { describe, test, expect } from "bun:test";
import { pairChangedLines, wordRangesByLine } from "./linePairs";
import { add, ctx, del, hunkOf, noNewline } from "./testing";

describe("pairChangedLines", () => {
  test("pairs the i-th removal with the i-th addition of each run", () => {
    const lines = [
      del("a", 1), del("b", 2),
      add("A", 1), add("B", 2), add("C", 3),
      ctx("x", 3, 4),
      del("c", 4), add("D", 5),
    ];
    expect(pairChangedLines(lines)).toEqual([
      { del: 0, add: 2 },
      { del: 1, add: 3 },
      { del: 6, add: 7 },
    ]);
  });

  test("pairs only up to the shorter run", () => {
    expect(pairChangedLines([del("x", 1), del("y", 2), add("z", 1)])).toEqual([
      { del: 0, add: 2 },
    ]);
  });

  test("a removal and addition separated by a marker still pair", () => {
    expect(pairChangedLines([del("a", 1), noNewline(), add("b", 1)])).toEqual([
      { del: 0, add: 2 },
    ]);
  });

  test("context between a removal and an addition prevents pairing", () => {
    expect(pairChangedLines([del("a", 1), ctx("m", 2, 1), add("b", 2)])).toEqual([]);
  });

  test("additions without a preceding removal are not paired", () => {
    expect(pairChangedLines([add("a", 1), add("b", 2)])).toEqual([]);
  });
});

describe("wordRangesByLine", () => {
  test("keys changed ranges by line index on both paired lines", () => {
    const lines = hunkOf([del("let a = 1", 1), add("let a = 2", 1)]).lines;
    const map = wordRangesByLine(lines);
    expect(map.get(0)).toEqual([{ start: 8, end: 9 }]);
    expect(map.get(1)).toEqual([{ start: 8, end: 9 }]);
  });

  test("unpaired lines have no entry", () => {
    expect(wordRangesByLine([add("only", 1)]).size).toBe(0);
  });
});
