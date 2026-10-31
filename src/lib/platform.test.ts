import { describe, expect, test } from "bun:test";
import { isMacOS, isWindows } from "./platform";

const WINDOWS = { platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
const MACOS = { platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" };
const LINUX = { platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" };

describe("isWindows", () => {
  test("detects Windows", () => expect(isWindows(WINDOWS)).toBe(true));
  test("rejects macOS", () => expect(isWindows(MACOS)).toBe(false));
  test("rejects Linux", () => expect(isWindows(LINUX)).toBe(false));
  test("does not match 'Darwin' in a UA fallback", () => {
    expect(isWindows({ platform: "", userAgent: "GitBee Darwin/25.0" })).toBe(false);
  });
  // An explicit empty navigator, not `undefined`: a default parameter would read the real
  // host navigator, which is Windows on this machine.
  test("false without a navigator", () => expect(isWindows({})).toBe(false));
});

describe("isMacOS", () => {
  test("detects macOS", () => expect(isMacOS(MACOS)).toBe(true));
  test("rejects Windows", () => expect(isMacOS(WINDOWS)).toBe(false));
  test("rejects Linux", () => expect(isMacOS(LINUX)).toBe(false));
  test("falls back to the UA when platform is empty", () => {
    expect(isMacOS({ platform: "", userAgent: MACOS.userAgent })).toBe(true);
  });
});
