import { describe, expect, test } from "bun:test";
import type { StatusEntry } from "$lib/ipc";
import { makeNode } from "../graph/nodeFixtures";
import {
  canStartRebaseFrom,
  commitsToRebase,
  entriesFromCommits,
  hasMergeCommit,
  hasTrackedChanges,
} from "./range";

// Newest first, like the graph. HEAD = "t", base = "b0".
//   t -> c -> b -> b0 -> root
//   s (side branch off b0, not reachable from HEAD)
const nodes = [
  makeNode("t", ["c"]),
  makeNode("c", ["b"]),
  makeNode("b", ["b0"]),
  makeNode("s", ["b0"]),
  makeNode("b0", ["root"]),
  makeNode("root"),
];

function status(index: StatusEntry["index"], worktree: StatusEntry["worktree"]): StatusEntry {
  return { path: "f.txt", orig_path: null, index, worktree, conflicted: false };
}

describe("commitsToRebase", () => {
  test("lists the commits above the base, newest first, base excluded", () => {
    const shas = commitsToRebase(nodes, "t", "b0").map((n) => n.sha);
    expect(shas).toEqual(["t", "c", "b"]);
  });

  test("leaves out side commits that HEAD does not reach", () => {
    expect(commitsToRebase(nodes, "t", "b0").map((n) => n.sha)).not.toContain("s");
  });

  test("returns nothing when the base is not loaded, rather than the whole history", () => {
    expect(commitsToRebase(nodes, "t", "missing")).toEqual([]);
  });
});

describe("canStartRebaseFrom", () => {
  test("offers an ancestor of HEAD", () => {
    expect(canStartRebaseFrom("b0", "t", nodes)).toBe(true);
  });

  test("does not offer HEAD itself", () => {
    expect(canStartRebaseFrom("t", "t", nodes)).toBe(false);
  });

  test("does not offer a commit that HEAD does not reach", () => {
    expect(canStartRebaseFrom("s", "t", nodes)).toBe(false);
  });

  test("does not offer anything without a HEAD", () => {
    expect(canStartRebaseFrom("b0", null, nodes)).toBe(false);
  });
});

describe("hasMergeCommit", () => {
  test("is true when a commit in the range has two parents", () => {
    expect(hasMergeCommit([makeNode("m", ["a", "b"]), makeNode("a", ["r"])])).toBe(true);
  });

  test("is false for a linear range", () => {
    expect(hasMergeCommit([makeNode("a", ["r"]), makeNode("r")])).toBe(false);
  });
});

describe("hasTrackedChanges", () => {
  test("an untracked or ignored file is not a change git would refuse", () => {
    expect(hasTrackedChanges([status("untracked", "untracked")])).toBe(false);
    expect(hasTrackedChanges([status("unmodified", "ignored")])).toBe(false);
  });

  test("a staged or unstaged tracked change is", () => {
    expect(hasTrackedChanges([status("modified", "unmodified")])).toBe(true);
    expect(hasTrackedChanges([status("unmodified", "modified")])).toBe(true);
    expect(hasTrackedChanges([])).toBe(false);
  });
});

describe("entriesFromCommits", () => {
  test("starts each commit as a pick with nothing loaded", () => {
    const [first] = entriesFromCommits([makeNode("t", ["c"])]);
    expect(first).toEqual({
      sha: "t",
      subject: "subject t",
      author: "Ada",
      action: "pick",
      fullMessage: null,
      draft: null,
      loadError: null,
    });
  });
});
