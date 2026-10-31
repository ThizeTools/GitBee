import { describe, expect, test } from "bun:test";
import { emptyDraft, type ProfileDraft } from "./draft";
import { isDraftValid, validateDraft } from "./validate";
import type { Profile } from "./profile";

const FILLED: ProfileDraft = { ...emptyDraft(), name: "Work", userName: "Jane", userEmail: "jane@work.example" };
const SAVED: Profile = { id: "p1", name: "Home", userName: "Jane", userEmail: "j@home" };

describe("validateDraft", () => {
  test("a filled draft has no errors", () => {
    const errors = validateDraft(FILLED, [SAVED]);
    expect(errors).toEqual({});
    expect(isDraftValid(errors)).toBe(true);
  });

  test("an empty draft names every required field", () => {
    const errors = validateDraft(emptyDraft(), []);
    expect(Object.keys(errors).sort()).toEqual(["name", "userEmail", "userName"]);
    expect(isDraftValid(errors)).toBe(false);
  });

  test("whitespace alone counts as empty", () => {
    const errors = validateDraft({ ...FILLED, name: "   ", userName: "  " }, []);
    expect(errors.name).toBeDefined();
    expect(errors.userName).toBeDefined();
  });

  test("a label used by another profile is refused, ignoring case", () => {
    const errors = validateDraft({ ...FILLED, name: "HOME" }, [SAVED]);
    expect(errors.name).toContain("already exists");
  });

  test("the profile being edited is not its own duplicate", () => {
    expect(validateDraft({ ...FILLED, name: "Home" }, [])).toEqual({});
  });

  test("an email needs text on both sides of the at sign", () => {
    for (const email of ["jane", "@work.example", "jane@"]) {
      const errors = validateDraft({ ...FILLED, userEmail: email }, []);
      expect(errors.userEmail, email).toBe("Use the form name@host.");
    }
  });

  test("an email with an at sign and text on both sides passes", () => {
    expect(validateDraft({ ...FILLED, userEmail: "jane@h" }, []).userEmail).toBeUndefined();
  });
});
