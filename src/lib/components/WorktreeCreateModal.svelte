<script lang="ts">
  // Creates a new git worktree at a folder picked by the user, checked out
  // to `reference` (a local branch, remote-tracking branch, tag, or SHA).
  //
  // For remote-tracking refs we toggle on "create local branch" by default,
  // because `git worktree add <path> origin/foo` produces a detached HEAD
  // — which is almost never what the user wants. With a new branch name
  // we run `git worktree add -b <name> <path> <ref>`.
  import { ipc } from "$lib/ipc";
  import { withBusy, currentRepo } from "$lib/stores/repo";
  import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
  import { notifySuccess, notifyError } from "$lib/stores/notifications";
  import { closeModal } from "$lib/stores/modals";
  import Icon from "$lib/icons/Icon.svelte";
  import { get } from "svelte/store";
  import { untrack } from "svelte";

  interface Props {
    reference: string;
    refLabel: string;
    isRemoteBranch: boolean;
  }
  let { reference, refLabel, isRemoteBranch }: Props = $props();

  // Default the new-branch name to the leaf of the remote ref
  // ("origin/feature/x" → "feature/x"), and pre-tick the checkbox for
  // remote-tracking refs.
  const defaultBranchName = (() => {
    if (!isRemoteBranch) return "";
    const slash = reference.indexOf("/");
    return slash >= 0 ? reference.slice(slash + 1) : reference;
  })();

  let target = $state<string>("");
  let createBranch = $state<boolean>(untrack(() => isRemoteBranch));
  let branchName = $state<string>(defaultBranchName);
  let busy = $state(false);

  async function browseTarget() {
    const picked = await openFolderDialog({
      directory: true, multiple: false,
      title: "Select an empty folder for the new worktree",
    });
    if (typeof picked === "string") target = picked;
  }

  const disabled = $derived(
    busy || !target.trim() || (createBranch && !branchName.trim()),
  );

  async function submit() {
    if (disabled) return;
    const r = get(currentRepo);
    if (!r) return;
    busy = true;
    // worktree_add returns `()` → Tauri serializes JSON null on SUCCESS, which
    // is also withBusy's error sentinel. Comparing the result to null treated
    // every successful creation as a failure. Gate on a local flag set after
    // the awaited call instead. (audit 2026-05)
    let ok = false;
    await withBusy(async () => {
      await ipc.worktreeAdd(
        r,
        target.trim(),
        reference,
        createBranch ? branchName.trim() : undefined,
      );
      ok = true;
    });
    busy = false;
    if (!ok) { notifyError("Worktree create failed", refLabel); return; }
    notifySuccess("Worktree created", `${refLabel} → ${target.trim()}`);
    closeModal();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); closeModal(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); submit(); }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" role="presentation" onclick={closeModal}>
  <div class="modal" role="dialog" aria-label="Create worktree" tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}>
    <header class="modal-head">
      <span class="title">Create worktree from <code>{refLabel}</code></span>
      <button class="x" onclick={closeModal} title="Close" aria-label="Close">
        <Icon name="close" size={16} />
      </button>
    </header>

    <div class="body">
      <div class="field">
        <label for="target">Folder</label>
        <div class="row">
          <input id="target" placeholder="Empty folder for the worktree" bind:value={target} />
          <button class="ghost" onclick={browseTarget} type="button">Browse</button>
        </div>
      </div>

      <label class="check">
        <input type="checkbox" bind:checked={createBranch} />
        <span>Create new branch at <code>{refLabel}</code></span>
      </label>

      {#if createBranch}
        <div class="field">
          <label for="bname">Branch name</label>
          <input id="bname" placeholder="my-feature" bind:value={branchName} />
        </div>
      {/if}
    </div>

    <footer class="modal-foot">
      <button class="ghost" onclick={closeModal}>Cancel</button>
      <button class="primary" onclick={submit} disabled={disabled}>
        {busy ? "Creating…" : "Create worktree"}
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    z-index: 1500;
  }
  .modal {
    width: min(560px, 92vw);
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: 0 18px 50px rgba(0,0,0,0.6);
    display: flex; flex-direction: column;
    color: var(--fg);
  }
  /* Dialog header: 10 px 20 px padding, bottom border, --fs-lg title. */
  .modal-head {
    display: flex; align-items: center;
    padding: var(--sp-5) var(--sp-20);
    border-bottom: 1px solid var(--border-strong);
  }
  .title { font-weight: 600; font-size: var(--fs-lg); flex: 1; }
  .title code { color: var(--accent); font-family: "Cascadia Code", Consolas, monospace; }
  .x {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px;
    background: transparent; border: 0; border-radius: var(--radius);
    color: var(--fg-muted); cursor: pointer;
  }
  .x:hover { color: var(--fg); }

  /* Dialog body: 15 px 20 px padding. */
  .body {
    padding: var(--sp-15) var(--sp-20);
    display: flex; flex-direction: column; gap: var(--sp-6);
  }
  .field { display: flex; flex-direction: column; gap: var(--sp-3); }
  .field label {
    font-size: var(--fs-sm); color: var(--fg-muted);
    text-transform: uppercase; letter-spacing: 0.4px;
    font-weight: 600;
  }
  .field input {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--sp-3) var(--sp-5); font-size: var(--fs-md);
    width: 100%;
  }
  .field input:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .row { display: flex; gap: var(--sp-3); }
  .row input { flex: 1; }
  .check {
    display: flex; align-items: center; gap: var(--sp-4);
    font-size: var(--fs-md); color: var(--fg);
    cursor: pointer;
  }
  .check code { font-family: "Cascadia Code", Consolas, monospace; color: var(--accent); }

  /* Footer: right-aligned, 28 px buttons. */
  .modal-foot {
    display: flex; justify-content: flex-end; gap: var(--sp-4);
    padding: var(--sp-5) var(--sp-20);
    border-top: 1px solid var(--border-strong);
  }
  .ghost {
    height: 28px;
    display: inline-flex; align-items: center;
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 0 var(--sp-6); cursor: pointer; font-size: var(--fs-md);
  }
  .ghost:hover { border-color: var(--fg-muted); }
  .primary {
    height: 28px;
    display: inline-flex; align-items: center;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    padding: 0 var(--sp-8);
    cursor: pointer;
    font-weight: 600; font-size: var(--fs-md);
  }
  .primary:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  .primary:disabled { color: var(--fg-muted); border-color: var(--border); cursor: not-allowed; }
</style>
