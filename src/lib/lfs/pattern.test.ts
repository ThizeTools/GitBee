import { describe, expect, test } from "bun:test";
import { patternError } from "$lib/lfs/pattern";

describe("patternError", () => {
  test("a glob is accepted", () => {
    expect(patternError("*.psd")).toBeNull();
  });

  test("an empty or blank value asks for a pattern", () => {
    expect(patternError("")).toContain("Enter a pattern");
    expect(patternError("   ")).toContain("Enter a pattern");
  });

  test("a leading dash would read as a git option", () => {
    expect(patternError("-rf")).toContain("must not start with '-'");
  });

  test("a value with a line break is refused", () => {
    expect(patternError("a.bin\nb.bin")).toContain("one line");
  });
});
