// The identity of the active repo, as git reports it, for the status bar pill
// and the commit box hint. Only the newest read may land, so a slow answer for
// a repo the user already left never shows up under the current one.
// Spec: docs/specs/git-profiles.md "Refresh".

import { writable } from "svelte/store";
import { ipc } from "$lib/ipc";
import { logAppend } from "$lib/stores/logs";
import type { ProfilesApi } from "./api";
import type { Profile, RepoIdentity } from "./profile";

/** The last identity read for `repo`. `identity` is null when the read failed. */
export interface RepoIdentityState {
  repo: string;
  identity: RepoIdentity | null;
}

export const repoIdentity = writable<RepoIdentityState | null>(null);

let newestRead = 0;

/** Reads the identity of `repo` into the store, unless a newer read started first. */
export async function refreshRepoIdentity(repo: string, api: ProfilesApi = ipc): Promise<void> {
  const read = ++newestRead;
  const identity = await api.repoIdentity(repo).catch((e: unknown) => {
    logAppend("error", `git identity: ${e}`);
    return null;
  });
  if (read !== newestRead) return;
  repoIdentity.set({ repo, identity });
}

/** The identity for `repo` when the store holds a successful read for it, else null. */
export function identityFor(state: RepoIdentityState | null, repo: string | null): RepoIdentity | null {
  if (!state || repo === null || state.repo !== repo) return null;
  return state.identity;
}

/**
 * Writes `profile` into the repo's local config. The identity is re-read even
 * when the write fails, because keys written before the failure stay written
 * and the pill must show what git now holds. A failed write then rejects with
 * the backend's message.
 */
export async function applyProfileToRepo(
  repo: string,
  profile: Profile,
  api: ProfilesApi = ipc,
): Promise<void> {
  try {
    await api.profileApply(repo, profile);
  } finally {
    await refreshRepoIdentity(repo, api);
  }
}
