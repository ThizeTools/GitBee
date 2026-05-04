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
    const res = await withBusy(() =>
      ipc.worktreeAdd(
        r,
        target.trim(),
        reference,
        createBranch ? branchName.trim() : undefined,
      ),
    );
    busy = false;
    if (res === null) { notifyError("Worktree create failed", refLabel); return; }
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
      <button class="x" onclick={closeModal} title="Close">×</button>
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
    border-radius: 8px;
    box-shadow: 0 18px 50px rgba(0,0,0,0.6);
    display: flex; flex-direction: column;
    color: var(--fg);
  }
  .modal-head {
    display: flex; align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-strong);
  }
  .title { font-weight: 700; font-size: 13px; flex: 1; }
  .title code { color: var(--accent); font-family: "Cascadia Code", Consolas, monospace; }
  .x {
    background: transparent; border: 0; color: var(--fg-muted);
    font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px;
  }
  .x:hover { color: var(--fg); }

  .body { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .field label {
    font-size: 11px; color: var(--fg-muted);
    text-transform: uppercase; letter-spacing: 0.4px;
    font-weight: 600;
  }
  .field input {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 4px;
    padding: 7px 10px; font-size: 12px;
    width: 100%;
  }
  .field input:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .row { display: flex; gap: 6px; }
  .row input { flex: 1; }
  .check {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; color: var(--fg);
    cursor: pointer;
  }
  .check code { font-family: "Cascadia Code", Consolas, monospace; color: var(--accent); }

  .modal-foot {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--border-strong);
  }
  .ghost {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 4px;
    padding: 6px 14px; cursor: pointer; font-size: 12px;
  }
  .ghost:hover { border-color: var(--fg-muted); }
  .primary {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 6px 16px;
    cursor: pointer;
    font-weight: 700; font-size: 12px;
  }
  .primary:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  .primary:disabled { color: var(--fg-muted); border-color: var(--border); cursor: not-allowed; }
</style>
