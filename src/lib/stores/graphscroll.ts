import { writable, get } from "svelte/store";
import { graph, busy, currentRepo, localBranches, refreshActive } from "$lib/stores/repo";
import { ipc } from "$lib/ipc";
import { notifySuccess, notifyError, notifyInfo } from "$lib/stores/notifications";
import { confirmDialog } from "$lib/stores/dialog";
import { pushUndo } from "$lib/stores/history";
import { checkoutUndo } from "$lib/stores/undoEntries";
import { checkoutTargetOf, type CheckoutTarget } from "$lib/stores/refLookup";

// When set to a SHA, GraphCanvas scrolls that row into view and clears it.
export const graphScrollTarget = writable<string | null>(null);

export function scrollGraphTo(sha: string) { graphScrollTarget.set(sha); }

// withBusy can't be used here: branch_checkout returns Rust `Ok(())` which
// Tauri serializes as JSON `null` — same value withBusy uses to signal a
// thrown error. We need a try/catch that distinguishes the two.
async function runCheckout(fn: () => Promise<unknown>): Promise<true | string> {
  busy.set(true);
  try {
    await fn();
    await refreshActive();
    return true;
  } catch (e) {
    return String(e);
  } finally {
    busy.set(false);
  }
}

// Git refuses to switch branches when the working tree has changes that
// would be overwritten. Detect that specific stderr signature so we can
// offer the user an auto-stash retry instead of just dumping the raw
// error. Matches both `checkout` and `switch` phrasing for safety.
function isDirtyTreeError(err: string): boolean {
  const s = err.toLowerCase();
  return s.includes("would be overwritten")
    || s.includes("local changes") && s.includes("overwritten")
    || s.includes("please commit your changes or stash them");
}

// Try a checkout; if it fails because the tree is dirty, offer auto-stash:
// stash push -u → checkout → stash pop. The stash message is tagged with
// the target so it's easy to recognise in stash list if pop fails (e.g.
// due to a conflict applying back onto the new branch/commit). `target`
// is just the human label used in the prompt and stash message; `doCheckout`
// is the actual git invocation (branch name vs raw SHA).
export async function checkoutWithAutoStash(
  repo: string,
  target: string,
  doCheckout: () => Promise<unknown>,
): Promise<true | string> {
  const first = await runCheckout(doCheckout);
  if (first === true) return true;
  if (!isDirtyTreeError(first)) return first;
  const ok = await confirmDialog({
    title: "Uncommitted changes",
    message:
      `You have uncommitted changes that would be overwritten by switching to "${target}".\n\n` +
      `Stash them, switch, and re-apply afterwards?`,
    confirmLabel: "Stash and switch",
  });
  if (!ok) return first;

  const stashMsg = `auto-stash before switch to ${target}`;
  busy.set(true);
  try {
    try { await ipc.stashCreate(repo, stashMsg, true); }
    catch (e) { return `auto-stash failed: ${e}`; }
    try { await doCheckout(); }
    catch (e) {
      // checkout still failed (e.g., branch name conflict). Pop the
      // stash back so the user isn't left with their changes hidden.
      try { await ipc.stashPop(repo, 0); } catch { /* leave stash for user */ }
      return String(e);
    }
    let popOk = true;
    try { await ipc.stashPop(repo, 0); }
    catch { popOk = false; }
    await refreshActive();
    if (!popOk) {
      notifyInfo(
        "Switched, but stash kept",
        `Could not auto-pop "${stashMsg}" — likely a conflict. It's still in your stash list.`,
      );
    }
    return true;
  } finally {
    busy.set(false);
  }
}

function checkoutBranchAutoStash(repo: string, branch: string) {
  const target: CheckoutTarget = { ref: branch, isBranch: true };
  return checkoutRecorded(repo, target, branch, () => ipc.branchCheckout(repo, branch));
}

export function checkoutShaAutoStash(repo: string, sha: string) {
  const target: CheckoutTarget = { ref: sha, isBranch: false };
  return checkoutRecorded(repo, target, sha.slice(0, 7), () => ipc.checkoutSha(repo, sha));
}

// Records a successful checkout so Undo can return to the HEAD it replaced.
// A checkout that changes nothing (already on that branch or commit) is not recorded.
async function checkoutRecorded(
  repo: string,
  target: CheckoutTarget,
  label: string,
  doCheckout: () => Promise<unknown>,
): Promise<true | string> {
  const g = get(graph);
  const previous = checkoutTargetOf(g?.head_branch ?? null, g?.head_sha ?? null);
  const result = await checkoutWithAutoStash(repo, label, doCheckout);
  const moved = previous !== null && (previous.ref !== target.ref || previous.isBranch !== target.isBranch);
  if (result === true && previous && moved) {
    pushUndo(checkoutUndo(repo, previous, label, doCheckout));
  }
  return result;
}

export async function checkoutAndJump(branch: string) {
  const repo = get(currentRepo);
  if (!repo) return;
  const r = await checkoutBranchAutoStash(repo, branch);
  if (r !== true) { notifyError("Checkout failed", `${branch}: ${r}`); return; }
  notifySuccess("Checked out", branch);
  const head = get(graph)?.head_sha;
  if (head) scrollGraphTo(head);
}

export async function checkoutRemoteAndJump(remote: string, branch: string) {
  const repo = get(currentRepo);
  if (!repo) return;
  const fullRemote = `${remote}/${branch}`;
  // Create the tracking branch only when no local one exists. The old flow
  // tried checkout first and treated ANY failure (even a declined
  // auto-stash prompt) as "branch missing", then failed again on create.
  if (!get(localBranches).some((b) => b.name === branch)) {
    const c = await runCheckout(() => ipc.branchCreate(repo, branch, fullRemote));
    if (c !== true) { notifyError("Checkout failed", `Could not create ${branch} from ${fullRemote}: ${c}`); return; }
  }
  const r = await checkoutBranchAutoStash(repo, branch);
  if (r !== true) { notifyError("Checkout failed", `${branch}: ${r}`); return; }
  notifySuccess("Checked out", `${branch} (tracking ${fullRemote})`);
  const head = get(graph)?.head_sha;
  if (head) scrollGraphTo(head);
}

/** Double-click on a graph row: checks out the branch pointing at `sha`.
 * Prefers a local branch other than the current one, else a remote branch
 * (creating a local tracking branch). No branch, or only the current one,
 * is a no-op; detached checkout stays an explicit menu action.
 * Example: `checkoutBranchAtCommit(node.sha)` */
export async function checkoutBranchAtCommit(sha: string) {
  const g = get(graph);
  if (!g) return;
  const refs = g.refs.filter((r) => r.target_sha === sha);
  const local = refs.find((r) => r.kind === "localbranch" && r.name !== g.head_branch);
  if (local) return checkoutAndJump(local.name);
  if (refs.some((r) => r.kind === "localbranch")) return;
  const remote = refs.find((r) => r.kind === "remotebranch" && !r.name.endsWith("/HEAD"));
  if (!remote) return;
  const slash = remote.name.indexOf("/");
  await checkoutRemoteAndJump(remote.name.slice(0, slash), remote.name.slice(slash + 1));
}
