<script lang="ts">
  // The changes cell: "+12 −3" over a bar split green and red. A null stat is an
  // empty cell (WIP and stash rows). An undefined stat is still loading and shows
  // a faint placeholder. The formatting is pure, in $lib/graph/changes.
  import type { CommitStat } from "$lib/ipc";
  import { changesBar, changesLabel, changesTitle } from "$lib/graph/changes";

  interface Props {
    stat: CommitStat | null | undefined;
  }
  let { stat }: Props = $props();
</script>

<div class="cell-changes" title={stat ? changesTitle(stat) : ""}>
  {#if stat}
    {@const bar = changesBar(stat)}
    <span class="cell-text">{changesLabel(stat)}</span>
    <span class="track">
      <span class="bar" style:width="{bar.widthPct}%">
        <span class="add" style:width="{bar.addPct}%"></span>
        <span class="del"></span>
      </span>
    </span>
  {:else if stat === undefined}
    <span class="placeholder"></span>
  {/if}
</div>

<style>
  /* The bar thickness (3px) is a graphic, not a layout token. */
  .cell-changes {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--sp-2);
    padding: 0 var(--sp-5);
    height: 100%;
    min-width: 0;
    overflow: hidden;
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  .cell-text {
    display: block; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; min-width: 0;
    font-family: "Cascadia Code", Consolas, monospace;
  }
  .track {
    display: block; width: 100%; height: 3px; border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--border) 60%, transparent);
    overflow: hidden;
  }
  .bar { display: flex; height: 100%; }
  .add { display: block; height: 100%; background: var(--add, var(--accent)); }
  .del { display: block; flex: 1; height: 100%; background: var(--del); }
  .placeholder {
    display: block; width: 45%; height: 3px; border-radius: var(--radius-sm);
    background: var(--border); opacity: 0.5;
  }
</style>
