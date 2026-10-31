import { describe, test, expect } from "bun:test";
import { linePrefix, renderLine, splitSegments } from "./lineHtml";

describe("splitSegments", () => {
  test("cuts text at range boundaries and flags the inside pieces", () => {
    expect(splitSegments("abcdef", [{ start: 1, end: 3 }, { start: 4, end: 5 }])).toEqual([
      { text: "a", changed: false },
      { text: "bc", changed: true },
      { text: "d", changed: false },
      { text: "e", changed: true },
      { text: "f", changed: false },
    ]);
  });

  test("no ranges gives one unchanged segment", () => {
    expect(splitSegments("abc", [])).toEqual([{ text: "abc", changed: false }]);
  });

  test("empty text gives no segments", () => {
    expect(splitSegments("", [])).toEqual([]);
  });

  test("segments rejoin to the original text", () => {
    const text = "let value = other;";
    const joined = splitSegments(text, [{ start: 4, end: 9 }, { start: 12, end: 17 }])
      .map((s) => s.text)
      .join("");
    expect(joined).toBe(text);
  });
});

describe("renderLine", () => {
  test("wraps the changed range in dv-wd on plain text", () => {
    expect(renderLine("let a = 1", null, [{ start: 4, end: 5 }])).toBe(
      'let <span class="dv-wd">a</span> = 1',
    );
  });

  test("escapes file text inside a changed range", () => {
    expect(renderLine("<b>", null, [{ start: 0, end: 3 }])).toBe(
      '<span class="dv-wd">&lt;b&gt;</span>',
    );
  });

  test("without ranges it matches the plain highlighter output", () => {
    expect(renderLine("a < b", null)).toBe("a &lt; b");
  });
});

describe("linePrefix", () => {
  test("maps every line kind to its one-column marker", () => {
    expect(linePrefix("add")).toBe("+");
    expect(linePrefix("del")).toBe("-");
    expect(linePrefix("context")).toBe(" ");
    expect(linePrefix("nonewline")).toBe("\\");
  });
});
