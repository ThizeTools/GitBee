<script lang="ts">
  // Inline search bar that sits above the graph. Filters matches by
  // SHA prefix / subject / author across the loaded graph slice and
  // wires up next/prev navigation that scrolls the graph to each hit.
  // Matches older than the loaded slice come from the backend search and
  // are reached with "Show" (docs/specs/history-search.md).
  //
  // Bindings:
  //   Enter / F3      → next match
  //   Shift+Enter     → previous match
  //   Esc             → close (clears query and highlight)
  import {
    searchQuery, matchShas, currentMatchIdx, olderMatchShas,
    nextMatch, prevMatch, closeSearch,
  } from "$lib/stores/graphSearch";
  import {
    scheduleHistorySearch, cancelHistorySearch, revealOlderMatch,
    cancelOlderLoad, olderLoading,
  } from "$lib/stores/historySearch";
  import { graphScrollTarget } from "$lib/stores/graphscroll";
  import Icon from "$lib/icons/Icon.svelte";
  import { tick } from "svelte";

  let inputEl: HTMLInputElement | null = $state(null);

  // Focus the input on mount and select-all so reopening with text
  // already in the field lets the user just type to replace it.
  $effect(() => {
    void inputEl;
    tick().then(() => {
      inputEl?.focus();
      inputEl?.select();
    });
  });

  function jumpTo(sha: string | null) {
    if (sha) graphScrollTarget.set(sha);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      jumpTo(e.shiftKey ? prevMatch() : nextMatch());
      return;
    }
    if (e.key === "F3") {
      e.preventDefault();
      jumpTo(e.shiftKey ? prevMatch() : nextMatch());
      return;
    }
  }

  // Auto-jump to the first match as the user types — feels live, like
  // Chrome's find-in-page. Without this the user has to press Enter
  // even on a unique match. We don't reset currentMatchIdx here; the
  // store does that whenever the match set changes.
  let lastJumpedQuery = "";
  $effect(() => {
    const q = $searchQuery.trim();
    const shas = $matchShas;
    if (q && q !== lastJumpedQuery && shas.length > 0) {
      lastJumpedQuery = q;
      // Always jump to position 0 for fresh queries. Subsequent next/prev
      // calls update currentMatchIdx and the user navigates from there.
      currentMatchIdx.set(0);
      jumpTo(shas[0]);
    }
    if (!q) lastJumpedQuery = "";
  });

  // Each query change schedules one backend search after a pause. Its cleanup
  // drops the pending search and any older-history load, so a stale query never
  // reveals commits for a new one.
  $effect(() => {
    scheduleHistorySearch($searchQuery);
    return () => cancelHistorySearch();
  });
</script>

<div class="bar" role="search">
  <div class="field">
    <Icon name="search" size={14} />
    <input
      bind:this={inputEl}
      bind:value={$searchQuery}
      onkeydown={onKeyDown}
      placeholder="Search SHA, subject, author…"
      spellcheck="false"
      aria-label="Search commits"
    />
  </div>
  <span class="count" class:empty={$matchShas.length === 0 && $olderMatchShas.length === 0 && $searchQuery.trim().length > 0}>
    {#if $searchQuery.trim().length === 0}
      &nbsp;
    {:else if $matchShas.length === 0}
      {$olderMatchShas.length > 0 ? "none loaded" : "no matches"}
    {:else}
      {$currentMatchIdx + 1}/{$matchShas.length}
    {/if}
  </span>
  {#if $olderMatchShas.length > 0}
    <span class="older">
      {#if $olderLoading}
        loading older history…
        <button class="btn" onclick={cancelOlderLoad} title="Stop loading older history">Cancel</button>
      {:else}
        {$olderMatchShas.length} more {$olderMatchShas.length === 1 ? "match" : "matches"} in older history
        <button class="btn" onclick={() => void revealOlderMatch()} title="Load older history up to the next match">Show</button>
      {/if}
    </span>
  {/if}
  <button
    class="btn icon"
    onclick={() => jumpTo(prevMatch())}
    disabled={$matchShas.length === 0}
    title="Previous match (Shift+Enter)"
    aria-label="Previous match"
  >
    <Icon name="chevron-up" size={14} />
  </button>
  <button
    class="btn icon"
    onclick={() => jumpTo(nextMatch())}
    disabled={$matchShas.length === 0}
    title="Next match (Enter)"
    aria-label="Next match"
  >
    <Icon name="chevron-down" size={14} />
  </button>
  <button class="btn icon" onclick={closeSearch} title="Close (Esc)" aria-label="Close search">
    <Icon name="close" size={14} />
  </button>
</div>

<style>
  /* Bar and controls follow the Region 4 sizes: 30 px bar, 24 px controls
     (the hit-target minimum), --fs-sm / --fs-md text. */
  .bar {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: 0 var(--sp-4);
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border-strong);
    flex-shrink: 0;
    height: var(--h-section);
  }
  .field {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-width: 0;
    height: var(--h-row);
    padding: 0 var(--sp-4);
    background: var(--bg);
    color: var(--fg-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .field:focus-within { border-color: var(--accent); }
  input {
    flex: 1;
    min-width: 0;
    background: transparent;
    color: var(--fg);
    border: 0;
    outline: 0;
    padding: 0;
    font-size: var(--fs-md);
  }
  .count {
    font-size: var(--fs-sm);
    color: var(--fg-muted);
    min-width: 56px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .count.empty { color: #d35a5a; }
  .older {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    font-size: var(--fs-sm);
    color: var(--fg-muted);
    white-space: nowrap;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--fg-muted);
    height: var(--h-row);
    padding: 0 var(--sp-4);
    cursor: pointer;
    font-size: var(--fs-md);
    line-height: 1;
  }
  .btn.icon { width: var(--h-row); padding: 0; }
  .btn:hover:not(:disabled) { color: var(--fg); border-color: var(--fg-muted); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
