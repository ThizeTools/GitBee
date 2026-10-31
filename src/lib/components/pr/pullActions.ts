// Actions behind the pull-request detail pane. Anything that writes to GitHub
// or to the working tree asks first where the spec says so (merge always
// confirms). Each action reports through a toast and returns whether it
// succeeded, so the caller reloads only when something changed. Spec:
// docs/specs/github-pull-requests.md.

import { get } from "svelte/store";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ipc } from "$lib/ipc";
import { graph } from "$lib/stores/repo";
import { showGraph } from "$lib/stores/center";
import { scrollGraphTo } from "$lib/stores/graphscroll";
import { choiceDialog, confirmDialog } from "$lib/stores/dialog";
import { logAction } from "$lib/stores/logs";
import { notifyError, notifyInfo, notifySuccess } from "$lib/stores/notifications";
import { copy, runAction } from "$lib/menus/menuActions";
import { notifyGithubError } from "$lib/github/githubErrors";
import { mergeChoices } from "$lib/github/pulls";
import type { MergeMethod, PullDetail, PullRow, ReviewEvent } from "$lib/github/pullTypes";

const REVIEW_TITLES: Record<ReviewEvent, string> = {
  approve: "Approved",
  request_changes: "Changes requested",
  comment: "Comment sent",
};

/** Checks out the PR's branch. Fork PRs land on a local `pr/<n>` branch. */
export async function checkoutPull(repoPath: string, pr: PullRow): Promise<void> {
  const r = await runAction(`Checkout PR #${pr.number}`, () =>
    ipc.prCheckout(repoPath, pr.number, pr.head_ref, pr.same_repo),
  );
  if (r.ok) {
    notifySuccess(`Checked out PR #${pr.number}`, pr.same_repo ? pr.head_ref : `pr/${pr.number} (fork)`);
  } else {
    notifyError("Checkout failed", r.error);
  }
}

/** Asks for a strategy, then a confirmation, then merges on GitHub. Returns true when merged. */
export async function mergePull(owner: string, repo: string, pr: PullDetail): Promise<boolean> {
  const method = await choiceDialog<MergeMethod>({
    title: `Merge #${pr.number} into ${pr.base_ref}`,
    message: pr.title,
    choices: mergeChoices(),
  });
  if (method === null) return false;
  const ok = await confirmDialog({
    title: `Merge #${pr.number} on GitHub?`,
    message: `This writes to ${pr.base_ref} on GitHub. Your local branches are not changed.`,
    confirmLabel: "Merge",
    danger: true,
  });
  if (!ok) return false;
  const r = await logAction(`Merge PR #${pr.number}`, () =>
    ipc.githubMergePull(owner, repo, pr.number, method),
  );
  if (!r.ok) {
    notifyGithubError("Merge failed", r.error);
    return false;
  }
  notifySuccess(`Merged #${pr.number}`, pr.base_ref);
  return true;
}

/** Posts a review. Returns true when GitHub accepted it. */
export async function submitReview(
  owner: string,
  repo: string,
  number: number,
  event: ReviewEvent,
  body: string,
): Promise<boolean> {
  const r = await logAction(`Review PR #${number}`, () =>
    ipc.githubReviewPull(owner, repo, number, event, body),
  );
  if (!r.ok) {
    notifyGithubError("Review failed", r.error);
    return false;
  }
  notifySuccess(REVIEW_TITLES[event], `#${number}`);
  return true;
}

/** Opens a GitHub URL in the default browser. A null URL does nothing. */
export async function openExternal(url: string | null): Promise<void> {
  if (!url) return;
  try {
    await openUrl(url);
  } catch (e) {
    notifyError("Could not open the browser", String(e));
  }
}

/** Opens the PR page in the default browser. */
export function openPullOnGitHub(pr: PullRow): Promise<void> {
  return openExternal(pr.html_url);
}

export async function copyPullLink(pr: PullRow): Promise<void> {
  await copy(pr.html_url, `PR #${pr.number} link`);
}

/** Scrolls the graph to the PR's head commit. Only possible when that commit is in the loaded history. */
export function showPullInGraph(sha: string): void {
  const loaded = get(graph)?.nodes.some((n) => n.sha === sha) ?? false;
  if (!loaded) {
    notifyInfo("Not in the loaded history", "The head commit is older than the graph that is loaded.");
    return;
  }
  showGraph();
  scrollGraphTo(sha);
}
