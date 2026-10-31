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
  import Icon from "$lib/icons/Icon.svelte";
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
      <button class="x" onclick={closeModal} title="Close" aria-label="Close">
        <Icon name="close" size={16} />
      </button>
    </header>

    <div class="body">
      <textarea
        bind:value={message}
        placeholder="Commit message"
        rows="8"
      ></textarea>
      {#if stagedCount > 0}
        <div class="warn">
          <Icon name="warning" size={14} />
          <span>{stagedCount} staged change{stagedCount === 1 ? "" : "s"} will be folded into the amended commit.</span>
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
    display: flex; flex-direction: column; gap: var(--sp-4);
  }
  textarea {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--sp-4) var(--sp-5);
    font-size: var(--fs-md);
    font-family: "Cascadia Code", Consolas, monospace;
    resize: vertical;
    min-height: 120px;
  }
  textarea:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .warn {
    display: flex; align-items: center; gap: var(--sp-4);
    font-size: var(--fs-sm);
    color: var(--modified);
    background: color-mix(in srgb, var(--modified) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--modified) 40%, transparent);
    border-radius: var(--radius);
    padding: var(--sp-3) var(--sp-4);
  }
  .warn span { flex: 1; min-width: 0; }
  .hint { font-size: var(--fs-xs); color: var(--fg-muted); }

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
  .primary:disabled {
    background: transparent; color: var(--fg-muted);
    border-color: var(--border); cursor: not-allowed;
  }
</style>
