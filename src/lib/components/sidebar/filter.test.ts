import { describe, test, expect } from "bun:test";
import { matchesFilter } from "./filter";

describe("matchesFilter", () => {
  test("blank filter shows every row", () => {
    expect(matchesFilter("", "main")).toBe(true);
    expect(matchesFilter("   ", "main")).toBe(true);
  });

  test("matches case-insensitively on any label", () => {
    expect(matchesFilter("FEAT", "main", "feature/x")).toBe(true);
    expect(matchesFilter("origin", "main", "origin/dev")).toBe(true);
  });

  test("ignores spaces around the typed text", () => {
    expect(matchesFilter("  dev  ", "origin/dev")).toBe(true);
  });

  test("hides a row when no label contains the text", () => {
    expect(matchesFilter("zzz", "main", "feature/x")).toBe(false);
  });
});
