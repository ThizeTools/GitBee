import { describe, test, expect } from "bun:test";
import {
  autofetchErrorTooltip,
  formatFetchAge,
  withFetchFailure,
  withFetchSuccess,
  type AutofetchMap,
} from "./autofetchStatus";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

describe("formatFetchAge", () => {
  test("reads as just now under 45 seconds, and for future times", () => {
    expect(formatFetchAge(NOW, NOW)).toBe("just now");
    expect(formatFetchAge(NOW - 44_000, NOW)).toBe("just now");
    expect(formatFetchAge(NOW + 5 * MIN, NOW)).toBe("just now");
  });

  test("counts whole minutes, with a floor of one minute", () => {
    expect(formatFetchAge(NOW - 45_000, NOW)).toBe("1 min ago");
    expect(formatFetchAge(NOW - 3 * MIN - 30_000, NOW)).toBe("3 min ago");
    expect(formatFetchAge(NOW - 59 * MIN, NOW)).toBe("59 min ago");
  });

  test("switches to hours and days", () => {
    expect(formatFetchAge(NOW - 60 * MIN, NOW)).toBe("1 h ago");
    expect(formatFetchAge(NOW - 23 * 60 * MIN, NOW)).toBe("23 h ago");
    expect(formatFetchAge(NOW - 49 * 60 * MIN, NOW)).toBe("2 d ago");
  });
});

describe("withFetchSuccess and withFetchFailure", () => {
  test("success stores the time and clears the error", () => {
    const failed: AutofetchMap = { "/r": { lastFetchAt: null, lastFetchError: "auth" } };
    const next = withFetchSuccess(failed, "/r", NOW);
    expect(next["/r"]).toEqual({ lastFetchAt: NOW, lastFetchError: null });
  });

  test("failure keeps the last good fetch time and stores git's message", () => {
    const ok: AutofetchMap = { "/r": { lastFetchAt: NOW - MIN, lastFetchError: null } };
    const next = withFetchFailure(ok, "/r", "fatal: Authentication failed");
    expect(next["/r"]).toEqual({
      lastFetchAt: NOW - MIN,
      lastFetchError: "fatal: Authentication failed",
    });
  });

  test("an empty error still produces a visible failure", () => {
    const next = withFetchFailure({}, "/r", "   ");
    expect(next["/r"].lastFetchError).toBe("git fetch failed without a message");
    expect(next["/r"].lastFetchAt).toBeNull();
  });

  test("other repos keep their own status", () => {
    const map: AutofetchMap = { "/a": { lastFetchAt: NOW, lastFetchError: null } };
    const next = withFetchFailure(map, "/b", "offline");
    expect(next["/a"]).toEqual({ lastFetchAt: NOW, lastFetchError: null });
  });
});

describe("autofetchErrorTooltip", () => {
  test("shows git's stderr followed by the retry hint", () => {
    const tip = autofetchErrorTooltip("  fatal: unable to access\n");
    expect(tip).toBe("fatal: unable to access\n\nClick to retry the fetch now.");
  });

  test("truncates very long stderr", () => {
    const tip = autofetchErrorTooltip("x".repeat(1000));
    expect(tip.startsWith("x".repeat(400) + "…")).toBe(true);
    expect(tip.length).toBeLessThan(500);
  });
});
