import { describe, expect, test } from "bun:test";
import type { CommitRef } from "$lib/ipc";
import {
  buildMarkerInput, markerRows, nearestMarkerRow, type MarkerInput, type MarkerSource,
} from "./scrollMarkers";
import { makeNode } from "./nodeFixtures";

const baseInput: MarkerInput = {
  totalRows: 100,
  headRow: null,
  selectedRow: null,
  branchTipRows: [],
  stashRows: [],
  matchRows: [],
};

describe("markerRows", () => {
  test("empty input yields no markers", () => {
    expect(markerRows(baseInput)).toEqual([]);
  });

  test("each kind carries its thickness", () => {
    const out = markerRows({
      ...baseInput,
      headRow: 1, selectedRow: 2, stashRows: [3], matchRows: [4],
      branchTipRows: [{ row: 5, color: "#123456" }],
    });
    const thickness = Object.fromEntries(out.map((m) => [m.kind, m.thickness]));
    expect(thickness).toEqual({ head: 3, selected: 2, stash: 2, match: 1, branch: 2 });
  });

  test("branch tips keep their lane color, other kinds use the theme", () => {
    const out = markerRows({ ...baseInput, branchTipRows: [{ row: 5, color: "#abcdef" }], headRow: 0 });
    expect(out.find((m) => m.kind === "branch")?.color).toBe("#abcdef");
    expect(out.find((m) => m.kind === "head")?.color).toBeNull();
  });

  test("markers are ordered by draw priority: match first, head last", () => {
    const out = markerRows({
      ...baseInput,
      headRow: 9, selectedRow: 8, stashRows: [7], matchRows: [6],
      branchTipRows: [{ row: 5, color: "#000000" }],
    });
    expect(out.map((m) => m.kind)).toEqual(["match", "stash", "branch", "selected", "head"]);
  });

  test("rows outside the strip are dropped, not clamped", () => {
    const out = markerRows({ ...baseInput, totalRows: 10, matchRows: [-1, 9, 10, 11] });
    expect(out.map((m) => m.row)).toEqual([9]);
  });

  test("zero rows yields no markers", () => {
    expect(markerRows({ ...baseInput, totalRows: 0, headRow: 0 })).toEqual([]);
  });
});

describe("nearestMarkerRow", () => {
  const markers = markerRows({ ...baseInput, headRow: 10, matchRows: [50], stashRows: [90] });

  test("picks the marker closest to the pointer row", () => {
    expect(nearestMarkerRow(markers, 12)).toBe(10);
    expect(nearestMarkerRow(markers, 48)).toBe(50);
  });

  test("a pointer exactly between two markers picks the earlier-drawn one", () => {
    const tie = markerRows({ ...baseInput, matchRows: [10], headRow: 20 });
    expect(nearestMarkerRow(tie, 15)).toBe(10);
  });

  test("returns null when nothing is marked", () => {
    expect(nearestMarkerRow([], 5)).toBeNull();
  });
});

describe("buildMarkerInput", () => {
  const nodes = [
    makeNode("h", ["p"], 0),
    makeNode("p", [], 1),
    makeNode("s", [], 2),
  ];
  const shaToRow = new Map(nodes.map((n, i) => [n.sha, i] as const));
  const refsByCommit = new Map<string, CommitRef[]>([
    ["h", [{ name: "main", kind: "localbranch", target_sha: "h" }]],
    ["p", [{ name: "origin/main", kind: "remotebranch", target_sha: "p" }]],
  ]);
  const src: MarkerSource = {
    nodes,
    shaToRow,
    wipVisible: true,
    headSha: "h",
    selectedSha: "p",
    wipSha: "__WIP__",
    refsByCommit,
    stashRows: new Set([2]),
    matchShas: ["p", "missing"],
  };

  test("applies the WIP row offset to every row", () => {
    const input = buildMarkerInput(src);
    expect(input.totalRows).toBe(4);
    expect(input.headRow).toBe(1);
    expect(input.selectedRow).toBe(2);
    expect(input.stashRows).toEqual([3]);
    expect(input.matchRows).toEqual([2]);
  });

  test("without WIP there is no offset", () => {
    const input = buildMarkerInput({ ...src, wipVisible: false });
    expect(input.totalRows).toBe(3);
    expect(input.headRow).toBe(0);
  });

  test("a selected WIP row maps to row 0 only while WIP is shown", () => {
    expect(buildMarkerInput({ ...src, selectedSha: "__WIP__" }).selectedRow).toBe(0);
    expect(buildMarkerInput({ ...src, selectedSha: "__WIP__", wipVisible: false }).selectedRow).toBeNull();
  });

  test("only local branch tips become branch markers, colored by lane", () => {
    const input = buildMarkerInput(src);
    expect(input.branchTipRows.map((t) => t.row)).toEqual([1]);
    expect(input.branchTipRows[0].color).toMatch(/^#/);
  });
});
