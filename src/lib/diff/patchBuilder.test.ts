import { describe, test, expect } from "bun:test";
import type { DiffLine, FileDiff, Hunk } from "$lib/ipc";
import { buildPatch, isChangeLine, type LineRef } from "./patchBuilder";
import { add, ctx, del, noNewline } from "./testing";

const FILE_HEAD = ["diff --git a/f.txt b/f.txt", "--- a/f.txt", "+++ b/f.txt"];

/** Joins patch lines the way buildPatch ends them: every line has a newline. */
function text(...lines: string[]): string {
  return lines.map((l) => `${l}\n`).join("");
}

/** A hunk whose counts come from its body, starting at the given numbers. */
function hunkAt(oldStart: number, newStart: number, lines: DiffLine[]): Hunk {
  const oldLines = lines.filter((l) => l.kind === "context" || l.kind === "del").length;
  const newLines = lines.filter((l) => l.kind === "context" || l.kind === "add").length;
  return { header: "", old_start: oldStart, old_lines: oldLines, new_start: newStart, new_lines: newLines, lines };
}

function fileOf(hunks: Hunk[], oldPath = "f.txt", newPath = "f.txt"): FileDiff {
  return { old_path: oldPath, new_path: newPath, hunks, binary: false, omitted_lines: 0 };
}

function pick(...refs: LineRef[]): { kind: "lines"; lines: LineRef[] } {
  return { kind: "lines", lines: refs };
}

describe("buildPatch", () => {
  test("a whole hunk selection reproduces the hunk", () => {
    const file = fileOf([hunkAt(1, 1, [ctx("a", 1, 1), del("b", 2), add("B", 2), ctx("c", 3, 3)])]);
    expect(buildPatch(file, { kind: "hunk", hunkIndex: 0 })).toBe(text(
      ...FILE_HEAD, "@@ -1,3 +1,3 @@", " a", "-b", "+B", " c",
    ));
  });

  test("a single added line is kept and its neighbours stay as context", () => {
    const file = fileOf([hunkAt(1, 1, [ctx("a", 1, 1), add("X", 2), ctx("b", 2, 3)])]);
    expect(buildPatch(file, pick({ hunk: 0, line: 1 }))).toBe(text(
      ...FILE_HEAD, "@@ -1,2 +1,3 @@", " a", "+X", " b",
    ));
  });

  test("an unselected addition is dropped from the patch", () => {
    const file = fileOf([hunkAt(1, 1, [ctx("a", 1, 1), add("X", 2), add("Y", 3), ctx("b", 2, 4)])]);
    expect(buildPatch(file, pick({ hunk: 0, line: 1 }))).toBe(text(
      ...FILE_HEAD, "@@ -1,2 +1,3 @@", " a", "+X", " b",
    ));
  });

  test("a single removed line in a mixed block: the other removal becomes context, the addition goes", () => {
    const file = fileOf([
      hunkAt(1, 1, [ctx("a", 1, 1), del("b", 2), del("c", 3), add("B", 2), ctx("d", 4, 3)]),
    ]);
    expect(buildPatch(file, pick({ hunk: 0, line: 1 }))).toBe(text(
      ...FILE_HEAD, "@@ -1,4 +1,3 @@", " a", "-b", " c", " d",
    ));
  });

  test("an unselected removed line turns into context when only an addition is picked", () => {
    const file = fileOf([
      hunkAt(1, 1, [ctx("a", 1, 1), del("b", 2), del("c", 3), add("B", 2), ctx("d", 4, 3)]),
    ]);
    expect(buildPatch(file, pick({ hunk: 0, line: 3 }))).toBe(text(
      ...FILE_HEAD, "@@ -1,4 +1,5 @@", " a", " b", " c", "+B", " d",
    ));
  });

  test("multiple hunks: a later hunk shifts by the net change of the hunks emitted before it", () => {
    const file = fileOf([
      hunkAt(1, 1, [ctx("a", 1, 1), add("X", 2), ctx("b", 2, 3)]),
      hunkAt(10, 11, [ctx("p", 10, 11), del("q", 11), add("r", 12), ctx("s", 12, 13)]),
    ]);
    expect(buildPatch(file, { kind: "hunk", hunkIndex: 1 })).toBe(text(
      ...FILE_HEAD, "@@ -10,3 +10,3 @@", " p", "-q", "+r", " s",
    ));
    expect(buildPatch(file, pick({ hunk: 0, line: 1 }, { hunk: 1, line: 2 }))).toBe(text(
      ...FILE_HEAD,
      "@@ -1,2 +1,3 @@", " a", "+X", " b",
      "@@ -10,3 +11,4 @@", " p", " q", "+r", " s",
    ));
  });

  test("a no-newline marker stays with its line when that line is kept", () => {
    const file = fileOf([
      hunkAt(1, 1, [ctx("a", 1, 1), del("b", 2), noNewline(), add("B", 2), noNewline()]),
    ]);
    expect(buildPatch(file, { kind: "hunk", hunkIndex: 0 })).toBe(text(
      ...FILE_HEAD, "@@ -1,2 +1,2 @@", " a", "-b", "\\ No newline at end of file",
      "+B", "\\ No newline at end of file",
    ));
  });

  test("a no-newline marker is dropped with its addition", () => {
    const file = fileOf([
      hunkAt(1, 1, [ctx("a", 1, 1), del("b", 2), noNewline(), add("B", 2), noNewline()]),
    ]);
    expect(buildPatch(file, pick({ hunk: 0, line: 1 }))).toBe(text(
      ...FILE_HEAD, "@@ -1,2 +1,1 @@", " a", "-b", "\\ No newline at end of file",
    ));
  });

  test("reverse: an unselected removal is dropped and an unselected addition stays as context", () => {
    const file = fileOf([
      hunkAt(1, 1, [ctx("a", 1, 1), del("b", 2), ctx("c", 3, 2), add("d", 3)]),
    ]);
    expect(buildPatch(file, pick({ hunk: 0, line: 3 }), true)).toBe(text(
      ...FILE_HEAD, "@@ -1,2 +1,3 @@", " a", " c", "+d",
    ));
  });

  test("reverse: a removal picked for restore keeps the unselected addition as context", () => {
    const file = fileOf([
      hunkAt(1, 1, [ctx("a", 1, 1), del("b", 2), ctx("c", 3, 2), add("d", 3)]),
    ]);
    expect(buildPatch(file, pick({ hunk: 0, line: 1 }), true)).toBe(text(
      ...FILE_HEAD, "@@ -1,4 +1,3 @@", " a", "-b", " c", " d",
    ));
  });

  test("an added file keeps its real path on both sides, so a reverse apply finds it", () => {
    const file = fileOf([hunkAt(0, 1, [add("hello", 1)])], "", "new.txt");
    expect(buildPatch(file, { kind: "hunk", hunkIndex: 0 })).toBe(text(
      "diff --git a/new.txt b/new.txt", "--- a/new.txt", "+++ b/new.txt",
      "@@ -0,0 +1,1 @@", "+hello",
    ));
  });

  // Regression: a change after a kept end-of-file context line joined two lines
  // in the index ("a\nb\ncd"). The builder now refuses that selection.
  test("refuses a selection that puts a change after a context line with no newline", () => {
    const file = fileOf([
      hunkAt(1, 1, [ctx("a", 1, 1), ctx("b", 2, 2), del("c", 3), noNewline(), add("c", 3), add("d", 4), noNewline()]),
    ]);
    expect(() => buildPatch(file, pick({ hunk: 0, line: 5 }))).toThrow(/at the end of the file has no newline/);
  });

  test("the whole hunk of a no-newline change is still a valid patch", () => {
    const file = fileOf([
      hunkAt(1, 1, [ctx("a", 1, 1), ctx("b", 2, 2), del("c", 3), noNewline(), add("c", 3), add("d", 4), noNewline()]),
    ]);
    expect(buildPatch(file, { kind: "hunk", hunkIndex: 0 })).toContain("+d\n\\ No newline at end of file\n");
  });

  test("a path with a space ends its header line in a tab, as git writes it", () => {
    const file = fileOf([hunkAt(1, 1, [del("x", 1)])], "my dir/a b.txt", "my dir/a b.txt");
    const patch = buildPatch(file, { kind: "hunk", hunkIndex: 0 });
    expect(patch?.split("\n")[1]).toBe("--- a/my dir/a b.txt\t");
  });

  test("returns null when nothing is selected", () => {
    const file = fileOf([hunkAt(1, 1, [ctx("a", 1, 1), add("X", 2)])]);
    expect(buildPatch(file, pick())).toBeNull();
  });

  test("returns null when the selection points at context lines or a missing hunk", () => {
    const file = fileOf([hunkAt(1, 1, [ctx("a", 1, 1), add("X", 2)])]);
    expect(buildPatch(file, pick({ hunk: 0, line: 0 }))).toBeNull();
    expect(buildPatch(file, { kind: "hunk", hunkIndex: 5 })).toBeNull();
  });
});

describe("isChangeLine", () => {
  test("only added and removed lines are changes", () => {
    expect(isChangeLine(add("x", 1))).toBe(true);
    expect(isChangeLine(del("x", 1))).toBe(true);
    expect(isChangeLine(ctx("x", 1, 1))).toBe(false);
    expect(isChangeLine(noNewline())).toBe(false);
  });
});
