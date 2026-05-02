<script lang="ts">
  import { rightSelection, clearSelection } from "$lib/stores/rightpanel";
  import { selectedSha } from "$lib/stores/repo";
  import { setSize } from "$lib/stores/layout";
  import StagingArea from "./StagingArea.svelte";
  import CommitDetailsPanel from "./CommitDetailsPanel.svelte";
  import StashDetailsPanel from "./StashDetailsPanel.svelte";

  // Closing the right panel from any of its child views means: hide the
  // panel entirely and drop the graph selection. We do NOT fall back to
  // the WIP/staging view — that would just swap content instead of
  // honoring the user's "close" intent.
  function closePanel() {
    selectedSha.set(null);
    clearSelection();
    setSize("rightPanelCollapsed", true);
  }
</script>

<aside class="right-panel">
  {#if $rightSelection.kind === "commit"}
    <CommitDetailsPanel sha={$rightSelection.sha} onClose={closePanel} />
  {:else if $rightSelection.kind === "stash"}
    <StashDetailsPanel index={$rightSelection.index} onClose={closePanel} />
  {:else if $rightSelection.kind === "changes"}
    <StagingArea onClose={closePanel} />
  {/if}
</aside>

<style>
  .right-panel {
    width: 100%;
    height: 100%;
    background: var(--rightpanel-bg);
    border-left: 1px solid var(--border-strong);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    overflow: hidden;
  }
</style>
