import { describe, expect, test } from "bun:test";
import type { DiffLine, FileDiff, LineKind } from "$lib/ipc";
import {
  LFS_VERSION_LINE, describePointer, parsePointer, pointerPairOf, shortOid,
} from "$lib/lfs/pointer";

const OID_A = "a".repeat(64);
const OID_B = "b".repeat(64);

function pointerLines(oid: string, size: number): string[] {
  return [LFS_VERSION_LINE, `oid sha256:${oid}`, `size ${size}`];
}

function diffLine(kind: LineKind, content: string): DiffLine {
  return { kind, content, old_no: null, new_no: null };
}

/** A one-hunk file diff whose lines are given as [kind, text] pairs. */
function diffOf(rows: [LineKind, string][], over: Partial<FileDiff> = {}): FileDiff {
  const lines = rows.map(([kind, content]) => diffLine(kind, content));
  return {
    old_path: "asset.bin",
    new_path: "asset.bin",
    hunks: [{ header: "@@ -1 +1 @@", old_start: 1, old_lines: 0, new_start: 1, new_lines: 0, lines }],
    binary: false,
    omitted_lines: 0,
    ...over,
  };
}

describe("parsePointer", () => {
  test("reads the oid and the size of the three pointer lines", () => {
    expect(parsePointer(pointerLines(OID_A, 2048))).toEqual({ oid: OID_A, size: 2048 });
  });

  test("a trailing carriage return is not part of the line", () => {
    const lines = pointerLines(OID_A, 7).map((l) => `${l}\r`);
    expect(parsePointer(lines)).toEqual({ oid: OID_A, size: 7 });
  });

  test("lines out of order are not a pointer", () => {
    const [v, oid, size] = pointerLines(OID_A, 1);
    expect(parsePointer([oid, v, size])).toBeNull();
  });

  test("an extra line makes it an ordinary text file", () => {
    expect(parsePointer([...pointerLines(OID_A, 1), "ext foo"])).toBeNull();
  });

  test("an oid that is not 64 lowercase hex characters is refused", () => {
    expect(parsePointer(pointerLines("abc", 1))).toBeNull();
    expect(parsePointer(pointerLines("A".repeat(64), 1))).toBeNull();
  });

  test("a size that is not a plain number is refused", () => {
    expect(parsePointer([LFS_VERSION_LINE, `oid sha256:${OID_A}`, "size 1.5"])).toBeNull();
  });
});

describe("pointerPairOf", () => {
  test("an added pointer file has a new side only", () => {
    const file = diffOf(pointerLines(OID_A, 10).map((l) => ["add", l] as [LineKind, string]));
    expect(pointerPairOf(file)).toEqual({ old: null, new: { oid: OID_A, size: 10 } });
  });

  test("a changed pointer has a pointer on both sides, context lines shared", () => {
    const file = diffOf([
      ["context", LFS_VERSION_LINE],
      ["del", `oid sha256:${OID_A}`],
      ["add", `oid sha256:${OID_B}`],
      ["del", "size 10"],
      ["add", "size 20"],
    ]);
    expect(pointerPairOf(file)).toEqual({
      old: { oid: OID_A, size: 10 },
      new: { oid: OID_B, size: 20 },
    });
  });

  test("a text file is not a pointer", () => {
    const file = diffOf([["add", "hello"], ["add", "world"]]);
    expect(pointerPairOf(file)).toBeNull();
  });

  test("a side that is a pointer next to a text side is not a pointer diff", () => {
    const file = diffOf([
      ["del", LFS_VERSION_LINE],
      ["del", `oid sha256:${OID_A}`],
      ["del", "size 10"],
      ["add", "plain text now"],
    ]);
    expect(pointerPairOf(file)).toBeNull();
  });

  test("a binary diff or a truncated diff is never a card", () => {
    const rows: [LineKind, string][] = pointerLines(OID_A, 1).map((l) => ["add", l]);
    expect(pointerPairOf(diffOf(rows, { binary: true }))).toBeNull();
    expect(pointerPairOf(diffOf(rows, { omitted_lines: 5 }))).toBeNull();
  });

  test("a diff without any lines is not a pointer", () => {
    expect(pointerPairOf(diffOf([]))).toBeNull();
  });
});

describe("describePointer", () => {
  test("both sides read old to new, with sizes and short oids", () => {
    const label = describePointer({
      old: { oid: OID_A, size: 1048576 },
      new: { oid: OID_B, size: 1572864 },
    });
    expect(label.size).toBe("1 MB → 1.5 MB");
    expect(label.oid).toBe(`${"a".repeat(12)} → ${"b".repeat(12)}`);
  });

  test("a single side reads as that side alone", () => {
    const label = describePointer({ old: null, new: { oid: OID_A, size: 512 } });
    expect(label).toEqual({ size: "512 B", oid: "a".repeat(12) });
  });
});

describe("shortOid", () => {
  test("keeps the first twelve characters", () => {
    expect(shortOid(OID_A)).toBe("a".repeat(12));
  });
});
