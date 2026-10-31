import { beforeEach, describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import type { ProfilesApi } from "./api";
import { applyProfileWithNotice } from "./applyToRepo";
import { repoIdentity } from "./identityStore";
import type { Profile, RepoIdentity } from "./profile";
import { dismissAll, notices } from "$lib/stores/notifications";

const WORK: Profile = { id: "p1", name: "Work", userName: "Jane Doe", userEmail: "jane@work.example" };
const LOCAL: RepoIdentity = { name: "Jane Doe", email: "jane@work.example", source: "local" };

/** Fake IPC whose write either succeeds or rejects with a fixed message. */
class FakeApplyApi implements ProfilesApi {
  constructor(private readonly writeError: string | null = null) {}

  async profilesList(): Promise<Profile[]> {
    return [];
  }

  async profilesSave(): Promise<void> {}

  async profileApply(): Promise<void> {
    if (this.writeError !== null) throw this.writeError;
  }

  async repoIdentity(): Promise<RepoIdentity> {
    return LOCAL;
  }
}

beforeEach(() => {
  dismissAll();
  repoIdentity.set(null);
});

describe("applyProfileWithNotice", () => {
  test("a successful apply resolves true and announces the profile", async () => {
    const api = new FakeApplyApi();
    expect(await applyProfileWithNotice("/repo", WORK, api)).toBe(true);
    const shown = get(notices);
    expect(shown[0]?.title).toBe("Committing as Work");
    expect(shown[0]?.message).toBe("Jane Doe <jane@work.example>");
  });

  test("a failed apply resolves false and shows the backend message as an error", async () => {
    const api = new FakeApplyApi("could not write user.email in this repo");
    expect(await applyProfileWithNotice("/repo", WORK, api)).toBe(false);
    const shown = get(notices);
    expect(shown[0]?.kind).toBe("error");
    expect(shown[0]?.message).toContain("could not write user.email");
  });
});
