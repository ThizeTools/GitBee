import { describe, expect, test } from "bun:test";
import {
  commitIdentityHint,
  defaultProfile,
  identityText,
  identityTone,
  makeProfileId,
  pillText,
  profileLabel,
  upsertProfile,
  type Profile,
  type RepoIdentity,
} from "./profile";

const WORK: Profile = { id: "p1", name: "Work", userName: "Jane Doe", userEmail: "jane@work.example" };
const HOME: Profile = { id: "p2", name: "Home", userName: "Jane", userEmail: "jane@home.example" };

describe("identityText", () => {
  test("joins name and email in angle brackets", () => {
    expect(identityText("Jane Doe", "jane@work.example")).toBe("Jane Doe <jane@work.example>");
  });

  test("a missing name leaves only the email", () => {
    expect(identityText("", "jane@work.example")).toBe("<jane@work.example>");
  });

  test("a missing email leaves only the name", () => {
    expect(identityText("Jane", "")).toBe("Jane");
  });

  test("both missing is empty", () => {
    expect(identityText("", "")).toBe("");
  });
});

describe("pillText and identityTone", () => {
  const local: RepoIdentity = { name: "Jane", email: "j@h", source: "local" };

  test("an identity shows its text", () => {
    expect(pillText(local)).toBe("Jane <j@h>");
  });

  test("no identity shows the warning text", () => {
    expect(pillText({ name: "", email: "", source: "none" })).toBe("No git identity");
  });

  test("local is the accent, global muted, none the warning", () => {
    expect(identityTone("local")).toBe("accent");
    expect(identityTone("global")).toBe("muted");
    expect(identityTone("none")).toBe("warn");
  });
});

describe("commitIdentityHint", () => {
  test("an unknown identity shows no hint", () => {
    expect(commitIdentityHint(null)).toBeNull();
  });

  test("a set identity says who the commit is for, in any source", () => {
    for (const source of ["local", "global"] as const) {
      expect(commitIdentityHint({ name: "Jane", email: "j@h", source })).toEqual({
        text: "Committing as Jane <j@h>",
        warn: false,
      });
    }
  });

  test("no identity is a warning", () => {
    expect(commitIdentityHint({ name: "", email: "", source: "none" })).toEqual({
      text: "No git identity set for this repo",
      warn: true,
    });
  });
});

describe("profileLabel", () => {
  test("names the profile and its identity", () => {
    expect(profileLabel(WORK)).toBe("Work: Jane Doe <jane@work.example>");
  });
});

describe("defaultProfile", () => {
  test("finds the profile marked default", () => {
    expect(defaultProfile([WORK, { ...HOME, isDefault: true }])?.id).toBe("p2");
  });

  test("is undefined when none is marked", () => {
    expect(defaultProfile([WORK, HOME])).toBeUndefined();
  });
});

describe("upsertProfile", () => {
  test("appends a profile with a new id", () => {
    expect(upsertProfile([WORK], HOME).map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  test("replaces the profile with the same id in place", () => {
    const renamed = { ...WORK, name: "Client" };
    expect(upsertProfile([WORK, HOME], renamed)).toEqual([renamed, HOME]);
  });

  test("a new default clears the mark on every other profile", () => {
    const list = upsertProfile([{ ...WORK, isDefault: true }, HOME], { ...HOME, isDefault: true });
    expect(list.map((p) => p.isDefault === true)).toEqual([false, true]);
  });

  test("a profile that is not default leaves the existing default alone", () => {
    const list = upsertProfile([{ ...WORK, isDefault: true }], HOME);
    expect(defaultProfile(list)?.id).toBe("p1");
  });

  test("does not change the list it was given", () => {
    const before = [WORK];
    upsertProfile(before, { ...WORK, isDefault: true });
    expect(before[0].isDefault).toBeUndefined();
  });
});

describe("makeProfileId", () => {
  test("gives a different id each call", () => {
    const ids = new Set([makeProfileId(), makeProfileId(), makeProfileId()]);
    expect(ids.size).toBe(3);
    expect(makeProfileId().length).toBeGreaterThan(0);
  });
});
