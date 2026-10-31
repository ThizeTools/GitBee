import { describe, expect, test } from "bun:test";
import {
  editableFlags,
  firstProblem,
  indexOfSha,
  isFold,
  keyAction,
  messageToSend,
  moveRow,
  oldestFirst,
  parseAction,
  summary,
  toItems,
  updateRow,
} from "./model";
import type { RebaseAction, RebaseEntry } from "./types";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

/** Fake editor row. Defaults to a pick with no message loaded. */
function entry(sha: string, action: RebaseAction = "pick", extra: Partial<RebaseEntry> = {}): RebaseEntry {
  return { sha, subject: `subject ${sha[0]}`, author: "Ada", action, fullMessage: null, draft: null, loadError: null, ...extra };
}

/** A row with its full message loaded, as a reword needs. */
function loaded(sha: string, action: RebaseAction, message: string): RebaseEntry {
  return entry(sha, action, { fullMessage: message });
}

describe("order", () => {
  test("oldestFirst reverses the display order and leaves the input alone", () => {
    const display = [entry(SHA_C), entry(SHA_B), entry(SHA_A)];
    expect(oldestFirst(display).map((e) => e.sha)).toEqual([SHA_A, SHA_B, SHA_C]);
    expect(display[0].sha).toBe(SHA_C);
  });

  test("toItems sends the list oldest first, so the newest row comes last", () => {
    const items = toItems([entry(SHA_C), entry(SHA_B), entry(SHA_A)]);
    expect(items.map((i) => i.sha)).toEqual([SHA_A, SHA_B, SHA_C]);
  });
});

describe("messageToSend", () => {
  test("reword sends the full message when the user did not edit it", () => {
    expect(messageToSend(loaded(SHA_A, "reword", "old text"))).toBe("old text");
  });

  test("reword sends the draft over the full message", () => {
    expect(messageToSend({ ...loaded(SHA_A, "reword", "old"), draft: "new" })).toBe("new");
  });

  test("reword sends null while its message is not loaded", () => {
    expect(messageToSend(entry(SHA_A, "reword"))).toBeNull();
  });

  test("pick sends only an edited message", () => {
    expect(messageToSend(loaded(SHA_A, "pick", "old"))).toBeNull();
    expect(messageToSend({ ...loaded(SHA_A, "pick", "old"), draft: "edited" })).toBe("edited");
  });

  test("squash, fixup and drop never send a message", () => {
    for (const action of ["squash", "fixup", "drop"] as const) {
      expect(messageToSend({ ...loaded(SHA_A, action, "x"), draft: "y" })).toBeNull();
    }
  });

  test("toItems carries the message only where messageToSend gives one", () => {
    const items = toItems([{ ...loaded(SHA_B, "reword", "B new"), draft: null }, loaded(SHA_A, "pick", "A")]);
    expect(items).toEqual([
      { action: "pick", sha: SHA_A, message: null },
      { action: "reword", sha: SHA_B, message: "B new" },
    ]);
  });
});

describe("firstProblem", () => {
  test("a plain pick list is valid", () => {
    expect(firstProblem([entry(SHA_B), entry(SHA_A)])).toBeNull();
  });

  test("refuses a list where every row is dropped", () => {
    expect(firstProblem([entry(SHA_A, "drop")])).toContain("Keep at least one commit");
  });

  test("refuses squash as the oldest kept commit, even when newer rows are fine", () => {
    const problem = firstProblem([entry(SHA_B, "pick"), entry(SHA_A, "squash")]);
    expect(problem).toContain(SHA_A.slice(0, 7));
    expect(problem).toContain("cannot be squash or fixup");
  });

  test("the oldest kept row is found past the dropped ones", () => {
    expect(firstProblem([entry(SHA_B, "pick"), entry(SHA_A, "drop")])).toBeNull();
    expect(firstProblem([entry(SHA_B, "pick"), entry(SHA_A, "fixup"), entry(SHA_C, "drop")])).toContain("cannot be squash");
  });

  test("waits while a reword message is loading, and shows the load error", () => {
    expect(firstProblem([entry(SHA_A, "reword")])).toContain("Loading the message");
    const failed = firstProblem([{ ...entry(SHA_A, "reword"), loadError: "bad object" }]);
    expect(failed).toContain("Could not load");
    expect(failed).toContain("bad object");
  });

  test("refuses a blank reword or edited message", () => {
    expect(firstProblem([loaded(SHA_A, "reword", "   ")])).toContain("is empty");
    expect(firstProblem([{ ...loaded(SHA_A, "pick", "x"), draft: "\n " }])).toContain("is empty");
  });

  test("a squash over an unedited pick needs no message", () => {
    expect(firstProblem([entry(SHA_B, "squash"), loaded(SHA_A, "pick", "A")])).toBeNull();
    expect(firstProblem([loaded(SHA_B, "pick", "B"), entry(SHA_A, "fixup")])).toContain("cannot be squash");
  });
});

describe("summary", () => {
  test("counts folds and drops out of the result", () => {
    const rows = [entry(SHA_C, "squash"), entry(SHA_B, "drop"), entry(SHA_A, "pick")];
    expect(summary(rows)).toBe("3 commits → 1 commit");
  });

  test("uses the plural only where needed", () => {
    expect(summary([entry(SHA_A)])).toBe("1 commit → 1 commit");
    expect(summary([entry(SHA_A), entry(SHA_B)])).toBe("2 commits → 2 commits");
  });
});

describe("editableFlags", () => {
  test("shows a message box for reword rows and for pick heads that fold", () => {
    // Display order, newest first: C folds into B, B is a pick head, A is a reword.
    const rows = [entry(SHA_C, "fixup"), entry(SHA_B, "pick"), entry(SHA_A, "reword")];
    expect(editableFlags(rows)).toEqual([false, true, true]);
  });

  test("a plain pick has no message box", () => {
    expect(editableFlags([entry(SHA_B), entry(SHA_A)])).toEqual([false, false]);
  });

  test("a drop between a head and its fold keeps the head editable", () => {
    const rows = [entry(SHA_C, "squash"), entry(SHA_B, "drop"), entry(SHA_A, "pick")];
    expect(editableFlags(rows)).toEqual([false, false, true]);
  });
});

describe("row edits", () => {
  test("moveRow moves an item and returns a new array", () => {
    const before = ["x", "y", "z"];
    expect(moveRow(before, 0, 2)).toEqual(["y", "z", "x"]);
    expect(moveRow(before, 2, 0)).toEqual(["z", "x", "y"]);
    expect(before).toEqual(["x", "y", "z"]);
  });

  test("moveRow ignores out-of-range and same-index moves", () => {
    expect(moveRow(["x", "y"], 0, 5)).toEqual(["x", "y"]);
    expect(moveRow(["x", "y"], 1, 1)).toEqual(["x", "y"]);
  });

  test("updateRow patches one row and leaves the others", () => {
    const next = updateRow([entry(SHA_B), entry(SHA_A)], 1, { action: "drop" });
    expect(next.map((e) => e.action)).toEqual(["pick", "drop"]);
  });

  test("updateRow with an index out of range changes nothing", () => {
    const rows = [entry(SHA_A)];
    expect(updateRow(rows, -1, { action: "drop" })).toEqual(rows);
  });

  test("indexOfSha finds a row or returns -1", () => {
    expect(indexOfSha([entry(SHA_B), entry(SHA_A)], SHA_A)).toBe(1);
    expect(indexOfSha([entry(SHA_B)], SHA_C)).toBe(-1);
  });
});

describe("keys and actions", () => {
  test("keyAction maps p r s f d in either case and rejects other keys", () => {
    expect(keyAction("p")).toBe("pick");
    expect(keyAction("R")).toBe("reword");
    expect(keyAction("s")).toBe("squash");
    expect(keyAction("F")).toBe("fixup");
    expect(keyAction("d")).toBe("drop");
    expect(keyAction("x")).toBeNull();
    expect(keyAction("Shift")).toBeNull();
    expect(keyAction("constructor")).toBeNull();
  });

  test("parseAction accepts only the five actions", () => {
    expect(parseAction("squash")).toBe("squash");
    expect(parseAction("edit")).toBeNull();
  });

  test("isFold is true only for squash and fixup", () => {
    expect(isFold("squash")).toBe(true);
    expect(isFold("fixup")).toBe(true);
    expect(isFold("pick")).toBe(false);
    expect(isFold("drop")).toBe(false);
  });
});
