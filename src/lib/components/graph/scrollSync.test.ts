import { describe, test, expect } from "bun:test";
import { shouldResyncScroll } from "./scrollSync";

describe("shouldResyncScroll", () => {
  // Regression: after a tab switch the state stayed at 480 while WebKit had
  // clamped the DOM to 300, so rows 1-3 vanished. The state must be re-read.
  test("resyncs when WebKit clamped the DOM below the state", () => {
    expect(shouldResyncScroll(480, 300)).toBe(true);
  });

  test("resyncs when the DOM is ahead of the state", () => {
    expect(shouldResyncScroll(0, 120)).toBe(true);
  });

  test("ignores an exact match", () => {
    expect(shouldResyncScroll(300, 300)).toBe(false);
  });

  test("ignores sub-pixel differences from zoomed offsets", () => {
    expect(shouldResyncScroll(300, 300.4)).toBe(false);
    expect(shouldResyncScroll(300.4, 300)).toBe(false);
  });

  test("resyncs at exactly one pixel of difference", () => {
    expect(shouldResyncScroll(300, 301)).toBe(true);
  });
});
