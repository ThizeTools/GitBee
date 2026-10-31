// "Share as Gist" for one commit: asks for visibility, posts the commit's
// patch as a single gist, and copies the link. Spec:
// docs/specs/github-integration.md, section "Gist sharing".

import { get } from "svelte/store";
import { ipc } from "$lib/ipc";
import { ghAuth } from "$lib/stores/github";
import { choiceDialog } from "$lib/stores/dialog";
import { logAction } from "$lib/stores/logs";
import { notifyInfo, notifySuccess } from "$lib/stores/notifications";
import { repo, copy } from "$lib/menus/menuActions";
import { notifyGithubError } from "./githubErrors";

export async function shareCommitAsGist(sha: string): Promise<void> {
  const path = repo();
  if (!path) return;
  if (!get(ghAuth).authenticated) {
    notifyInfo("Sign in to GitHub first", "A gist is created with your GitHub account.");
    return;
  }
  const isPublic = await choiceDialog<boolean>({
    title: `Share ${sha.slice(0, 7)} as a gist`,
    message: "Secret gists are listed nowhere; anyone with the link can open one. Public gists are listed on your profile and in search.",
    choices: [
      { label: "Secret gist", value: false, description: "Only people with the link can open it." },
      { label: "Public gist", value: true, description: "Listed on GitHub and searchable." },
    ],
  });
  if (isPublic === null) return;
  const result = await logAction(`Share commit ${sha.slice(0, 7)} as gist`, () =>
    ipc.gistCreatePatch(path, sha, isPublic),
  );
  if (!result.ok) {
    notifyGithubError("Gist failed", result.error);
    return;
  }
  await copy(result.value, "gist link");
  notifySuccess("Gist created", `${result.value} (link copied)`);
}
