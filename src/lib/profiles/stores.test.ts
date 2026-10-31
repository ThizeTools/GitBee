import { beforeEach, describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import type { ProfilesApi } from "./api";
import {
  applyProfileToRepo,
  identityFor,
  refreshRepoIdentity,
  repoIdentity,
  type RepoIdentityState,
} from "./identityStore";
import { profiles, refreshProfiles, saveProfiles } from "./profilesStore";
import type { Profile, RepoIdentity } from "./profile";

const WORK: Profile = { id: "p1", name: "Work", userName: "Jane Doe", userEmail: "jane@work.example", signingKey: "ABCD" };
const GLOBAL: RepoIdentity = { name: "Jane", email: "j@global", source: "global" };
const LOCAL: RepoIdentity = { name: "Jane Doe", email: "jane@work.example", source: "local" };

/** A fake of the profile IPC slice that records every call it receives. */
class FakeProfilesApi implements ProfilesApi {
  readonly saves: Profile[][] = [];
  readonly applies: Array<{ path: string; profile: Profile }> = [];
  private list: Profile[];
  private identity: RepoIdentity;
  private readonly applyError: string | null;
  private readonly identityReply: ((path: string) => Promise<RepoIdentity>) | null;

  constructor(options: {
    list?: Profile[];
    identity?: RepoIdentity;
    applyError?: string;
    identityReply?: (path: string) => Promise<RepoIdentity>;
  } = {}) {
    this.list = options.list ?? [];
    this.identity = options.identity ?? GLOBAL;
    this.applyError = options.applyError ?? null;
    this.identityReply = options.identityReply ?? null;
  }

  async profilesList(): Promise<Profile[]> {
    return this.list;
  }

  async profilesSave(list: Profile[]): Promise<void> {
    this.saves.push(list);
    this.list = list;
  }

  /** A successful apply makes the repo's identity local, as the real write does. */
  async profileApply(path: string, profile: Profile): Promise<void> {
    this.applies.push({ path, profile });
    if (this.applyError !== null) throw this.applyError;
    this.identity = LOCAL;
  }

  async repoIdentity(path: string): Promise<RepoIdentity> {
    if (this.identityReply) return this.identityReply(path);
    return this.identity;
  }
}

/** A promise the test settles by hand, to order two reads. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  repoIdentity.set(null);
  profiles.set([]);
});

describe("refreshRepoIdentity", () => {
  test("stores the identity git reports for the repo", async () => {
    await refreshRepoIdentity("/repo/a", new FakeProfilesApi({ identity: LOCAL }));
    expect(get(repoIdentity)).toEqual({ repo: "/repo/a", identity: LOCAL });
  });

  test("a slow read for a repo the user left does not replace the newer one", async () => {
    const slow = deferred<RepoIdentity>();
    const api = new FakeProfilesApi({
      identityReply: (path) => (path === "/repo/a" ? slow.promise : Promise.resolve(GLOBAL)),
    });
    const first = refreshRepoIdentity("/repo/a", api);
    await refreshRepoIdentity("/repo/b", api);
    slow.resolve(LOCAL);
    await first;
    expect(get(repoIdentity)?.repo).toBe("/repo/b");
    expect(get(repoIdentity)?.identity).toEqual(GLOBAL);
  });

  test("a failed read stores no identity for the repo", async () => {
    const api = new FakeProfilesApi({
      identityReply: () => Promise.reject("repository is gone"),
    });
    await refreshRepoIdentity("/repo/a", api);
    expect(get(repoIdentity)).toEqual({ repo: "/repo/a", identity: null });
  });
});

describe("identityFor", () => {
  const state: RepoIdentityState = { repo: "/repo/a", identity: LOCAL };

  test("returns the identity for the repo the state was read for", () => {
    expect(identityFor(state, "/repo/a")).toEqual(LOCAL);
  });

  test("returns null for another repo, no repo, or no state", () => {
    expect(identityFor(state, "/repo/b")).toBeNull();
    expect(identityFor(state, null)).toBeNull();
    expect(identityFor(null, "/repo/a")).toBeNull();
  });
});

describe("applyProfileToRepo", () => {
  test("writes the profile to the repo and re-reads the identity", async () => {
    const api = new FakeProfilesApi({ identity: GLOBAL });
    await applyProfileToRepo("/repo/a", WORK, api);
    expect(api.applies).toEqual([{ path: "/repo/a", profile: WORK }]);
    expect(get(repoIdentity)?.identity).toEqual(LOCAL);
  });

  test("a failed write rejects with the message and still re-reads the identity", async () => {
    const api = new FakeProfilesApi({ identity: GLOBAL, applyError: "could not write user.email" });
    await expect(applyProfileToRepo("/repo/a", WORK, api)).rejects.toBe("could not write user.email");
    expect(get(repoIdentity)?.identity).toEqual(GLOBAL);
  });
});

describe("profile list stores", () => {
  test("refreshProfiles loads the stored list", async () => {
    await refreshProfiles(new FakeProfilesApi({ list: [WORK] }));
    expect(get(profiles)).toEqual([WORK]);
  });

  test("saveProfiles sends the list and then holds what the backend returns", async () => {
    const api = new FakeProfilesApi({ list: [] });
    await saveProfiles([WORK], api);
    expect(api.saves).toEqual([[WORK]]);
    expect(get(profiles)).toEqual([WORK]);
  });
});
