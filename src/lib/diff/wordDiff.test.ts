import { describe, test, expect } from "bun:test";
import { MAX_WORD_DIFF_CHARS, tokenize, wordDiffRanges } from "./wordDiff";

describe("tokenize", () => {
  test("splits words, whitespace and single punctuation", () => {
    expect(tokenize("a_b c1+").map((t) => t.text)).toEqual(["a_b", " ", "c1", "+"]);
  });

  test("keeps surrogate pairs in one token", () => {
    expect(tokenize("é😀x").map((t) => t.text)).toEqual(["é", "😀", "x"]);
  });
});

describe("wordDiffRanges", () => {
  test("identical lines have no changed ranges", () => {
    expect(wordDiffRanges("const a = 1;", "const a = 1;")).toEqual({ old: [], new: [] });
  });

  test("marks the changed word on each side", () => {
    expect(wordDiffRanges("foo(bar)", "foo(baz)")).toEqual({
      old: [{ start: 4, end: 7 }],
      new: [{ start: 4, end: 7 }],
    });
  });

  test("marks a changed literal", () => {
    expect(wordDiffRanges("let x = 1;", "let x = 2;")).toEqual({
      old: [{ start: 8, end: 9 }],
      new: [{ start: 8, end: 9 }],
    });
  });

  test("keeps separate changed words apart when a shared space is between them", () => {
    expect(wordDiffRanges("one two", "uno dos").old).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
  });

  test("an added word leaves no old-side range and marks the new word", () => {
    const ranges = wordDiffRanges("a c", "a b c");
    expect(ranges.old).toEqual([]);
    const marked = ranges.new.map((r) => "a b c".slice(r.start, r.end)).join("");
    expect(marked).toContain("b");
  });

  test("an empty side yields no old ranges and a full new range", () => {
    expect(wordDiffRanges("", "abc")).toEqual({ old: [], new: [{ start: 0, end: 3 }] });
  });

  test("pairs longer than the cap are skipped", () => {
    const long = "x".repeat(MAX_WORD_DIFF_CHARS + 1);
    expect(wordDiffRanges(long, "y")).toEqual({ old: [], new: [] });
    expect(wordDiffRanges("y", long)).toEqual({ old: [], new: [] });
  });
});
