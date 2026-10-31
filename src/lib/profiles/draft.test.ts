import { describe, expect, test } from "bun:test";
import { draftFromProfile, emptyDraft, profileFromDraft, type ProfileDraft } from "./draft";
import type { Profile } from "./profile";

describe("profileFromDraft", () => {
  test("trims text fields", () => {
    const draft: ProfileDraft = { ...emptyDraft(), name: " Work ", userName: " Jane ", userEmail: " j@h " };
    expect(profileFromDraft(draft, "p1")).toEqual({
      id: "p1", name: "Work", userName: "Jane", userEmail: "j@h", isDefault: false,
    });
  });

  test("leaves out an empty signing key and an empty format", () => {
    const profile = profileFromDraft({ ...emptyDraft(), signingKey: "   " }, "p1");
    expect("signingKey" in profile).toBe(false);
    expect("gpgFormat" in profile).toBe(false);
  });

  test("keeps a signing key and a format that are set", () => {
    const draft: ProfileDraft = { ...emptyDraft(), signingKey: " ABCD ", gpgFormat: "ssh" };
    const profile = profileFromDraft(draft, "p1");
    expect(profile.signingKey).toBe("ABCD");
    expect(profile.gpgFormat).toBe("ssh");
  });

  test("carries the default flag", () => {
    expect(profileFromDraft({ ...emptyDraft(), isDefault: true }, "p1").isDefault).toBe(true);
  });
});

describe("draftFromProfile", () => {
  test("empty optional fields become empty form values", () => {
    const profile: Profile = { id: "p1", name: "Work", userName: "Jane", userEmail: "j@h" };
    expect(draftFromProfile(profile)).toEqual({
      name: "Work", userName: "Jane", userEmail: "j@h", signingKey: "", gpgFormat: "", isDefault: false,
    });
  });

  test("a saved draft turns back into the same profile", () => {
    const profile: Profile = {
      id: "p1", name: "Work", userName: "Jane", userEmail: "j@h",
      signingKey: "ABCD", gpgFormat: "openpgp", isDefault: true,
    };
    expect(profileFromDraft(draftFromProfile(profile), "p1")).toEqual(profile);
  });
});
