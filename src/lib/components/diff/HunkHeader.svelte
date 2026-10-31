<script lang="ts">
  import type { HunkView } from "./hunkView";

  interface Props { header: string; view: HunkView; }
  let { header, view }: Props = $props();
</script>

<div class="dv-hunk-header">
  <span class="dv-hunk-text">{header}</span>
  {#if view.actionsOn && view.mode === "unstaged"}
    <button type="button" class="dv-hunk-btn" onclick={() => view.onHunkAction("stage")}>Stage hunk</button>
    <button type="button" class="dv-hunk-btn dv-hunk-danger" onclick={() => view.onHunkAction("discard")}>Discard hunk</button>
  {:else if view.actionsOn && view.mode === "staged"}
    <button type="button" class="dv-hunk-btn" onclick={() => view.onHunkAction("unstage")}>Unstage hunk</button>
  {/if}
</div>
