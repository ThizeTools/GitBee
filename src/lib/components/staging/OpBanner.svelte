<script lang="ts">
  import { currentRepo, opState, status, withBusy } from "$lib/stores/repo";
  import { ipc } from "$lib/ipc";
  import { confirmDialog } from "$lib/stores/dialog";
  import Icon from "$lib/icons/Icon.svelte";
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
    <span class="kind"><Icon name="warning" size={14} />{LABELS[op]}</span>
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
    background: color-mix(in srgb, var(--modified) 18%, transparent); color: var(--modified);
    padding: var(--sp-5) var(--sp-6);
    border-bottom: 1px solid var(--border-strong);
    display: flex; gap: var(--sp-4); align-items: center;
    font-size: var(--fs-md); flex-shrink: 0;
  }
  .kind { display: inline-flex; align-items: center; gap: var(--sp-3); }
  .left { color: var(--del); font-weight: 600; margin-right: auto; }
  .cont { display: inline-flex; }
  .op-banner button {
    height: var(--h-row);
    background: var(--bg); color: var(--fg); border: 1px solid var(--border);
    padding: 0 var(--sp-5); border-radius: var(--radius); cursor: pointer;
    font-size: var(--fs-sm);
  }
  .op-banner button:disabled { opacity: 0.5; cursor: not-allowed; }
  .op-banner button.danger:hover { background: color-mix(in srgb, var(--del) 22%, transparent); border-color: var(--del); }
</style>
