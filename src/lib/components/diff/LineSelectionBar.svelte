<script lang="ts">
  import type { PatchAction } from "$lib/diff/patchAction";

  interface Props {
    count: number;
    /** True in the staged view, where the only action is unstage. */
    staged: boolean;
    onAction: (action: PatchAction) => void;
    onClear: () => void;
  }
  let { count, staged, onAction, onClear }: Props = $props();
  const noun = $derived(count === 1 ? "line" : "lines");
</script>

<div class="dv-pick-bar" role="toolbar" aria-label="Selected lines">
  <span class="dv-pick-count">{count} {noun} selected</span>
  {#if staged}
    <button type="button" class="dv-hunk-btn" onclick={() => onAction("unstage")}>Unstage {count} {noun}</button>
  {:else}
    <button type="button" class="dv-hunk-btn" onclick={() => onAction("stage")}>Stage {count} {noun}</button>
    <button type="button" class="dv-hunk-btn dv-hunk-danger" onclick={() => onAction("discard")}>Discard {count} {noun}</button>
  {/if}
  <button type="button" class="dv-hunk-btn dv-ghost" onclick={onClear}>Clear</button>
</div>
