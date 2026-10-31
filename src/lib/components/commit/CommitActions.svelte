<script lang="ts">
  // Action toolbar at the bottom of the commit details panel. Each action
  // reads the repo before its dialog opens: the dialog waits for the user,
  // and the open tab may change while it is up.
  import { currentRepo, withBusy } from "$lib/stores/repo";
  import { checkoutShaAutoStash } from "$lib/stores/graphscroll";
  import { notifyError } from "$lib/stores/notifications";
  import { pushUndo } from "$lib/stores/history";
  import { tagCreateUndo } from "$lib/stores/undoEntries";
  import { runAction } from "$lib/menus/menuActions";
  import { confirmDialog, promptDialog, requireName } from "$lib/stores/dialog";
  import { ipc } from "$lib/ipc";

  interface Props { sha: string; }
  let { sha }: Props = $props();

  async function cherryPick() {
    const repo = $currentRepo;
    if (!repo) return;
    const ok = await confirmDialog({ title: `Cherry-pick ${sha.slice(0, 7)}?`, confirmLabel: "Cherry-pick" });
    if (!ok) return;
    await withBusy(() => ipc.cherryPick(repo, sha));
  }
  async function revert() {
    const repo = $currentRepo;
    if (!repo) return;
    const ok = await confirmDialog({ title: `Revert ${sha.slice(0, 7)}?`, confirmLabel: "Revert" });
    if (!ok) return;
    await withBusy(() => ipc.revert(repo, sha, true));
  }
  async function resetTo(mode: "soft" | "mixed" | "hard") {
    const repo = $currentRepo;
    if (!repo) return;
    const ok = await confirmDialog({
      title: `Reset --${mode} to ${sha.slice(0, 7)}?`,
      confirmLabel: "Reset",
      danger: mode === "hard",
    });
    if (!ok) return;
    await withBusy(() => ipc.reset(repo, sha, mode));
  }
  async function checkoutDetached() {
    if (!$currentRepo) return;
    const r = await checkoutShaAutoStash($currentRepo, sha);
    if (r !== true) notifyError("Checkout failed", `${sha.slice(0, 7)}: ${r}`);
  }
  async function createBranch() {
    const repo = $currentRepo;
    if (!repo) return;
    const name = await promptDialog({ title: "New branch name:", validate: requireName });
    if (!name) return;
    await withBusy(() => ipc.branchCreate(repo, name, sha));
  }
  async function createTag() {
    const repo = $currentRepo;
    if (!repo) return;
    const name = await promptDialog({ title: "Tag name:", validate: requireName });
    if (!name) return;
    const typed = await promptDialog({ title: "Message (empty for lightweight):" });
    // Cancelling (null) aborts. An empty message keeps the lightweight tag.
    if (typed === null) return;
    const message = typed || undefined;
    const res = await runAction(`Create tag ${name}`, () => ipc.tagCreate(repo, name, sha, message));
    if (res.ok) pushUndo(tagCreateUndo(repo, name, sha, message));
  }
</script>

<nav class="actions">
  <button onclick={cherryPick}>Cherry-pick</button>
  <button onclick={revert}>Revert</button>
  <button onclick={createBranch}>+ Branch</button>
  <button onclick={createTag}>+ Tag</button>
  <button onclick={checkoutDetached}>Checkout</button>
  <span class="reset-group">
    Reset:
    <button onclick={() => resetTo("soft")}>soft</button>
    <button onclick={() => resetTo("mixed")}>mixed</button>
    <button class="danger" onclick={() => resetTo("hard")}>hard</button>
  </span>
</nav>

<style>
  .actions {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-elev);
  }
  .actions button {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); padding: 4px 10px;
    border-radius: 3px; cursor: pointer; font-size: 11px;
  }
  .actions button:hover:not(.danger) { background: var(--border-strong); }
  .actions button.danger:hover { background: color-mix(in srgb, var(--del) 22%, transparent); border-color: var(--del); color: var(--del); }
  .reset-group {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 11px; color: var(--fg-muted); margin-left: auto;
  }
</style>
