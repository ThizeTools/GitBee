import { describe, expect, test } from "bun:test";
import type { CommitRef } from "$lib/ipc";
import {
  canFastForward, dragOptions, dragRefOf, DropOptionCache, refKey, rowDropTarget,
  type DragGraph, type DragRef,
} from "./dragOptions";
import { makeNode } from "../graph/nodeFixtures";

const local = (name: string): DragRef => ({ name, kind: "localbranch" });
const remote = (name: string): DragRef => ({ name, kind: "remotebranch" });
const ref = (name: string, kind: CommitRef["kind"], target_sha: string): CommitRef =>
  ({ name, kind, target_sha });

// Tips: main=m1 (ahead=a2 descends from m1), feat=f2 (its own line from base),
// stale=m1 (an old local branch on main's tip), origin/main=m1, origin/feat=f2.
// `gone` points at a sha that is not loaded.
const graph: DragGraph = {
  nodes: [
    makeNode("a2", ["m1"]),
    makeNode("m1", ["base"]),
    makeNode("f2", ["f1"]),
    makeNode("f1", ["base"]),
    makeNode("base", []),
  ],
  refs: [
    ref("main", "localbranch", "m1"),
    ref("ahead", "localbranch", "a2"),
    ref("feat", "localbranch", "f2"),
    ref("stale", "localbranch", "m1"),
    ref("gone", "localbranch", "zzzz"),
    ref("origin/main", "remotebranch", "m1"),
    ref("origin/feat", "remotebranch", "f2"),
  ],
};

const labels = (opts: { label: string }[]): string[] => opts.map((o) => o.label);

describe("dragOptions: target is HEAD", () => {
  test("merge, rebase, and fast-forward when the target tip is an ancestor of the source", () => {
    const opts = dragOptions(local("ahead"), local("main"), "main", graph);
    expect(labels(opts)).toEqual([
      "Merge ahead into main",
      "Rebase main onto ahead",
      "Fast-forward main to ahead",
    ]);
    expect(opts[2].action).toEqual({ kind: "fast-forward", branch: "main", to: "ahead", head: true });
  });

  test("no fast-forward when the target tip is not an ancestor of the source", () => {
    const opts = dragOptions(local("feat"), local("main"), "main", graph);
    expect(labels(opts)).toEqual(["Merge feat into main", "Rebase main onto feat"]);
  });

  test("no fast-forward when the two tips are equal (nothing to move)", () => {
    const opts = dragOptions(remote("origin/main"), local("main"), "main", graph);
    expect(labels(opts)).toEqual(["Merge origin/main into main", "Rebase main onto origin/main"]);
  });

  test("no fast-forward when the target tip is not loaded", () => {
    const opts = dragOptions(local("ahead"), local("gone"), "main", graph);
    expect(labels(opts)).toEqual(["Checkout gone and merge ahead", "Checkout ahead and rebase onto gone"]);
  });
});

describe("dragOptions: source is HEAD", () => {
  test("rebase the source onto the target, then merge the target into it", () => {
    const opts = dragOptions(local("main"), local("feat"), "main", graph);
    expect(labels(opts)).toEqual(["Rebase main onto feat", "Merge feat into main"]);
    expect(opts[0].action).toEqual({ kind: "rebase", checkout: null, onto: "feat" });
    expect(opts[1].action).toEqual({ kind: "merge", checkout: null, from: "feat" });
  });

  test("never offers a fast-forward of a non-HEAD target from HEAD", () => {
    const opts = dragOptions(local("main"), local("stale"), "main", graph);
    expect(labels(opts)).toEqual(["Rebase main onto stale", "Merge stale into main"]);
  });
});

describe("dragOptions: neither side is HEAD", () => {
  test("checkout and merge, fast-forward, and checkout and rebase when the target is an ancestor", () => {
    const opts = dragOptions(local("ahead"), local("stale"), "main", graph);
    expect(labels(opts)).toEqual([
      "Checkout stale and merge ahead",
      "Fast-forward stale to ahead",
      "Checkout ahead and rebase onto stale",
    ]);
    expect(opts[0].action).toEqual({ kind: "merge", checkout: "stale", from: "ahead" });
    expect(opts[1].action).toEqual({ kind: "fast-forward", branch: "stale", to: "ahead", head: false });
    expect(opts[2].action).toEqual({ kind: "rebase", checkout: "ahead", onto: "stale" });
  });

  test("no fast-forward when the target is not an ancestor", () => {
    const opts = dragOptions(local("feat"), local("stale"), "main", graph);
    expect(labels(opts)).toEqual([
      "Checkout stale and merge feat",
      "Checkout feat and rebase onto stale",
    ]);
  });

  test("a remote source is only merged, never checked out or rebased", () => {
    const opts = dragOptions(remote("origin/feat"), local("stale"), "main", graph);
    expect(labels(opts)).toEqual(["Checkout stale and merge origin/feat"]);
  });
});

describe("dragOptions: remote target", () => {
  test("a HEAD source offers only the merge of the remote into HEAD", () => {
    const opts = dragOptions(local("main"), remote("origin/feat"), "main", graph);
    expect(labels(opts)).toEqual(["Merge origin/feat into main"]);
    expect(opts[0].action).toEqual({ kind: "merge", checkout: null, from: "origin/feat" });
  });

  test("a non-HEAD local source is checked out, then merged with the remote", () => {
    const opts = dragOptions(local("feat"), remote("origin/main"), "main", graph);
    expect(labels(opts)).toEqual(["Checkout feat and merge origin/main"]);
    expect(opts[0].action).toEqual({ kind: "merge", checkout: "feat", from: "origin/main" });
  });

  test("a remote target is never fast-forwarded, even when it is an ancestor", () => {
    const opts = dragOptions(local("ahead"), remote("origin/main"), "main", graph);
    expect(labels(opts)).toEqual(["Checkout ahead and merge origin/main"]);
  });

  test("a remote source onto a remote target gives no options", () => {
    expect(dragOptions(remote("origin/feat"), remote("origin/main"), "main", graph)).toEqual([]);
  });

  test("a remote source onto HEAD still offers merge and rebase", () => {
    const opts = dragOptions(remote("origin/feat"), local("main"), "main", graph);
    expect(labels(opts)).toEqual(["Merge origin/feat into main", "Rebase main onto origin/feat"]);
  });
});

describe("dragOptions: no-op pairs", () => {
  test("dropping a branch on itself gives no options", () => {
    expect(dragOptions(local("main"), local("main"), "main", graph)).toEqual([]);
  });

  test("a local and a remote branch with the same short name are different refs", () => {
    expect(dragOptions(local("main"), remote("origin/main"), "main", graph).length).toBeGreaterThan(0);
  });
});

describe("canFastForward", () => {
  test("true for a strict ancestor target within the loaded graph", () => {
    expect(canFastForward(local("ahead"), local("main"), graph)).toBe(true);
  });

  test("false when the source tip is missing from refs", () => {
    expect(canFastForward(local("nope"), local("main"), graph)).toBe(false);
  });
});

describe("DropOptionCache", () => {
  test("answers true for a pair that has a menu", () => {
    const cache = new DropOptionCache();
    expect(cache.hasOptions(local("ahead"), local("main"), "main", graph)).toBe(true);
  });

  test("answers false without a loaded graph", () => {
    const cache = new DropOptionCache();
    expect(cache.hasOptions(local("ahead"), local("main"), "main", null)).toBe(false);
  });

  test("a new pair replaces the cached answer", () => {
    const cache = new DropOptionCache();
    expect(cache.hasOptions(remote("origin/feat"), remote("origin/main"), "main", graph)).toBe(false);
    expect(cache.hasOptions(local("ahead"), local("main"), "main", graph)).toBe(true);
  });
});

describe("dragRefOf", () => {
  test("keeps local and remote branches", () => {
    expect(dragRefOf({ name: "main", kind: "localbranch" })).toEqual(local("main"));
    expect(dragRefOf({ name: "origin/main", kind: "remotebranch" })).toEqual(remote("origin/main"));
  });

  test("rejects tags, stashes, the detached HEAD pill and remote HEAD", () => {
    expect(dragRefOf({ name: "v1", kind: "tag" })).toBeNull();
    expect(dragRefOf({ name: "stash@{0}", kind: "stash" })).toBeNull();
    expect(dragRefOf({ name: "HEAD", kind: "head" })).toBeNull();
    expect(dragRefOf({ name: "origin/HEAD", kind: "remotebranch" })).toBeNull();
  });
});

describe("rowDropTarget", () => {
  test("prefers the HEAD branch when the row carries it", () => {
    const refs = [ref("x", "localbranch", "s"), ref("main", "localbranch", "s")];
    expect(rowDropTarget(refs, "main")).toEqual(local("main"));
  });

  test("falls back to the first local branch over a remote one", () => {
    const refs = [ref("origin/a", "remotebranch", "s"), ref("b", "localbranch", "s")];
    expect(rowDropTarget(refs, "x")).toEqual(local("b"));
  });

  test("uses a remote branch when the row has no local one", () => {
    expect(rowDropTarget([ref("origin/a", "remotebranch", "s")], null)).toEqual(remote("origin/a"));
  });

  test("null for a row with only tags or remote HEAD", () => {
    expect(rowDropTarget([ref("v1", "tag", "s"), ref("origin/HEAD", "remotebranch", "s")], null)).toBeNull();
    expect(rowDropTarget([], "main")).toBeNull();
  });
});

describe("refKey", () => {
  test("separates a local and a remote ref with the same name", () => {
    expect(refKey(local("main"))).toBe("localbranch:main");
    expect(refKey(remote("main"))).toBe("remotebranch:main");
  });
});
