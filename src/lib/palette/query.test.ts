import { describe, expect, test } from "bun:test";
import { applyTypedInput, isShaQuery } from "$lib/palette/query";

describe("applyTypedInput", () => {
  test("a prefix character typed into the unprefixed box picks its mode and is dropped from the text", () => {
    expect(applyTypedInput(">", "all")).toEqual({ mode: "actions", text: "" });
    expect(applyTypedInput("@feat", "all")).toEqual({ mode: "branches", text: "feat" });
    expect(applyTypedInput("#beef", "all")).toEqual({ mode: "commits", text: "beef" });
    expect(applyTypedInput("/src", "all")).toEqual({ mode: "files", text: "src" });
    expect(applyTypedInput(":dra", "all")).toEqual({ mode: "themes", text: "dra" });
  });

  test("plain text in the unprefixed box stays in the all mode", () => {
    expect(applyTypedInput("pull", "all")).toEqual({ mode: "all", text: "pull" });
  });

  test("inside a prefixed mode a prefix character is ordinary search text", () => {
    expect(applyTypedInput("@x", "actions")).toEqual({ mode: "actions", text: "@x" });
    expect(applyTypedInput("/", "branches")).toEqual({ mode: "branches", text: "/" });
  });

  test("an empty box in the all mode stays empty", () => {
    expect(applyTypedInput("", "all")).toEqual({ mode: "all", text: "" });
  });
});

describe("isShaQuery", () => {
  test("accepts 4 to 40 hex digits", () => {
    expect(isShaQuery("beef")).toBe(true);
    expect(isShaQuery("a".repeat(40))).toBe(true);
    expect(isShaQuery("ABCDEF12")).toBe(true);
  });

  test("rejects shorter, longer or non-hex text", () => {
    expect(isShaQuery("bee")).toBe(false);
    expect(isShaQuery("a".repeat(41))).toBe(false);
    expect(isShaQuery("xyz1")).toBe(false);
    expect(isShaQuery("fix bug")).toBe(false);
  });

  test("ignores surrounding whitespace", () => {
    expect(isShaQuery("  dead  ")).toBe(true);
  });
});
