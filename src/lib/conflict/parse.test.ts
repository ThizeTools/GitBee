import { describe, expect, test } from "bun:test";
import {
  hasMarkers,
  linesForChoice,
  looksBinary,
  parseConflicts,
  resolveConflicts,
} from "./parse";

const TWO_WAY = [
  "a",
  "<<<<<<< HEAD",
  "x",
  "=======",
  "y",
  ">>>>>>> feature",
  "b",
  "",
].join("\n");

const DIFF3 = [
  "<<<<<<< ours-label",
  "o",
  "||||||| merged common ancestors",
  "b",
  "=======",
  "t",
  ">>>>>>> theirs-label",
  "",
].join("\n");

describe("parseConflicts: two-way blocks", () => {
  test("splits text around one block and reads the sides and labels", () => {
    const doc = parseConflicts(TWO_WAY);
    expect(doc.conflicts.length).toBe(1);
    expect(doc.malformed).toBe(false);
    const block = doc.conflicts[0];
    expect(block.ours).toEqual(["x"]);
    expect(block.theirs).toEqual(["y"]);
    expect(block.base).toBeNull();
    expect(block.oursLabel).toBe("HEAD");
    expect(block.theirsLabel).toBe("feature");
    expect(doc.segments.map((s) => s.kind)).toEqual(["text", "conflict", "text"]);
  });

  test("ours and theirs choices rebuild the file with the chosen side only", () => {
    const doc = parseConflicts(TWO_WAY);
    expect(resolveConflicts(doc, { 0: "ours" })).toBe("a\nx\nb\n");
    expect(resolveConflicts(doc, { 0: "theirs" })).toBe("a\ny\nb\n");
  });

  test("an empty choice map returns the original text byte for byte", () => {
    const doc = parseConflicts(TWO_WAY);
    expect(resolveConflicts(doc, {})).toBe(TWO_WAY);
  });

  test("both keeps ours then theirs, bothReverse keeps theirs then ours", () => {
    const doc = parseConflicts(TWO_WAY);
    expect(resolveConflicts(doc, { 0: "both" })).toBe("a\nx\ny\nb\n");
    expect(resolveConflicts(doc, { 0: "bothReverse" })).toBe("a\ny\nx\nb\n");
  });

  test("linesForChoice gives the lines a block contributes for each choice", () => {
    const block = parseConflicts(TWO_WAY).conflicts[0];
    expect(linesForChoice(block, undefined)).toBe(block.raw);
    expect(linesForChoice(block, "both")).toEqual(["x", "y"]);
    expect(linesForChoice(block, { custom: "k" })).toEqual(["k"]);
  });

  test("custom text replaces the block and a trailing newline is not a blank line", () => {
    const doc = parseConflicts(TWO_WAY);
    expect(resolveConflicts(doc, { 0: { custom: "z\nw\n" } })).toBe("a\nz\nw\nb\n");
    expect(resolveConflicts(doc, { 0: { custom: "" } })).toBe("a\nb\n");
  });
});

describe("parseConflicts: diff3 base section", () => {
  test("reads the base lines and drops them in every choice", () => {
    const doc = parseConflicts(DIFF3);
    const block = doc.conflicts[0];
    expect(block.base).toEqual(["b"]);
    expect(block.oursLabel).toBe("ours-label");
    expect(block.theirsLabel).toBe("theirs-label");
    expect(resolveConflicts(doc, { 0: "both" })).toBe("o\nt\n");
    expect(resolveConflicts(doc, { 0: "bothReverse" })).toBe("t\no\n");
  });
});

describe("parseConflicts: several blocks", () => {
  const MULTI = [
    "<<<<<<< HEAD", "a1", "=======", "a2", ">>>>>>> f",
    "mid",
    "<<<<<<< HEAD", "b1", "=======", "b2", ">>>>>>> f",
    "",
  ].join("\n");

  test("indexes choices by block order and keeps markers for undecided blocks", () => {
    const doc = parseConflicts(MULTI);
    expect(doc.conflicts.length).toBe(2);
    const partial = resolveConflicts(doc, { 1: "theirs" });
    expect(partial).toBe(
      "<<<<<<< HEAD\na1\n=======\na2\n>>>>>>> f\nmid\nb2\n",
    );
    expect(hasMarkers(partial)).toBe(true);
  });

  test("resolving every block leaves no markers", () => {
    const doc = parseConflicts(MULTI);
    const done = resolveConflicts(doc, { 0: "ours", 1: "both" });
    expect(done).toBe("a1\nmid\nb1\nb2\n");
    expect(hasMarkers(done)).toBe(false);
  });
});

describe("parseConflicts: line endings", () => {
  test("CRLF files are detected and rebuilt with CRLF only", () => {
    const crlf = "a\r\n<<<<<<< HEAD\r\nx\r\n=======\r\ny\r\n>>>>>>> f\r\nb\r\n";
    const doc = parseConflicts(crlf);
    expect(doc.eol).toBe("\r\n");
    expect(doc.conflicts[0].ours).toEqual(["x"]);
    const out = resolveConflicts(doc, { 0: "ours" });
    expect(out).toBe("a\r\nx\r\nb\r\n");
    expect(out).not.toMatch(/[^\r]\n/);
  });

  test("LF files stay LF", () => {
    expect(parseConflicts(TWO_WAY).eol).toBe("\n");
  });

  test("a mostly-LF file with one CRLF line keeps LF", () => {
    expect(parseConflicts("a\nb\nc\r\n").eol).toBe("\n");
  });
});

describe("parseConflicts: malformed input", () => {
  const UNTERMINATED = "a\n<<<<<<< HEAD\nx\n=======\ny\n";

  test("a start marker with no end marker stays plain text and sets malformed", () => {
    const doc = parseConflicts(UNTERMINATED);
    expect(doc.conflicts.length).toBe(0);
    expect(doc.malformed).toBe(true);
    expect(resolveConflicts(doc, {})).toBe(UNTERMINATED);
    expect(hasMarkers(UNTERMINATED)).toBe(true);
  });

  test("an outer start marker cut short by a nested one stays text; the inner block parses", () => {
    const nested = "<<<<<<< A\nx\n<<<<<<< B\ny\n=======\nz\n>>>>>>> C\n";
    const doc = parseConflicts(nested);
    expect(doc.malformed).toBe(true);
    expect(doc.conflicts.length).toBe(1);
    expect(doc.conflicts[0].oursLabel).toBe("B");
    expect(hasMarkers(resolveConflicts(doc, {}))).toBe(true);
  });

  test("a stray end marker is flagged and kept as text", () => {
    const doc = parseConflicts("a\n>>>>>>> feature\nb\n");
    expect(doc.malformed).toBe(true);
    expect(resolveConflicts(doc, {})).toBe("a\n>>>>>>> feature\nb\n");
  });

  test("a complete block after a broken one is still parsed", () => {
    const text = "<<<<<<< X\nlost\n" + TWO_WAY;
    const doc = parseConflicts(text);
    expect(doc.malformed).toBe(true);
    expect(doc.conflicts.length).toBe(1);
  });
});

describe("hasMarkers and looksBinary", () => {
  test("plain text with a bare separator line has no markers", () => {
    expect(hasMarkers("Title\n=======\nbody\n")).toBe(false);
  });

  test("start, base and end markers are detected, including CRLF endings", () => {
    expect(hasMarkers("<<<<<<< HEAD\r\nx\r\n")).toBe(true);
    expect(hasMarkers("a\n||||||| base\n")).toBe(true);
    expect(hasMarkers("a\r\n>>>>>>> feature\r\n")).toBe(true);
  });

  test("a line that only looks like a marker prefix is not a marker", () => {
    expect(hasMarkers("<<<<<<<<x\n")).toBe(false);
  });

  test("a NUL byte marks the content as binary", () => {
    expect(looksBinary("PNG\u0000data")).toBe(true);
    expect(looksBinary("plain text")).toBe(false);
  });
});
