// The saved profile list the UI reads, and the two calls that load and replace
// it. The backend holds the list; this store is a copy for rendering.
// Spec: docs/specs/git-profiles.md.

import { writable } from "svelte/store";
import { ipc } from "$lib/ipc";
import type { ProfilesApi } from "./api";
import type { Profile } from "./profile";

export const profiles = writable<Profile[]>([]);

/** Loads the stored list into the store. A corrupt stored value rejects, so the caller can say so. */
export async function refreshProfiles(api: ProfilesApi = ipc): Promise<void> {
  profiles.set(await api.profilesList());
}

/**
 * Replaces the stored list, then reloads it, so the store holds what the
 * backend kept (normalized) rather than what the caller sent. A rejected save
 * leaves the store as it was.
 */
export async function saveProfiles(list: readonly Profile[], api: ProfilesApi = ipc): Promise<void> {
  await api.profilesSave([...list]);
  await refreshProfiles(api);
}
