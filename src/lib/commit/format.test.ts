import { describe, test, expect } from "bun:test";
import { commitBody, formatCommitDate } from "./format";

describe("commitBody", () => {
  test("skips the subject and the blank line after it", () => {
    expect(commitBody("Fix x\n\nFirst line\nSecond line\n")).toBe("First line\nSecond line");
  });

  test("gives an empty body for a subject-only message", () => {
    expect(commitBody("Only subject\n")).toBe("");
  });

  test("normalizes CRLF line endings", () => {
    expect(commitBody("Subj\r\n\r\nBody\r\n")).toBe("Body");
  });
});

describe("formatCommitDate", () => {
  test("formats local date and time as dd/mm/yyyy @ hh:mm", () => {
    const ts = new Date(2026, 0, 5, 9, 7).getTime() / 1000;
    expect(formatCommitDate(ts)).toBe("05/01/2026 @ 09:07");
  });
});
