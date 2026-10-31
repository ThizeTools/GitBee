import { expect, test } from "bun:test";
import type { GraphNode } from "$lib/ipc";
import { buildRowSegments, type RowSegment } from "./edges";

function node(sha: string, lane: number, parents: string[], parentLanes: number[]): GraphNode {
  return {
    sha, parents, parent_lanes: parentLanes, lane, row: 0,
    author_name: "", author_email: "", timestamp: 0, subject: sha,
  };
}

function kinds(segs: RowSegment[]): string[] {
  return segs.map((s) => `${s.kind}${s.lane}`).sort();
}

test("linear history: out, then in+out, then in on lane 0", () => {
  const segs = buildRowSegments([
    node("c", 0, ["b"], [0]), node("b", 0, ["a"], [0]), node("a", 0, [], []),
  ], new Set());
  expect(kinds(segs[0])).toEqual(["out0"]);
  expect(kinds(segs[1])).toEqual(["in0", "out0"]);
  expect(kinds(segs[2])).toEqual(["in0"]);
});

test("side branch passes through the rows between merge and fork point", () => {
  const segs = buildRowSegments([
    node("m", 0, ["p", "s"], [0, 1]),
    node("p", 0, ["base"], [0]),
    node("s", 1, ["base"], [1]),
    node("base", 0, [], []),
  ], new Set());
  expect(kinds(segs[0])).toEqual(["out0", "out1"]);
  expect(kinds(segs[1])).toEqual(["in0", "out0", "pass1"]);
  expect(kinds(segs[2])).toEqual(["in1", "out1", "pass0"]);
  expect(kinds(segs[3])).toEqual(["in0", "in1"]);
});

test("parent missing from the list starts no line", () => {
  const segs = buildRowSegments([node("c", 0, ["gone"], [0])], new Set());
  expect(segs[0]).toEqual([]);
});

test("lines leaving a stash row stay dashed down to their parent", () => {
  const segs = buildRowSegments([
    node("st", 1, ["base"], [1]), node("x", 0, ["base"], [0]), node("base", 0, [], []),
  ], new Set([0]));
  expect(segs[1].find((s) => s.lane === 1)?.dashed).toBe(true);
  expect(segs[2].find((s) => s.lane === 1)?.dashed).toBe(true);
  expect(segs[2].find((s) => s.lane === 0)?.dashed).toBe(false);
});

test("merge parent already awaited joins the existing lane", () => {
  const segs = buildRowSegments([
    node("f2", 0, ["f1"], [0]),
    node("m", 1, ["p", "f1"], [1, 0]),
    node("f1", 0, ["base"], [0]),
    node("p", 1, ["base"], [1]),
    node("base", 0, [], []),
  ], new Set());
  expect(kinds(segs[1])).toEqual(["out0", "out1", "pass0"]);
  expect(kinds(segs[2])).toEqual(["in0", "out0", "pass1"]);
});
