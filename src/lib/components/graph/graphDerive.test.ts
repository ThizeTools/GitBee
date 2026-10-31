import { describe, test, expect } from "bun:test";
import type { CommitRef, GraphNode, StashEntry, StatusEntry } from "$lib/ipc";
import {
  buildAvatarRows,
  buildBranchKindByName,
  buildColumnSpecs,
  buildContainingRefs,
  buildGridTemplate,
  buildRowsWithRefs,
  buildVisibleRows,
  buildShaToRow,
  buildStashRows,
  buildWipBreakdown,
  displaySubjectFor,
  graphLeftOffset,
  isMergeNode,
  isRowDimmed,
  nonStashRefs,
  stripStashSubject,
  withSyntheticHead,
} from "./graphDerive";
import type { GraphCol } from "$lib/graph/columns";

function node(
  sha: string,
  opts: { parents?: string[]; email?: string; lane?: number } = {},
): GraphNode {
  return {
    sha,
    parents: opts.parents ?? [],
    parent_lanes: [],
    lane: opts.lane ?? 0,
    row: 0,
    author_name: "",
    author_email: opts.email ?? "",
    timestamp: 0,
    subject: sha,
  };
}

function ref(name: string, kind: CommitRef["kind"], sha: string): CommitRef {
  return { name, kind, target_sha: sha };
}

function status(
  index: StatusEntry["index"],
  worktree: StatusEntry["worktree"],
  conflicted = false,
): StatusEntry {
  return { path: "f", orig_path: null, index, worktree, conflicted };
}

function stash(sha: string, index: number): StashEntry {
  return { sha, index, message: "" };
}

describe("buildShaToRow", () => {
  test("maps each sha to its displayed row index", () => {
    const m = buildShaToRow([node("a"), node("b"), node("c")]);
    expect(m.get("a")).toBe(0);
    expect(m.get("c")).toBe(2);
    expect(m.size).toBe(3);
  });

  test("empty list gives an empty map", () => {
    expect(buildShaToRow([]).size).toBe(0);
  });
});

describe("nonStashRefs", () => {
  test("drops stash refs and keeps the rest", () => {
    const refs = [ref("main", "localbranch", "a"), ref("refs/stash", "stash", "a")];
    expect(nonStashRefs(refs).map((r) => r.name)).toEqual(["main"]);
  });

  test("undefined gives an empty list", () => {
    expect(nonStashRefs(undefined)).toEqual([]);
  });
});

describe("buildRowsWithRefs", () => {
  test("marks rows whose commit has a non-stash ref", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const refs = new Map<string, CommitRef[]>([
      ["a", [ref("main", "localbranch", "a")]],
      ["b", [ref("refs/stash", "stash", "b")]],
    ]);
    expect([...buildRowsWithRefs(nodes, refs)]).toEqual([0]);
  });
});

describe("buildAvatarRows", () => {
  test("includes single-parent commits with an email, skips merges and emailless", () => {
    const nodes = [
      node("a", { email: "a@x" }),
      node("m", { email: "m@x", parents: ["a", "b"] }),
      node("n"),
    ];
    expect([...buildAvatarRows(nodes)]).toEqual([0]);
  });
});

describe("buildStashRows", () => {
  test("marks rows whose sha is a stash", () => {
    const nodes = [node("a"), node("s"), node("c")];
    expect([...buildStashRows(nodes, [stash("s", 0)])]).toEqual([1]);
  });
});

describe("stripStashSubject", () => {
  test("strips the WIP-on-branch prefix and sha", () => {
    expect(stripStashSubject("WIP on master: 53deb12 Merge pull request #137"))
      .toBe("53deb12 Merge pull request #137");
  });

  test("strips the index-on prefix", () => {
    expect(stripStashSubject("index on main: abc123 tidy")).toBe("abc123 tidy");
  });

  test("strips the untracked-files prefix", () => {
    expect(stripStashSubject("untracked files on dev: fix")).toBe("fix");
  });

  test("strips the plain On-branch prefix case-insensitively", () => {
    expect(stripStashSubject("On feature: user message")).toBe("user message");
  });

  test("leaves a subject without a stash prefix untouched", () => {
    expect(stripStashSubject("plain commit message")).toBe("plain commit message");
  });
});

describe("displaySubjectFor", () => {
  test("returns the subject unchanged for a non-stash row", () => {
    expect(displaySubjectFor("WIP on master: x y", null)).toBe("WIP on master: x y");
  });

  test("strips the boilerplate for a stash row", () => {
    expect(displaySubjectFor("WIP on master: 53deb12 Fix it", 0)).toBe("53deb12 Fix it");
  });
});

describe("buildBranchKindByName", () => {
  test("keeps branch kinds only and the first ref per name", () => {
    const m = buildBranchKindByName([
      ref("main", "localbranch", "a"),
      ref("main", "remotebranch", "b"),
      ref("v1", "tag", "c"),
      ref("origin/dev", "remotebranch", "d"),
    ]);
    expect(m.get("main")).toBe("localbranch");
    expect(m.get("origin/dev")).toBe("remotebranch");
    expect(m.has("v1")).toBe(false);
  });
});

describe("buildContainingRefs", () => {
  const kinds = new Map([
    ["main", "localbranch" as const],
    ["origin/main", "remotebranch" as const],
  ]);

  test("builds ghost refs for names that have a branch ref", () => {
    const out = buildContainingRefs("abc", new Set(["main", "origin/main"]), kinds);
    expect(out).toEqual([
      { name: "main", kind: "localbranch", target_sha: "abc" },
      { name: "origin/main", kind: "remotebranch", target_sha: "abc" },
    ]);
  });

  test("skips names with no branch ref", () => {
    const out = buildContainingRefs("abc", new Set(["gone"]), kinds);
    expect(out).toEqual([]);
  });

  test("undefined or empty name set gives an empty list", () => {
    expect(buildContainingRefs("abc", undefined, kinds)).toEqual([]);
    expect(buildContainingRefs("abc", new Set(), kinds)).toEqual([]);
  });
});

describe("withSyntheticHead", () => {
  const direct = [ref("feat", "localbranch", "a")];

  test("prepends a HEAD pill when detached on this commit", () => {
    const out = withSyntheticHead("a", direct, "a", null);
    expect(out.map((r) => r.name)).toEqual(["HEAD", "feat"]);
    expect(out[0].kind).toBe("head");
  });

  test("returns the direct refs when HEAD is on a branch", () => {
    expect(withSyntheticHead("a", direct, "a", "feat")).toBe(direct);
  });

  test("returns the direct refs when HEAD is elsewhere", () => {
    expect(withSyntheticHead("a", direct, "b", null)).toBe(direct);
  });
});

describe("buildWipBreakdown", () => {
  test("groups status entries by semantic kind", () => {
    const b = buildWipBreakdown([
      status("modified", "unmodified"),
      status("renamed", "unmodified"),
      status("unmodified", "untracked"),
      status("unmodified", "deleted"),
      status("unmodified", "modified"),
      status("added", "unmodified"),
      status("modified", "modified", true),
    ]);
    expect(b).toEqual({ edits: 3, news: 2, dels: 1, conflicts: 1 });
  });

  test("empty status gives all zeros", () => {
    expect(buildWipBreakdown([])).toEqual({ edits: 0, news: 0, dels: 0, conflicts: 0 });
  });
});

describe("buildGridTemplate", () => {
  const widths: Partial<Record<GraphCol, number>> = { refs: 200, graph: 140, msg: 300 };
  const widthPx = (c: GraphCol): number => widths[c] ?? 0;

  test("interleaves 6px gutters and lets the message column flex", () => {
    expect(buildGridTemplate(["refs", "graph", "msg"], widthPx))
      .toBe("200px 6px 140px 6px minmax(120px, 1fr)");
  });

  test("message flexes even when it is not last, so later columns keep their width", () => {
    expect(buildGridTemplate(["refs", "msg", "graph"], widthPx))
      .toBe("200px 6px minmax(120px, 1fr) 6px 140px");
  });

  test("without a message column the last column flexes", () => {
    expect(buildGridTemplate(["refs", "graph"], widthPx)).toBe("200px 6px 1fr");
  });
});

describe("graphLeftOffset", () => {
  const widths: Partial<Record<GraphCol, number>> = { refs: 200, graph: 140, msg: 300 };
  const widthPx = (c: GraphCol): number => widths[c] ?? 0;

  test("sums the widths and gutters before the graph column", () => {
    expect(graphLeftOffset(["refs", "graph", "msg"], widthPx)).toBe(206);
  });

  test("graph first gives zero", () => {
    expect(graphLeftOffset(["graph", "refs", "msg"], widthPx)).toBe(0);
  });
});

describe("isMergeNode / isRowDimmed", () => {
  test("a commit with two parents is a merge; one or zero parents is not", () => {
    expect(isMergeNode(node("m", { parents: ["a", "b"] }))).toBe(true);
    expect(isMergeNode(node("c", { parents: ["a"] }))).toBe(false);
    expect(isMergeNode(node("root"))).toBe(false);
  });

  test("merge dimming dims merges only when enabled", () => {
    const m = node("m", { parents: ["a", "b"] });
    expect(isRowDimmed(m, true, null)).toBe(true);
    expect(isRowDimmed(m, false, null)).toBe(false);
  });

  test("a highlight dims rows outside the set and keeps rows inside it", () => {
    const set = new Set(["keep"]);
    expect(isRowDimmed(node("keep"), false, set)).toBe(false);
    expect(isRowDimmed(node("other"), false, set)).toBe(true);
  });

  test("no highlight and no merge dimming dims nothing", () => {
    expect(isRowDimmed(node("x", { parents: ["a", "b"] }), false, null)).toBe(false);
  });
});

describe("buildVisibleRows", () => {
  const nodes = [node("a"), node("b"), node("c"), node("d")];

  test("row 0 is the WIP slot and node i sits at row i + 1 when WIP is shown", () => {
    const rows = buildVisibleRows({ start: 0, end: 3 }, nodes, true);
    expect(rows.map((r) => r.isWip)).toEqual([true, false, false]);
    expect(rows[1].node?.sha).toBe("a");
    expect(rows[2].node?.sha).toBe("b");
  });

  test("node i sits at row i when WIP is hidden (solo)", () => {
    const rows = buildVisibleRows({ start: 0, end: 2 }, nodes, false);
    expect(rows.map((r) => r.node?.sha)).toEqual(["a", "b"]);
    expect(rows.every((r) => !r.isWip)).toBe(true);
  });

  // Regression: a window that starts at row 1 must still paint the first
  // commits. Rows 1-3 going missing after a tab switch was this window
  // starting too low, so every row in the window needs its node.
  test("a window starting at row 1 still paints the first commits", () => {
    const rows = buildVisibleRows({ start: 1, end: 4 }, nodes, true);
    expect(rows.map((r) => r.node?.sha)).toEqual(["a", "b", "c"]);
    expect(rows.every((r) => !r.isWip)).toBe(true);
  });

  test("top is TOP_PADDING plus row times ROW_HEIGHT", () => {
    const rows = buildVisibleRows({ start: 0, end: 2 }, nodes, true);
    expect(rows[0].top).toBe(4);
    expect(rows[1].top).toBe(4 + 28);
  });
});

describe("buildColumnSpecs", () => {
  test("maps the visible order to id, width and min width", () => {
    const widths: Record<string, number> = { refs: 120, graph: 90 };
    const specs = buildColumnSpecs(
      ["refs", "graph"],
      (c) => widths[c],
      { refs: 80, graph: 80, msg: 80, author: 50, date: 50, sha: 50, changes: 70 },
    );
    expect(specs).toEqual([
      { id: "refs", width: 120, minWidth: 80 },
      { id: "graph", width: 90, minWidth: 80 },
    ]);
  });
});
