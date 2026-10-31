<script lang="ts">
  // Diffs the user asked for, shown under the file list. The panel loads each
  // one when its file is expanded. The shared DiffViewer draws them, so a
  // file reads the same here as in the center diff panel.
  import DiffViewer from "../DiffViewer.svelte";
  import { commitRevs } from "$lib/diff/revs";
  import type { FileDiff } from "$lib/ipc";

  interface Props {
    sha: string;
    /** Loaded diffs of the requested files, in list order. */
    diffs: FileDiff[];
    loading: boolean;
  }
  let { sha, diffs, loading }: Props = $props();
</script>

<div class="inline-diffs">
  <DiffViewer {diffs} revs={commitRevs(sha)} {loading} />
</div>

<style>
  .inline-diffs { border-top: 1px solid var(--border); }
</style>
