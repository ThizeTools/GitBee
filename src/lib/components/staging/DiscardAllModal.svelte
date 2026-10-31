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
    <h3>Discard all changes?</h3>
    <p>This will discard all staged and unstaged changes, including new
      untracked files. Are you sure you want to discard all changes?</p>
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
  .confirm-modal {
    width: min(440px, 92vw);
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    box-shadow: 0 14px 40px rgba(0,0,0,0.5);
    padding: 18px 20px 14px;
    color: var(--fg);
  }
  .confirm-modal h3 {
    margin: 0 0 8px;
    font-size: 14px; font-weight: 600;
    color: var(--del);
  }
  .confirm-modal p {
    margin: 0 0 16px;
    font-size: 12px; line-height: 1.5;
    color: var(--fg-muted);
  }
  .confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .confirm-actions .btn {
    padding: 6px 14px; border-radius: 4px; cursor: pointer;
    font-size: 12px; font-weight: 600;
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
