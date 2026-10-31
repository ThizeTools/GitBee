import { describe, expect, test } from "bun:test";
import { formatKiB, parseDiffTooLarge } from "./aiErrors";

describe("parseDiffTooLarge", () => {
  test("reads the size from the backend message", () => {
    expect(parseDiffTooLarge("other: DIFF_TOO_LARGE:250000")).toBe(250000);
    expect(parseDiffTooLarge("DIFF_TOO_LARGE:204801")).toBe(204801);
  });

  test("other AI errors are not the size refusal", () => {
    expect(parseDiffTooLarge("Invalid Anthropic API key")).toBeNull();
    expect(parseDiffTooLarge("Stage changes first")).toBeNull();
  });

  test("the marker without a number is not a size", () => {
    expect(parseDiffTooLarge("DIFF_TOO_LARGE:")).toBeNull();
  });
});

describe("formatKiB", () => {
  test("rounds bytes to whole KiB", () => {
    expect(formatKiB(250000)).toBe("244 KB");
    expect(formatKiB(204801)).toBe("200 KB");
  });
});
