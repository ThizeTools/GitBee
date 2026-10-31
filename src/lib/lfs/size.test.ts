import { describe, expect, test } from "bun:test";
import { formatSize } from "$lib/lfs/size";

describe("formatSize", () => {
  test("bytes below one kilobyte stay in bytes", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  test("a whole unit drops the decimal", () => {
    expect(formatSize(1024)).toBe("1 KB");
    expect(formatSize(10 * 1024)).toBe("10 KB");
  });

  test("below ten units one decimal is kept", () => {
    expect(formatSize(1536)).toBe("1.5 KB");
  });

  test("large counts move up the units", () => {
    expect(formatSize(12 * 1024 * 1024)).toBe("12 MB");
    expect(formatSize(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });

  test("a negative count is refused, naming the value", () => {
    expect(() => formatSize(-1)).toThrow("got -1");
  });

  test("a count that is not finite is refused", () => {
    expect(() => formatSize(Number.NaN)).toThrow("finite");
  });
});
