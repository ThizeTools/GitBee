<script lang="ts">
  // Banner shown at the top of the graph whenever the user has any
  // ref(s) in solo mode. Mirrors GitKraken's "Soloing N/Total Stop
  // Soloing" pill — gives a permanent reminder that the graph is
  // filtered, plus a one-click escape hatch.
  import { soloRefs, clearSolo, removeSolo } from "$lib/stores/graphFilter";
  import { graph } from "$lib/stores/repo";

  // Total ref count for the "N / Total" badge. Counts every commit
  // in the loaded slice (matches the user's screenshot: "1/148").
  const total = $derived($graph?.nodes.length ?? 0);
  const count = $derived($soloRefs.size);
  const list = $derived([...$soloRefs]);
</script>

{#if count > 0}
  <div class="banner" role="status">
    <span class="lead">
      Soloing
      <span class="count">{count}</span>
      <span class="of">/{total}</span>
    </span>
    <span class="chips">
      {#each list as name (name)}
        <button
          class="chip"
          title="Click to remove from solo"
          onclick={() => removeSolo(name)}
        >
          <span class="x">×</span>
          <span class="lbl">{name}</span>
        </button>
      {/each}
    </span>
    <button class="stop" onclick={clearSolo} title="Show all branches">
      Stop Soloing
    </button>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
    font-size: 11px;
    color: var(--fg);
    flex-shrink: 0;
    min-height: 28px;
  }
  .lead {
    color: var(--fg);
    font-weight: 600;
  }
  .count {
    color: var(--accent);
    font-weight: 700;
    margin: 0 2px;
  }
  .of { color: var(--fg-muted); font-weight: 500; }
  .chips {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    flex: 1;
    min-width: 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    color: var(--fg);
    border-radius: 12px;
    padding: 1px 8px;
    font-size: 10px;
    cursor: pointer;
    line-height: 16px;
  }
  .chip:hover {
    border-color: var(--del);
    color: var(--del);
  }
  .chip .x { color: var(--fg-muted); font-size: 13px; line-height: 1; }
  .chip:hover .x { color: var(--del); }
  .chip .lbl { font-family: "Cascadia Code", Consolas, monospace; }
  .stop {
    background: transparent;
    border: 1px solid var(--accent);
    color: var(--accent);
    border-radius: 4px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }
  .stop:hover {
    background: var(--accent);
    color: var(--bg);
  }
</style>
