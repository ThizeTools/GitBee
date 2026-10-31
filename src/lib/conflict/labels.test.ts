import { describe, expect, test } from "bun:test";
import { activeOp, sideNames, takeLabel } from "./labels";
import type { OpFlags } from "./labels";

const NONE: OpFlags = { merging: false, rebasing: false, cherry_picking: false, reverting: false };

describe("activeOp", () => {
  test("returns null when no op is running or the state is not loaded", () => {
    expect(activeOp(NONE)).toBeNull();
    expect(activeOp(null)).toBeNull();
  });

  test("each flag maps to its op", () => {
    expect(activeOp({ ...NONE, merging: true })).toBe("merge");
    expect(activeOp({ ...NONE, rebasing: true })).toBe("rebase");
    expect(activeOp({ ...NONE, cherry_picking: true })).toBe("cherry-pick");
    expect(activeOp({ ...NONE, reverting: true })).toBe("revert");
  });

  test("a rebase wins over the CHERRY_PICK_HEAD that a conflicting pick leaves behind", () => {
    expect(activeOp({ ...NONE, rebasing: true, cherry_picking: true })).toBe("rebase");
  });
});

describe("sideNames and takeLabel", () => {
  test("rebase labels ours as the base and theirs as the user's commit", () => {
    expect(sideNames("rebase")).toEqual({ ours: "Base (onto)", theirs: "Your commit" });
    expect(takeLabel("ours", sideNames("rebase"))).toBe("Take base (onto)");
    expect(takeLabel("theirs", sideNames("rebase"))).toBe("Take your commit");
  });

  test("merge, cherry-pick, revert and no op use Mine and Theirs", () => {
    for (const op of ["merge", "cherry-pick", "revert", null] as const) {
      expect(sideNames(op)).toEqual({ ours: "Mine", theirs: "Theirs" });
    }
    expect(takeLabel("ours", sideNames("merge"))).toBe("Take mine");
    expect(takeLabel("theirs", sideNames("merge"))).toBe("Take theirs");
  });
});
