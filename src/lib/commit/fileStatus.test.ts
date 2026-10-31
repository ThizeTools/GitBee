import { describe, test, expect } from "bun:test";
import { changeCountLabel, statusColor, statusName } from "./fileStatus";
import type { CommitFileStat } from "$lib/ipc";

function stat(additions: number | null, deletions: number | null): CommitFileStat {
  return { path: "a.ts", old_path: null, status: "M", additions, deletions };
}

describe("statusName", () => {
  test("names each git status letter", () => {
    expect(statusName("A")).toBe("Added");
    expect(statusName("D")).toBe("Deleted");
    expect(statusName("R")).toBe("Renamed");
  });

  test("reads an unknown letter as Changed", () => {
    expect(statusName("X")).toBe("Changed");
  });
});

describe("statusColor", () => {
  test("maps added to the add color and deleted to the del color", () => {
    expect(statusColor("A")).toBe("var(--add)");
    expect(statusColor("D")).toBe("var(--del)");
  });

  test("falls back to the muted color for an unknown letter", () => {
    expect(statusColor("Q")).toBe("var(--fg-muted)");
  });
});

describe("changeCountLabel", () => {
  test("sums additions and deletions", () => {
    expect(changeCountLabel(stat(2, 1))).toBe("3");
  });

  test("shows bin for a binary file", () => {
    expect(changeCountLabel(stat(null, null))).toBe("bin");
  });
});
