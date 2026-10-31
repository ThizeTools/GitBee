<script lang="ts">
  import { centerMode } from "$lib/stores/center";
  import GraphCanvas from "./GraphCanvas.svelte";
  import DiffPanel from "./DiffPanel.svelte";
  import ConflictEditor from "./conflict/ConflictEditor.svelte";
</script>

<section class="center">
  {#if $centerMode.kind === "file"}
    <DiffPanel file={$centerMode.file} staged={$centerMode.staged} />
  {:else if $centerMode.kind === "commit-file"}
    <DiffPanel file={$centerMode.file} commitSha={$centerMode.sha} />
  {:else if $centerMode.kind === "conflict"}
    <ConflictEditor file={$centerMode.file} />
  {:else}
    <GraphCanvas />
  {/if}
</section>

<style>
  .center {
    flex: 1;
    overflow: hidden;
    background: var(--bg);
    border-left: 1px solid var(--border-strong);
    border-right: 1px solid var(--border-strong);
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
</style>
