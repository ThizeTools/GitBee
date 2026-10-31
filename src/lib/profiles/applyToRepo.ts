// Applies a profile to a repo and says how it went. The status bar menu and the
// manager's picker both call this, so the success and failure wording lives once.
// Spec: docs/specs/git-profiles.md "Status bar pill".

import { notifyError, notifySuccess } from "$lib/stores/notifications";
import type { ProfilesApi } from "./api";
import { applyProfileToRepo } from "./identityStore";
import { identityText, type Profile } from "./profile";

/**
 * Applies `profile` to `repo` and shows a toast. Resolves true on success.
 * A failure is shown as an error toast and resolves false, so callers never
 * need their own catch.
 *
 * @example await applyProfileWithNotice("/repo", workProfile) // true
 */
export async function applyProfileWithNotice(
  repo: string,
  profile: Profile,
  api?: ProfilesApi,
): Promise<boolean> {
  try {
    await applyProfileToRepo(repo, profile, api);
  } catch (e) {
    notifyError("Could not apply profile", String(e));
    return false;
  }
  notifySuccess(`Committing as ${profile.name}`, identityText(profile.userName, profile.userEmail));
  return true;
}
