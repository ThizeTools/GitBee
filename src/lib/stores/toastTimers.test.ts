import { describe, test, expect } from "bun:test";
import {
  MAX_VISIBLE_TOASTS, pickEvictedToast, remainingAfterRun, type ToastSlot,
} from "./toastTimers";

function slots(...kinds: ToastSlot["kind"][]): ToastSlot[] {
  return kinds.map((kind, i) => ({ id: i + 1, kind }));
}

describe("pickEvictedToast", () => {
  test("the limit is five visible toasts", () => {
    expect(MAX_VISIBLE_TOASTS).toBe(5);
  });
  test("no eviction while there is room", () => {
    expect(pickEvictedToast(slots("info", "info", "info", "info"))).toBeNull();
    expect(pickEvictedToast([])).toBeNull();
  });
  test("a sixth toast evicts the oldest non-error", () => {
    expect(pickEvictedToast(slots("info", "error", "success", "warn", "info"))).toBe(1);
  });
  test("errors are skipped even when they are the oldest", () => {
    expect(pickEvictedToast(slots("error", "error", "success", "info", "warn"))).toBe(3);
  });
  test("when every toast is an error, the oldest goes", () => {
    expect(pickEvictedToast(slots("error", "error", "error", "error", "error"))).toBe(1);
  });
  test("custom max is honoured", () => {
    expect(pickEvictedToast(slots("info", "info"), 2)).toBe(1);
    expect(pickEvictedToast(slots("info"), 2)).toBeNull();
  });
});

describe("remainingAfterRun", () => {
  test("subtracts the time that elapsed", () => {
    expect(remainingAfterRun(5000, 1000, 1800)).toBe(4200);
  });
  test("a pause that never ran leaves the remainder unchanged", () => {
    expect(remainingAfterRun(3000, 500, 500)).toBe(3000);
  });
  test("clamps at zero once the timer has expired", () => {
    expect(remainingAfterRun(1000, 0, 9999)).toBe(0);
  });
  test("a clock that went backwards does not add time", () => {
    expect(remainingAfterRun(2000, 500, 100)).toBe(2000);
  });
  test("repeated hover pauses add up to the full TTL", () => {
    let left = 5000;
    left = remainingAfterRun(left, 0, 1000);   // hover 1
    left = remainingAfterRun(left, 2000, 2500); // hover 2 after resume
    expect(left).toBe(3500);
  });
});
