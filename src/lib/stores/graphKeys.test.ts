import { describe, test, expect } from "bun:test";
import {
  graphKeyAction, isEditableTarget, nextRowIndex, pageRowCount,
  undoKeyAction, upstreamSha,
} from "./graphKeys";
import type { CommitRef } from "$lib/ipc";

function ref(name: string, kind: CommitRef["kind"], sha: string): CommitRef {
  return { name, kind, target_sha: sha };
}

describe("graphKeyAction", () => {
  test("h selects HEAD", () => {
    expect(graphKeyAction("h", false)).toEqual({ kind: "head" });
  });
  test("Shift+H selects upstream", () => {
    expect(graphKeyAction("H", true)).toEqual({ kind: "upstream" });
  });
  test("plain H (caps lock) is not bound", () => {
    expect(graphKeyAction("H", false)).toBeNull();
  });
  test("shifted h is not bound", () => {
    expect(graphKeyAction("h", true)).toBeNull();
  });
  test("Home/End/PageUp/PageDown map to row moves", () => {
    expect(graphKeyAction("Home", false)).toEqual({ kind: "move", move: "home" });
    expect(graphKeyAction("End", false)).toEqual({ kind: "move", move: "end" });
    expect(graphKeyAction("PageUp", false)).toEqual({ kind: "move", move: "pageUp" });
    expect(graphKeyAction("PageDown", false)).toEqual({ kind: "move", move: "pageDown" });
  });
  test("shifted Home is left to the browser", () => {
    expect(graphKeyAction("Home", true)).toBeNull();
  });
  test("unrelated keys return null", () => {
    expect(graphKeyAction("a", false)).toBeNull();
    expect(graphKeyAction("constructor", false)).toBeNull();
  });
});

describe("undoKeyAction", () => {
  test("Ctrl+Z undoes", () => {
    expect(undoKeyAction("z", false)).toBe("undo");
    expect(undoKeyAction("Z", false)).toBe("undo");
  });
  test("Ctrl+Shift+Z redoes", () => {
    expect(undoKeyAction("Z", true)).toBe("redo");
  });
  test("Ctrl+Y redoes", () => {
    expect(undoKeyAction("y", false)).toBe("redo");
  });
  test("Ctrl+Shift+Y is not bound", () => {
    expect(undoKeyAction("Y", true)).toBeNull();
  });
  test("other keys return null", () => {
    expect(undoKeyAction("x", false)).toBeNull();
  });
});

describe("nextRowIndex", () => {
  test("returns -1 with no rows", () => {
    expect(nextRowIndex("down", 0, 0, 10)).toBe(-1);
    expect(nextRowIndex("home", -1, 0, 10)).toBe(-1);
  });
  test("home and end go to the first and last row", () => {
    expect(nextRowIndex("home", 40, 100, 10)).toBe(0);
    expect(nextRowIndex("end", 40, 100, 10)).toBe(99);
  });
  test("down and up step one row and clamp at the ends", () => {
    expect(nextRowIndex("down", 4, 10, 5)).toBe(5);
    expect(nextRowIndex("down", 9, 10, 5)).toBe(9);
    expect(nextRowIndex("up", 4, 10, 5)).toBe(3);
    expect(nextRowIndex("up", 0, 10, 5)).toBe(0);
  });
  test("PageDown and PageUp move by the page size and clamp", () => {
    expect(nextRowIndex("pageDown", 3, 100, 20)).toBe(23);
    expect(nextRowIndex("pageDown", 90, 100, 20)).toBe(99);
    expect(nextRowIndex("pageUp", 30, 100, 20)).toBe(10);
    expect(nextRowIndex("pageUp", 5, 100, 20)).toBe(0);
  });
  test("PageUp never lands on the WIP slot", () => {
    expect(nextRowIndex("pageUp", 0, 10, 5)).toBe(0);
  });
  test("nothing selected: down lands on row 0, pageDown on row page-1", () => {
    expect(nextRowIndex("down", -1, 10, 5)).toBe(0);
    expect(nextRowIndex("pageDown", -1, 100, 20)).toBe(19);
  });
  test("a page of 0 still moves one row", () => {
    expect(nextRowIndex("pageDown", 2, 10, 0)).toBe(3);
  });
  test("a stale current index past the end is clamped first", () => {
    expect(nextRowIndex("down", 50, 10, 5)).toBe(9);
    expect(nextRowIndex("up", 50, 10, 5)).toBe(8);
  });
});

describe("pageRowCount", () => {
  test("60% of the viewport in rows", () => {
    expect(pageRowCount(800, 28)).toBe(17);
  });
  test("never less than one row", () => {
    expect(pageRowCount(10, 28)).toBe(1);
    expect(pageRowCount(0, 28)).toBe(1);
  });
});

describe("upstreamSha", () => {
  const refs: CommitRef[] = [
    ref("main", "localbranch", "aaa"),
    ref("origin/main", "remotebranch", "bbb"),
    ref("origin/HEAD", "remotebranch", "ccc"),
    ref("fork/main", "remotebranch", "ddd"),
    ref("origin/feature/x", "remotebranch", "eee"),
    ref("feature/x", "localbranch", "fff"),
  ];

  test("returns origin/<branch> target", () => {
    expect(upstreamSha(refs, "main")).toBe("bbb");
  });
  test("prefers origin over another remote", () => {
    const onlyFork = refs.filter((r) => r.name !== "origin/main");
    expect(upstreamSha(onlyFork, "main")).toBe("ddd");
    expect(upstreamSha(refs, "main")).toBe("bbb");
  });
  test("handles branch names containing a slash", () => {
    expect(upstreamSha(refs, "feature/x")).toBe("eee");
  });
  test("null when detached", () => {
    expect(upstreamSha(refs, null)).toBeNull();
  });
  test("null when the remote ref is not loaded", () => {
    expect(upstreamSha(refs, "release")).toBeNull();
  });
  test("ignores local branches with the same name", () => {
    expect(upstreamSha([ref("main", "localbranch", "aaa")], "main")).toBeNull();
  });
});

describe("isEditableTarget", () => {
  test("input, textarea and select are editable", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
  });
  test("contenteditable is editable", () => {
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  test("buttons, divs and missing targets are not editable", () => {
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: false })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
