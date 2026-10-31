// Failures from GitHub commands. A token-scope failure also drops the
// signed-in state, because the backend has already cleared the stored token
// (commands/github.rs `settle_scoped`). The app then shows the sign-in panel
// instead of pretending the user is still signed in.

import { ghAuth } from "$lib/stores/github";
import { notifyError } from "$lib/stores/notifications";
import { scopeErrorMessage } from "./pulls";

/** Signs the UI out when `err` is a scope failure. Returns the sign-in message for
 * that case, or null for any other error (which the caller shows as is). */
export function signInIfScopeError(err: unknown): string | null {
  const scope = scopeErrorMessage(err);
  if (scope !== null) {
    ghAuth.set({ authenticated: false, login: null, avatarUrl: null });
  }
  return scope;
}

/** Toast for a failed GitHub command. */
export function notifyGithubError(title: string, err: unknown): void {
  notifyError(title, signInIfScopeError(err) ?? String(err));
}
