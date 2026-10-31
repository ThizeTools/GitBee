import { describe, test, expect } from "bun:test";
import type { BlameLine, BlameResult } from "$lib/ipc";
import {
  blameRowViews, committedTimes, isUncommittedSha, resultAgeBounds, startsGroup,
} from "./blameRows";

const A = "a".repeat(40);
const B = "b".repeat(40);
const ZERO = "0".repeat(40);

function line(sha: string, n: number): BlameLine {
  return { sha, orig_line: n, final_line: n, content: `line ${n}` };
}

/** Three lines of A, then two of B, then one uncommitted line. */
function sampleResult(): BlameResult {
  return {
    lines: [line(A, 1), line(A, 2), line(A, 3), line(B, 4), line(B, 5), line(ZERO, 6)],
    commits: {
      [A]: { author_name: "Ann", author_email: "a@x", author_time: 100, summary: "first" },
      [B]: { author_name: "Bo", author_email: "b@x", author_time: 300, summary: "second" },
      [ZERO]: { author_name: "Not Committed Yet", author_email: "", author_time: 0, summary: "Not committed yet" },
    },
  };
}

describe("startsGroup", () => {
  test("the first line and every line after a sha change start a group", () => {
    const lines = sampleResult().lines;
    expect(startsGroup(lines, 0)).toBe(true);
    expect(startsGroup(lines, 1)).toBe(false);
    expect(startsGroup(lines, 3)).toBe(true);
    expect(startsGroup(lines, 5)).toBe(true);
  });
});

describe("isUncommittedSha", () => {
  test("all-zero shas of either object-name length are uncommitted", () => {
    expect(isUncommittedSha(ZERO)).toBe(true);
    expect(isUncommittedSha("0".repeat(64))).toBe(true);
    expect(isUncommittedSha(A)).toBe(false);
    expect(isUncommittedSha("")).toBe(false);
  });
});

describe("committedTimes", () => {
  test("leaves out the uncommitted entry", () => {
    expect(committedTimes(sampleResult().commits).sort((x, y) => x - y)).toEqual([100, 300]);
  });
});

describe("blameRowViews", () => {
  test("draws only the requested range, with its own group info", () => {
    const result = sampleResult();
    const views = blameRowViews(result, { first: 1, end: 4 }, resultAgeBounds(result));
    expect(views.map((v) => v.index)).toEqual([1, 2, 3]);
    expect(views[0].startsGroup).toBe(false);
    expect(views[0].showInfo).toBe(true);
    expect(views[1].showInfo).toBe(false);
    expect(views[2].startsGroup).toBe(true);
    expect(views[2].showInfo).toBe(true);
  });

  test("the first drawn row shows info even in the middle of a group", () => {
    const result = sampleResult();
    const views = blameRowViews(result, { first: 4, end: 6 }, resultAgeBounds(result));
    expect(views[0].startsGroup).toBe(false);
    expect(views[0].showInfo).toBe(true);
  });

  test("age opacity follows the commit time and uncommitted lines are full", () => {
    const result = sampleResult();
    const views = blameRowViews(result, { first: 0, end: 6 }, resultAgeBounds(result));
    expect(views[0].opacity).toBeCloseTo(0.2);
    expect(views[3].opacity).toBeCloseTo(1);
    expect(views[5].opacity).toBe(1);
  });

  test("a line whose commit has no metadata is full strength", () => {
    const result = sampleResult();
    delete result.commits[A];
    const views = blameRowViews(result, { first: 0, end: 1 }, resultAgeBounds(result));
    expect(views[0].opacity).toBe(1);
  });

  test("an empty range draws no rows", () => {
    const result = sampleResult();
    expect(blameRowViews(result, { first: 2, end: 2 }, resultAgeBounds(result))).toEqual([]);
  });
});
