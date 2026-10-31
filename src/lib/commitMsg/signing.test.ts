import { describe, expect, test } from "bun:test";
import { gitBool, resolveSign, signStorageKey } from "./signing";

describe("gitBool", () => {
  test("reads git's true spellings in any case", () => {
    for (const v of ["true", "TRUE", "yes", "On", "1", " true "]) {
      expect(gitBool(v)).toBe(true);
    }
  });

  test("reads git's false spellings", () => {
    for (const v of ["false", "no", "OFF", "0", ""]) {
      expect(gitBool(v)).toBe(false);
    }
  });

  test("unset is null, not false", () => {
    expect(gitBool(null)).toBeNull();
  });

  test("an unknown value is null rather than a guess", () => {
    expect(gitBool("maybe")).toBeNull();
  });
});

describe("resolveSign", () => {
  test("the repo default applies when the user has not toggled", () => {
    expect(resolveSign(true, null)).toBe(true);
    expect(resolveSign(false, null)).toBe(false);
  });

  test("a user choice beats the repo default in both directions", () => {
    expect(resolveSign(true, false)).toBe(false);
    expect(resolveSign(false, true)).toBe(true);
  });
});

describe("signStorageKey", () => {
  test("keeps one key per repo path", () => {
    expect(signStorageKey("/a")).not.toBe(signStorageKey("/b"));
  });
});
