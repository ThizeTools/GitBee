import { describe, test, expect } from "bun:test";
import { ageBounds, ageOpacity } from "./age";

describe("ageBounds", () => {
  test("finds the oldest and newest time", () => {
    expect(ageBounds([300, 100, 200])).toEqual({ oldest: 100, newest: 300 });
  });

  test("an empty list gives bounds that read as one age", () => {
    expect(ageBounds([])).toEqual({ oldest: 0, newest: 0 });
  });
});

describe("ageOpacity", () => {
  const bounds = { oldest: 100, newest: 300 };

  test("the newest time is full strength and the oldest is the floor", () => {
    expect(ageOpacity(300, bounds)).toBeCloseTo(1);
    expect(ageOpacity(100, bounds)).toBeCloseTo(0.2);
  });

  test("a time between the bounds sits between the floor and full", () => {
    const mid = ageOpacity(200, bounds);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeCloseTo(0.6);
  });

  test("times outside the bounds are clamped", () => {
    expect(ageOpacity(10, bounds)).toBeCloseTo(0.2);
    expect(ageOpacity(9999, bounds)).toBeCloseTo(1);
  });

  test("when every commit has one time every bar is full", () => {
    expect(ageOpacity(50, { oldest: 50, newest: 50 })).toBe(1);
  });
});
