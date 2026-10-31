<script lang="ts">
  import { currentRepo, opState, withBusy } from "$lib/stores/repo";
  import { ipc } from "$lib/ipc";

  // Shown while a merge, rebase, cherry-pick or revert is in progress.
  type OpKind = "merge" | "rebase" | "cherry-pick" | "revert";

  async function abortOp(kind: OpKind) {
    if (!$currentRepo || !confirm(`Abort ${kind}?`)) return;
    await withBusy(() => ipc.opAbort($currentRepo!, kind));
  }
  async function continueOp(kind: OpKind) {
    if (!$currentRepo) return;
    await withBusy(() => ipc.opContinue($currentRepo!, kind));
  }
</script>

{#if $opState && ($opState.merging || $opState.rebasing || $opState.cherry_picking || $opState.reverting)}
  <div class="op-banner">
    {#if $opState.merging}<span>⚠ Merging</span>
      <button onclick={() => continueOp("merge")}>Continue</button>
      <button class="danger" onclick={() => abortOp("merge")}>Abort</button>
    {:else if $opState.rebasing}<span>⚠ Rebasing</span>
      <button onclick={() => continueOp("rebase")}>Continue</button>
      <button class="danger" onclick={() => abortOp("rebase")}>Abort</button>
    {:else if $opState.cherry_picking}<span>⚠ Cherry-picking</span>
      <button onclick={() => continueOp("cherry-pick")}>Continue</button>
      <button class="danger" onclick={() => abortOp("cherry-pick")}>Abort</button>
    {:else if $opState.reverting}<span>⚠ Reverting</span>
      <button onclick={() => continueOp("revert")}>Continue</button>
      <button class="danger" onclick={() => abortOp("revert")}>Abort</button>
    {/if}
  </div>
{/if}

<style>
  .op-banner {
    background: color-mix(in srgb, var(--modified) 18%, transparent); color: var(--modified); padding: 10px 14px;
    border-bottom: 1px solid var(--border-strong);
    display: flex; gap: 8px; align-items: center; font-size: 12px; flex-shrink: 0;
  }
  .op-banner button {
    background: var(--bg); color: var(--fg); border: 1px solid var(--border);
    padding: 3px 10px; border-radius: 3px; cursor: pointer; font-size: 11px;
  }
  .op-banner button.danger:hover { background: color-mix(in srgb, var(--del) 22%, transparent); border-color: var(--del); }
</style>
