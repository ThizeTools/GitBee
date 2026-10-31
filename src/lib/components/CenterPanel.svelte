<script lang="ts">
  import { centerMode } from "$lib/stores/center";
  import { activeTabId } from "$lib/stores/repo";
  import GraphCanvas from "./GraphCanvas.svelte";
  import DiffPanel from "./DiffPanel.svelte";
  import ConflictEditor from "./conflict/ConflictEditor.svelte";
  import FileHistory from "./history/FileHistory.svelte";
  import FileBlame from "./history/FileBlame.svelte";
  import PullRequestsView from "./pr/PullRequestsView.svelte";
</script>

<section class="center">
  {#if $centerMode.kind === "file"}
    <DiffPanel file={$centerMode.file} staged={$centerMode.staged} />
  {:else if $centerMode.kind === "commit-file"}
    <DiffPanel file={$centerMode.file} commitSha={$centerMode.sha} />
  {:else if $centerMode.kind === "conflict"}
    <ConflictEditor file={$centerMode.file} />
  {:else if $centerMode.kind === "history"}
    <FileHistory file={$centerMode.file} />
  {:else if $centerMode.kind === "blame"}
    <FileBlame file={$centerMode.file} rev={$centerMode.rev} />
  {:else if $centerMode.kind === "pulls"}
    <PullRequestsView />
  {:else}
    <!-- One instance per tab: a mounted canvas kept per-repo view state across
         repo switches and drew the new repo wrong until remounted (spec
         graph-loading.md, "Repo switch and stale scroll"). -->
    {#key $activeTabId}
      <GraphCanvas />
    {/key}
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
