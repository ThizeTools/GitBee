<script lang="ts">
  // Confirm dialog for the panel's "Discard all changes" trash button. The
  // parent owns visibility and the discard itself.
  interface Props {
    /** Dismiss without discarding: Cancel, backdrop click, or Escape. */
    onCancel: () => void;
    /** Run the discard: the Reset All button. */
    onConfirm: () => void;
  }
  let { onCancel, onConfirm }: Props = $props();
</script>

<div class="confirm-backdrop" role="presentation"
  onclick={onCancel}>
  <div class="confirm-modal" role="dialog" tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => { if (e.key === "Escape") onCancel(); }}>
    <header class="modal-head">
      <h3>Discard all changes?</h3>
    </header>
    <div class="modal-body">
      <p>This will discard all staged and unstaged changes, including new
        untracked files. Are you sure you want to discard all changes?</p>
    </div>
    <div class="confirm-actions">
      <button class="btn cancel" onclick={onCancel}>Cancel</button>
      <button class="btn reset-all" onclick={onConfirm}>Reset All</button>
    </div>
  </div>
</div>

<style>
  .confirm-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    z-index: 1500;
  }
  /* Dialog layout from the region-7 spec: header with a bottom border, body,
     then a right-aligned footer of 28 px buttons. */
  .confirm-modal {
    width: min(440px, 92vw);
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: 0 14px 40px rgba(0,0,0,0.5);
    color: var(--fg);
  }
  .modal-head {
    padding: var(--sp-5) var(--sp-20);
    border-bottom: 1px solid var(--border);
  }
  .confirm-modal h3 {
    margin: 0;
    font-size: var(--fs-lg); font-weight: 600;
    color: var(--del);
  }
  .modal-body { padding: var(--sp-15) var(--sp-20); }
  .confirm-modal p {
    margin: 0;
    font-size: var(--fs-md); line-height: 1.5;
    color: var(--fg-muted);
  }
  .confirm-actions {
    display: flex; justify-content: flex-end; gap: var(--sp-4);
    padding: 0 var(--sp-20) var(--sp-15);
  }
  .confirm-actions .btn {
    height: 28px; padding: 0 var(--sp-8);
    border-radius: var(--radius); cursor: pointer;
    font-size: var(--fs-md); font-weight: 600;
  }
  .btn.cancel {
    background: transparent; color: var(--fg);
    border: 1px solid var(--border);
  }
  .btn.cancel:hover { background: var(--border); }
  .btn.reset-all {
    background: var(--del); color: var(--bg);
    border: 1px solid var(--del);
  }
  .btn.reset-all:hover { background: color-mix(in srgb, var(--del) 80%, white); }
</style>
