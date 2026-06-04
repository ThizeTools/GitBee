<script lang="ts">
  // Edit message of the HEAD commit via `git commit --amend -m <msg>`.
  // Only HEAD is supported here — older commits would require interactive
  // rebase, which has different failure modes (conflicts, abort/continue
  // flow) and is out of scope for v1. The caller is responsible for
  // gating this menu item to HEAD-only.
  //
  // Caveat surfaced in the modal: any currently staged changes will be
  // folded into the amended commit. We don't auto-stash because that hides
  // intent; we just warn.
  import { ipc } from "$lib/ipc";
  import { withBusy, status, currentRepo } from "$lib/stores/repo";
  import { notifySuccess, notifyError } from "$lib/stores/notifications";
  import { closeModal } from "$lib/stores/modals";
  import { get } from "svelte/store";
  import { untrack } from "svelte";

  interface Props { sha: string; current: string; }
  let { sha, current }: Props = $props();

  // Snapshot current at mount; never re-sync from prop changes (the modal
  // unmounts/remounts when the user picks a different commit, so this is
  // safe). untrack silences the state_referenced_locally compiler warning.
  let message = $state(untrack(() => current));
  let busy = $state(false);

  const stagedCount = $derived(
    $status.filter((e) => e.index !== "unmodified" && e.index !== "untracked").length,
  );
  const disabled = $derived(busy || !message.trim() || message.trim() === current.trim());

  async function submit() {
    if (disabled) return;
    const repo = get(currentRepo);
    if (!repo) return;
    busy = true;
    // commit_create returns `()` → JSON null on SUCCESS, identical to withBusy's
    // error sentinel. Gate on a local flag, not on the result being null,
    // otherwise a successful amend shows "Edit failed". (audit 2026-05)
    let ok = false;
    await withBusy(async () => {
      await ipc.commitCreate(repo, message.trim(), true, false);
      ok = true;
    });
    busy = false;
    if (!ok) { notifyError("Edit failed", "Could not amend commit"); return; }
    notifySuccess("Commit message updated", sha.slice(0, 7));
    closeModal();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); closeModal(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); submit(); }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" role="presentation" onclick={closeModal}>
  <div class="modal" role="dialog" aria-label="Edit commit message" tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}>
    <header class="modal-head">
      <span class="title">Edit commit message <code>{sha.slice(0, 7)}</code></span>
      <button class="x" onclick={closeModal} title="Close">×</button>
    </header>

    <div class="body">
      <textarea
        bind:value={message}
        placeholder="Commit message"
        rows="8"
      ></textarea>
      {#if stagedCount > 0}
        <div class="warn">
          ⚠ {stagedCount} staged change{stagedCount === 1 ? "" : "s"} will be folded into the amended commit.
        </div>
      {/if}
      <div class="hint">Ctrl+Enter to submit · Esc to cancel</div>
    </div>

    <footer class="modal-foot">
      <button class="ghost" onclick={closeModal}>Cancel</button>
      <button class="primary" onclick={submit} disabled={disabled}>
        {busy ? "Amending…" : "Amend"}
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
    font-size: 20px; line-height: 1; cursor: pointer;
    padding: 0 4px; border-radius: 3px;
  }
  .x:hover { color: var(--fg); }

  .body { padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
  textarea {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 4px;
    padding: 8px 10px;
    font-size: 12px;
    font-family: "Cascadia Code", Consolas, monospace;
    resize: vertical;
    min-height: 120px;
  }
  textarea:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .warn {
    font-size: 11px;
    color: #d48a2c;
    background: rgba(212, 138, 44, 0.08);
    border: 1px solid rgba(212, 138, 44, 0.4);
    border-radius: 3px;
    padding: 6px 8px;
  }
  .hint { font-size: 10px; color: var(--fg-muted); }

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
  .primary:disabled {
    background: transparent; color: var(--fg-muted);
    border-color: var(--border); cursor: not-allowed;
  }
</style>
