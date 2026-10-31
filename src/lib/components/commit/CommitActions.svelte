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
  import Icon from "$lib/icons/Icon.svelte";

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

<nav class="actions" aria-label="Commit actions">
  <button class="act" onclick={cherryPick} title="Cherry-pick this commit" aria-label="Cherry-pick this commit">
    <Icon name="cherry-pick" size={16} />
  </button>
  <button class="act" onclick={revert} title="Revert this commit" aria-label="Revert this commit">
    <Icon name="undo" size={16} />
  </button>
  <button class="act" onclick={createBranch} title="Create a branch here" aria-label="Create a branch here">
    <Icon name="branch" size={16} />
  </button>
  <button class="act" onclick={createTag} title="Create a tag here" aria-label="Create a tag here">
    <Icon name="tag" size={16} />
  </button>
  <button class="act" onclick={checkoutDetached} title="Check out this commit (detached HEAD)" aria-label="Check out this commit (detached HEAD)">
    <Icon name="checkout" size={16} />
  </button>
  <span class="reset-group" title="Reset the current branch to this commit">
    Reset:
    <button class="mode" onclick={() => resetTo("soft")}>soft</button>
    <button class="mode" onclick={() => resetTo("mixed")}>mixed</button>
    <button class="mode danger" onclick={() => resetTo("hard")}>hard</button>
  </span>
</nav>

<style>
  .actions {
    display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap;
    padding: var(--sp-4) var(--sp-6);
    border-top: 1px solid var(--border);
    background: var(--bg-elev);
  }
  /* Icon actions: 24 px square, the glyph is the only label, so each has a title. */
  .act, .mode {
    height: var(--h-row);
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border);
    border-radius: var(--radius); cursor: pointer;
    font-size: var(--fs-sm);
  }
  .act {
    width: var(--h-row); padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .mode { padding: 0 var(--sp-5); }
  .act:hover, .mode:hover:not(.danger) { background: var(--border-strong); }
  .mode.danger:hover { background: color-mix(in srgb, var(--del) 22%, transparent); border-color: var(--del); color: var(--del); }
  .reset-group {
    display: inline-flex; align-items: center; gap: var(--sp-3);
    font-size: var(--fs-sm); color: var(--fg-muted); margin-left: auto;
  }
</style>
