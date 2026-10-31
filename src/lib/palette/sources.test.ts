import { describe, expect, test } from "bun:test";
import type { CommitRef } from "$lib/ipc";
import { WIP_SHA } from "$lib/stores/repoState";
import {
  branchesOf, buildSources, commitRows, uniqueFiles, type PaletteStoreSnapshot,
} from "$lib/palette/sources";

function ref(name: string, kind: CommitRef["kind"]): CommitRef {
  return { name, kind, target_sha: "a".repeat(40) };
}

function snapshot(over: Partial<PaletteStoreSnapshot> = {}): PaletteStoreSnapshot {
  return {
    repoOpen: true,
    refs: [],
    recentPaths: ["/repos/one"],
    changedPaths: [],
    committedPaths: [],
    commits: [],
    themes: [],
    activeThemeId: "dark",
    layout: { sidebarCollapsed: false, rightPanelCollapsed: false, dimMergeCommits: false, hiddenCols: ["sha"] },
    undoLabel: null,
    redoLabel: null,
    ...over,
  };
}

describe("branchesOf", () => {
  test("keeps local and remote-tracking branches", () => {
    expect(branchesOf([ref("main", "localbranch"), ref("origin/dev", "remotebranch")])).toEqual([
      { name: "main", kind: "local" },
      { name: "origin/dev", kind: "remote" },
    ]);
  });

  test("drops origin/HEAD, which only aliases a branch already listed", () => {
    expect(branchesOf([ref("origin/HEAD", "remotebranch")])).toEqual([]);
  });

  test("ignores tags, stashes and HEAD", () => {
    const refs = [ref("v1", "tag"), ref("stash@{0}", "stash"), ref("HEAD", "head")];
    expect(branchesOf(refs)).toEqual([]);
  });
});

describe("uniqueFiles", () => {
  test("merges both lists and keeps each path once, changed files first", () => {
    expect(uniqueFiles(["a.ts", "b.ts"], ["b.ts", "c.ts"])).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  test("two empty lists give an empty list", () => {
    expect(uniqueFiles([], [])).toEqual([]);
  });
});

describe("commitRows", () => {
  test("maps graph nodes to sha and subject", () => {
    const nodes = [{ sha: "abc1234abc1234abc1234abc1234abc1234abc12", subject: "Fix" }];
    expect(commitRows(nodes)).toEqual([{ sha: "abc1234abc1234abc1234abc1234abc1234abc12", subject: "Fix" }]);
  });

  test("drops the WIP pseudo-row, which is not a commit", () => {
    expect(commitRows([{ sha: WIP_SHA, subject: "Working changes" }])).toEqual([]);
  });
});

describe("buildSources", () => {
  test("passes branches, files and commits through when a repo is open", () => {
    const src = buildSources(snapshot({
      refs: [ref("main", "localbranch")],
      changedPaths: ["x.ts"],
      committedPaths: ["y.ts"],
      commits: [{ sha: "f".repeat(40), subject: "Init" }],
    }));
    expect(src.branches).toEqual([{ name: "main", kind: "local" }]);
    expect(src.files).toEqual(["x.ts", "y.ts"]);
    expect(src.commits).toHaveLength(1);
  });

  test("with no repo open, repo-bound rows are empty but recent repos remain", () => {
    const src = buildSources(snapshot({
      repoOpen: false,
      refs: [ref("main", "localbranch")],
      changedPaths: ["x.ts"],
      commits: [{ sha: "f".repeat(40), subject: "Init" }],
    }));
    expect(src.branches).toEqual([]);
    expect(src.files).toEqual([]);
    expect(src.commits).toEqual([]);
    expect(src.recentRepos).toEqual(["/repos/one"]);
  });

  test("carries the layout and undo labels through unchanged", () => {
    const src = buildSources(snapshot({ undoLabel: "Checkout main", redoLabel: null }));
    expect(src.layout.hiddenCols).toEqual(["sha"]);
    expect(src.undoLabel).toBe("Checkout main");
    expect(src.redoLabel).toBeNull();
  });
});
