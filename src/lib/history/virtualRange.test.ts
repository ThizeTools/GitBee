import { describe, test, expect } from "bun:test";
import { visibleRows } from "./virtualRange";

describe("visibleRows", () => {
  test("the top of the list draws the viewport plus the overscan below it", () => {
    expect(visibleRows(0, 100, 18, 1000, 10)).toEqual({ first: 0, end: 16 });
  });

  test("a scrolled list starts overscan rows above the first visible row", () => {
    // 180px down is row 10; viewport 90px shows rows 10..15.
    expect(visibleRows(180, 90, 18, 1000, 2)).toEqual({ first: 8, end: 17 });
  });

  test("the range never leaves 0..count", () => {
    expect(visibleRows(0, 10_000, 18, 5, 10)).toEqual({ first: 0, end: 5 });
    expect(visibleRows(99_999, 100, 18, 5, 10)).toEqual({ first: 5, end: 5 });
  });

  test("an empty list or a zero row height draws nothing", () => {
    expect(visibleRows(0, 100, 18, 0)).toEqual({ first: 0, end: 0 });
    expect(visibleRows(0, 100, 0, 50)).toEqual({ first: 0, end: 0 });
  });

  test("a negative scroll or size counts as zero", () => {
    expect(visibleRows(-50, -10, 18, 100, 0)).toEqual({ first: 0, end: 0 });
  });
});
