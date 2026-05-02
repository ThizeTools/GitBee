// GitHub auth + repo cache. Auth state is fetched once on app boot and
// kept in memory; repo list is loaded lazily and cached for the session.

import { writable, get } from "svelte/store";
import { ipc, type GhRepo } from "$lib/ipc";

export interface GhAuth {
  authenticated: boolean;
  login: string | null;
  avatarUrl: string | null;
}

export const ghAuth = writable<GhAuth>({
  authenticated: false, login: null, avatarUrl: null,
});

export const ghRepos = writable<GhRepo[] | null>(null);
export const ghReposLoading = writable<boolean>(false);
export const ghReposError = writable<string | null>(null);

let bootDone = false;
export async function bootGithubAuth() {
  if (bootDone) return;
  bootDone = true;
  try {
    const s = await ipc.githubStatus();
    const authed = !!s.authenticated;
    ghAuth.set({
      authenticated: authed,
      login: s.login ?? null,
      avatarUrl: s.avatar_url ?? null,
    });
    // Background prefetch — once we know we're signed in, kick off the
    // repo list so the clone picker is instant when the user opens it.
    // Fire-and-forget; errors land in ghReposError where the picker can
    // show them when it eventually mounts.
    if (authed) { void fetchRepos(); }
  } catch {
    ghAuth.set({ authenticated: false, login: null, avatarUrl: null });
  }
}

export async function loginWithPat(token: string) {
  const u = await ipc.githubSavePat(token);
  ghAuth.set({ authenticated: true, login: u.login, avatarUrl: u.avatar_url });
  ghRepos.set(null); // force refetch
}

export async function logoutGithub() {
  await ipc.githubLogout();
  ghAuth.set({ authenticated: false, login: null, avatarUrl: null });
  ghRepos.set(null);
}

// In-flight promise so concurrent callers (eg. background prefetch +
// user opening the clone modal) coalesce into a single backend call
// instead of racing two GraphQL queries.
let inFlight: Promise<void> | null = null;

export function fetchRepos(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (!force && get(ghRepos)) return Promise.resolve();
  ghReposLoading.set(true);
  ghReposError.set(null);
  inFlight = (async () => {
    try {
      const r = await ipc.githubListRepos();
      ghRepos.set(r);
    } catch (e) {
      const msg = String(e);
      // INSUFFICIENT_SCOPES: backend already cleared the token. Reset auth
      // state so the UI swaps the picker for the login panel automatically.
      if (msg.includes("INSUFFICIENT_SCOPES")) {
        ghAuth.set({ authenticated: false, login: null, avatarUrl: null });
        ghReposError.set("Token outdated — sign in again to grant the new scopes (read:org).");
      } else {
        ghReposError.set(msg);
      }
      ghRepos.set([]);
    } finally {
      ghReposLoading.set(false);
      inFlight = null;
    }
  })();
  return inFlight;
}
