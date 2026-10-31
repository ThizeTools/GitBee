import { describe, expect, test } from "bun:test";
import type { CommitStat } from "$lib/ipc";
import type { StatsLookup } from "$lib/stores/commitStatsCache";
import {
  CHANGES_OVERSCAN_ROWS, changesBar, changesLabel, changesStatFor, changesTitle, visibleStatShas,
} from "./changes";

function nodesOf(count: number): { sha: string }[] {
  return Array.from({ length: count }, (_, i) => ({ sha: `s${i}` }));
}

function lookupOf(stats: CommitStat[]): StatsLookup {
  const bySha = new Map(stats.map((s) => [s.sha, s] as const));
  return { version: 0, get: (sha) => bySha.get(sha) };
}

describe("changesBar", () => {
  test("a commit with no line changes has an empty bar", () => {
    expect(changesBar({ additions: 0, deletions: 0 })).toEqual({ widthPct: 0, addPct: 0 });
  });

  test("the bar length follows log10 of the total, so 9 lines is one third of a full bar", () => {
    expect(changesBar({ additions: 9, deletions: 0 }).widthPct).toBeCloseTo(100 / 3, 6);
  });

  test("the bar stops at the full width however large the commit", () => {
    expect(changesBar({ additions: 1_000_000, deletions: 0 }).widthPct).toBe(100);
  });

  test("the green share is the additions' share of the lines", () => {
    expect(changesBar({ additions: 3, deletions: 1 }).addPct).toBe(75);
  });
});

describe("changesLabel and changesTitle", () => {
  test("the label shows additions and deletions with a U+2212 minus", () => {
    expect(changesLabel({ additions: 12, deletions: 3 })).toBe("+12 −3");
  });

  test("the title counts files, singular for one", () => {
    expect(changesTitle({ files: 1 })).toBe("1 file");
    expect(changesTitle({ files: 3 })).toBe("3 files");
  });
});

describe("visibleStatShas", () => {
  test("requests the visible rows plus the overscan on each side", () => {
    const shas = visibleStatShas(nodesOf(100), 50, 60, 0, new Map());
    expect(shas).toHaveLength(10 + 2 * CHANGES_OVERSCAN_ROWS);
    expect(shas[0]).toBe("s30");
    expect(shas[shas.length - 1]).toBe("s79");
  });

  test("the WIP shift moves the window back one node", () => {
    const shas = visibleStatShas(nodesOf(100), 50, 60, 1, new Map());
    expect(shas[0]).toBe("s29");
    expect(shas[shas.length - 1]).toBe("s78");
  });

  test("the window is clamped to the loaded nodes", () => {
    expect(visibleStatShas(nodesOf(10), 0, 5, 1, new Map())).toHaveLength(10);
  });

  test("stash commits are left out of the request", () => {
    const shas = visibleStatShas(nodesOf(100), 50, 52, 0, new Map([["s51", 0]]));
    expect(shas).not.toContain("s51");
    expect(shas).toContain("s50");
  });
});

describe("changesStatFor", () => {
  const stat: CommitStat = { sha: "a", files: 2, additions: 4, deletions: 1 };

  test("the WIP row (no node) gets an empty cell", () => {
    expect(changesStatFor(null, new Map(), lookupOf([stat]))).toBeNull();
  });

  test("a stash row gets an empty cell even when its stat is cached", () => {
    expect(changesStatFor({ sha: "a" }, new Map([["a", 0]]), lookupOf([stat]))).toBeNull();
  });

  test("a commit whose stat has not landed gets the loading state", () => {
    expect(changesStatFor({ sha: "b" }, new Map(), lookupOf([stat]))).toBeUndefined();
  });

  test("a cached commit gets its stat", () => {
    expect(changesStatFor({ sha: "a" }, new Map(), lookupOf([stat]))).toBe(stat);
  });
});
