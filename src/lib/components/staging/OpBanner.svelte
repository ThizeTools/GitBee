<script lang="ts">
  import { currentRepo, opState, status, withBusy } from "$lib/stores/repo";
  import { ipc } from "$lib/ipc";
  import { confirmDialog } from "$lib/stores/dialog";
  import { activeOp, type ConflictOp } from "$lib/conflict/labels";

  // Shown while a merge, rebase, cherry-pick or revert is in progress.
  const LABELS: Record<ConflictOp, string> = {
    merge: "Merging",
    rebase: "Rebasing",
    "cherry-pick": "Cherry-picking",
    revert: "Reverting",
  };

  const op = $derived(activeOp($opState));
  const remaining = $derived($status.filter((s) => s.conflicted).length);
  // WHY: git refuses to continue with unmerged paths, and the user only learns
  // that from an error toast. Disabling Continue with a reason avoids the trip.
  const continueTip = $derived(
    remaining > 0
      ? `Resolve the ${remaining} conflicted ${remaining === 1 ? "file" : "files"} first`
      : `Continue the ${op ?? ""}`,
  );

  async function abortOp(kind: ConflictOp) {
    if (!$currentRepo) return;
    const ok = await confirmDialog({ title: `Abort ${kind}?`, confirmLabel: "Abort", danger: true });
    if (!ok) return;
    await withBusy(() => ipc.opAbort($currentRepo!, kind));
  }
  async function continueOp(kind: ConflictOp) {
    if (!$currentRepo || remaining > 0) return;
    await withBusy(() => ipc.opContinue($currentRepo!, kind));
  }
</script>

{#if op !== null}
  <div class="op-banner">
    <span>⚠ {LABELS[op]}</span>
    {#if remaining > 0}
      <span class="left">{remaining} conflicted {remaining === 1 ? "file" : "files"} left</span>
    {/if}
    <span class="cont" title={continueTip}>
      <button disabled={remaining > 0} onclick={() => continueOp(op)}>Continue</button>
    </span>
    <button class="danger" onclick={() => abortOp(op)}>Abort</button>
  </div>
{/if}

<style>
  .op-banner {
    background: color-mix(in srgb, var(--modified) 18%, transparent); color: var(--modified); padding: 10px 14px;
    border-bottom: 1px solid var(--border-strong);
    display: flex; gap: 8px; align-items: center; font-size: 12px; flex-shrink: 0;
  }
  .left { color: var(--del); font-weight: 600; margin-right: auto; }
  .cont { display: inline-flex; }
  .op-banner button {
    background: var(--bg); color: var(--fg); border: 1px solid var(--border);
    padding: 3px 10px; border-radius: 3px; cursor: pointer; font-size: 11px;
  }
  .op-banner button:disabled { opacity: 0.5; cursor: not-allowed; }
  .op-banner button.danger:hover { background: color-mix(in srgb, var(--del) 22%, transparent); border-color: var(--del); }
</style>
