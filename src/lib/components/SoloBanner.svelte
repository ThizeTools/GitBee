<script lang="ts">
  // Banner shown at the top of the graph whenever the user has any
  // ref(s) in solo mode. Mirrors GitKraken's "Soloing N/Total Stop
  // Soloing" pill — gives a permanent reminder that the graph is
  // filtered, plus a one-click escape hatch.
  import { soloRefs, clearSolo, removeSolo } from "$lib/stores/graphFilter";
  import { graph } from "$lib/stores/repo";
  import Icon from "$lib/icons/Icon.svelte";

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
          <span class="x"><Icon name="close" size={14} /></span>
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
  /* Sizes from the Region 4 spec: type on --fs-sm/--fs-xs, 24 px controls
     (the hit-target minimum), 18 px chips (the ref-pill height). */
  .banner {
    display: flex;
    align-items: center;
    gap: var(--sp-6);
    padding: var(--sp-1) var(--sp-6);
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
    font-size: var(--fs-sm);
    color: var(--fg);
    flex-shrink: 0;
  }
  .lead {
    color: var(--fg);
    font-weight: 600;
  }
  .count {
    color: var(--accent);
    font-weight: 700;
    margin: 0 var(--sp-1);
  }
  .of { color: var(--fg-muted); font-weight: 500; }
  .chips {
    display: flex;
    gap: var(--sp-2);
    flex-wrap: wrap;
    flex: 1;
    min-width: 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    height: var(--h-pill, 18px);
    background: var(--bg-elev);
    border: 1px solid var(--border);
    color: var(--fg);
    border-radius: var(--radius);
    padding: 0 var(--sp-4);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .chip:hover {
    border-color: var(--del);
    color: var(--del);
  }
  .chip .x { display: inline-flex; color: var(--fg-muted); }
  .chip:hover .x { color: var(--del); }
  .chip .lbl { font-family: "Cascadia Code", Consolas, monospace; }
  .stop {
    height: var(--h-row);
    background: transparent;
    border: 1px solid var(--accent);
    color: var(--accent);
    border-radius: var(--radius);
    padding: 0 var(--sp-5);
    font-size: var(--fs-sm);
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }
  .stop:hover {
    background: var(--accent);
    color: var(--bg);
  }
</style>
