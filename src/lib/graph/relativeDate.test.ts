import { describe, expect, test } from "bun:test";
import { formatRelativeDate } from "./relativeDate";

// Local-time construction on both sides, so the tests agree in any timezone.
const NOW = new Date(2026, 9, 31, 12, 0, 0).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const secsAgo = (ms: number): number => (NOW - ms) / 1000;

describe("formatRelativeDate", () => {
  test("under a minute reads as just now", () => {
    expect(formatRelativeDate(secsAgo(30_000), NOW)).toBe("just now");
  });

  test("future timestamps (clock skew) read as just now", () => {
    expect(formatRelativeDate(secsAgo(-5 * MIN), NOW)).toBe("just now");
  });

  test("minutes below an hour", () => {
    expect(formatRelativeDate(secsAgo(14 * MIN), NOW)).toBe("14 min ago");
  });

  test("hours below a day", () => {
    expect(formatRelativeDate(secsAgo(3 * HOUR + 10 * MIN), NOW)).toBe("3 h ago");
  });

  test("days up to the 30 day limit", () => {
    expect(formatRelativeDate(secsAgo(2 * DAY), NOW)).toBe("2 d ago");
    expect(formatRelativeDate(secsAgo(29 * DAY + 23 * HOUR), NOW)).toBe("29 d ago");
  });

  test("beyond 30 days shows the calendar date in the current year", () => {
    const ts = new Date(2026, 8, 4, 9, 0, 0).getTime() / 1000;
    expect(formatRelativeDate(ts, NOW)).toBe("Sep 4");
  });

  test("a date in a previous year includes the year", () => {
    const ts = new Date(2025, 2, 4, 9, 0, 0).getTime() / 1000;
    expect(formatRelativeDate(ts, NOW)).toBe("Mar 4, 2025");
  });

  test("the boundary between days and calendar date is exactly 30 days", () => {
    const ts = secsAgo(30 * DAY);
    expect(formatRelativeDate(ts, NOW)).toMatch(/^[A-Z][a-z]{2} \d{1,2}/);
  });
});
