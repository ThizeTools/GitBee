import { writable, get } from "svelte/store";
import { graph, busy, currentRepo, refreshActive } from "$lib/stores/repo";
import { ipc } from "$lib/ipc";
import { notifySuccess, notifyError } from "$lib/stores/notifications";

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

export async function checkoutAndJump(branch: string) {
  const repo = get(currentRepo);
  if (!repo) return;
  const r = await runCheckout(() => ipc.branchCheckout(repo, branch));
  if (r !== true) { notifyError("Checkout failed", `${branch}: ${r}`); return; }
  notifySuccess("Checked out", branch);
  const head = get(graph)?.head_sha;
  if (head) scrollGraphTo(head);
}

export async function checkoutRemoteAndJump(remote: string, branch: string) {
  const repo = get(currentRepo);
  if (!repo) return;
  const fullRemote = `${remote}/${branch}`;
  let r = await runCheckout(() => ipc.branchCheckout(repo, branch));
  if (r !== true) {
    const c = await runCheckout(() => ipc.branchCreate(repo, branch, fullRemote));
    if (c !== true) { notifyError("Checkout failed", `Could not create ${branch} from ${fullRemote}: ${c}`); return; }
    r = await runCheckout(() => ipc.branchCheckout(repo, branch));
    if (r !== true) { notifyError("Checkout failed", `${branch}: ${r}`); return; }
  }
  notifySuccess("Checked out", `${branch} (tracking ${fullRemote})`);
  const head = get(graph)?.head_sha;
  if (head) scrollGraphTo(head);
}
