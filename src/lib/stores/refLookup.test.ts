import { describe, test, expect } from "bun:test";
import type { CommitRef, StashEntry } from "$lib/ipc";
import {
  checkoutTargetOf,
  fastForwardFailureMessage,
  findRefSha,
  findStashIndex,
  pickRemoteForBranch,
} from "./refLookup";

const refs: CommitRef[] = [
  { name: "main", kind: "localbranch", target_sha: "aaa" },
  { name: "v1.0", kind: "tag", target_sha: "bbb" },
  { name: "origin/main", kind: "remotebranch", target_sha: "aaa" },
  { name: "origin/feature/x", kind: "remotebranch", target_sha: "ccc" },
  { name: "backup/feature", kind: "remotebranch", target_sha: "ddd" },
];

describe("findRefSha", () => {
  test("returns the target of a ref with the matching kind and name", () => {
    expect(findRefSha(refs, "tag", "v1.0")).toBe("bbb");
  });

  test("does not match a ref of another kind with the same name", () => {
    expect(findRefSha(refs, "localbranch", "v1.0")).toBeNull();
  });

  test("returns null when the graph has no such ref", () => {
    expect(findRefSha(refs, "localbranch", "gone")).toBeNull();
  });
});

describe("pickRemoteForBranch", () => {
  test("prefers origin when several remotes track the branch", () => {
    const multi: CommitRef[] = [
      { name: "upstream/main", kind: "remotebranch", target_sha: "x" },
      { name: "origin/main", kind: "remotebranch", target_sha: "y" },
    ];
    expect(pickRemoteForBranch(["upstream", "origin"], multi, "main")).toBe("origin");
  });

  test("falls back to another remote when origin does not track the branch", () => {
    const other: CommitRef[] = [{ name: "fork/dev", kind: "remotebranch", target_sha: "x" }];
    expect(pickRemoteForBranch(["origin", "fork"], other, "dev")).toBe("fork");
  });

  test("returns null when no remote has the branch", () => {
    expect(pickRemoteForBranch(["origin"], refs, "nothere")).toBeNull();
  });

  test("matches the whole branch name, not a prefix of it", () => {
    expect(pickRemoteForBranch(["origin"], refs, "feature")).toBeNull();
    expect(pickRemoteForBranch(["origin"], refs, "feature/x")).toBe("origin");
  });
});

describe("findStashIndex", () => {
  const stashes: StashEntry[] = [
    { index: 0, message: "On main: a", sha: "s0" },
    { index: 1, message: "On main: b", sha: "s1" },
  ];

  test("returns the current index of a stash commit by sha", () => {
    expect(findStashIndex(stashes, "s1")).toBe(1);
  });

  test("returns null once the stash has been dropped", () => {
    expect(findStashIndex(stashes, "gone")).toBeNull();
  });
});

describe("checkoutTargetOf", () => {
  test("uses the branch name when HEAD is attached", () => {
    expect(checkoutTargetOf("main", "aaa")).toEqual({ ref: "main", isBranch: true });
  });

  test("uses the sha when HEAD is detached", () => {
    expect(checkoutTargetOf(null, "aaa")).toEqual({ ref: "aaa", isBranch: false });
  });

  test("returns null on an unborn branch with no commits", () => {
    expect(checkoutTargetOf(null, null)).toBeNull();
  });
});

describe("fastForwardFailureMessage", () => {
  test("explains a rejected non-fast-forward and keeps git's text", () => {
    const stderr = "! [rejected] feature -> feature (non-fast-forward)";
    const msg = fastForwardFailureMessage("feature", stderr);
    expect(msg).toContain("feature has commits its remote does not have");
    expect(msg).toContain(stderr);
  });

  test("passes other git errors through trimmed", () => {
    expect(fastForwardFailureMessage("dev", "  fatal: couldn't find remote ref  \n"))
      .toBe("fatal: couldn't find remote ref");
  });
});
