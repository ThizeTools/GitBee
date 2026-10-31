import { describe, test, expect } from "bun:test";
import { DEFAULT_DIFF_PREFS, parseDiffPrefs } from "./diffPrefs";

describe("parseDiffPrefs", () => {
  test("missing storage gives the defaults", () => {
    expect(parseDiffPrefs(null)).toEqual(DEFAULT_DIFF_PREFS);
  });

  test("reads a stored split layout with whitespace ignored", () => {
    expect(parseDiffPrefs('{"layout":"split","ignoreWs":true}')).toEqual({
      layout: "split",
      ignoreWs: true,
    });
  });

  test("an unknown layout value falls back to unified", () => {
    expect(parseDiffPrefs('{"layout":"sideways","ignoreWs":true}')).toEqual({
      layout: "unified",
      ignoreWs: true,
    });
  });

  test("a non-boolean ignoreWs falls back to false", () => {
    expect(parseDiffPrefs('{"layout":"split","ignoreWs":"yes"}')).toEqual({
      layout: "split",
      ignoreWs: false,
    });
  });

  test("corrupt or non-object JSON gives the defaults", () => {
    expect(parseDiffPrefs("not json")).toEqual(DEFAULT_DIFF_PREFS);
    expect(parseDiffPrefs("[1,2]")).toEqual({ layout: "unified", ignoreWs: false });
    expect(parseDiffPrefs("null")).toEqual(DEFAULT_DIFF_PREFS);
  });
});
