<script lang="ts">
  // Inline search bar that sits above the graph. Filters matches by
  // SHA prefix / subject / author across the loaded graph slice and
  // wires up next/prev navigation that scrolls the graph to each hit.
  //
  // Bindings:
  //   Enter / F3      → next match
  //   Shift+Enter     → previous match
  //   Esc             → close (clears query and highlight)
  import {
    searchQuery, matchShas, currentMatchIdx,
    nextMatch, prevMatch, closeSearch,
  } from "$lib/stores/graphSearch";
  import { graphScrollTarget } from "$lib/stores/graphscroll";
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
</script>

<div class="bar" role="search">
  <input
    bind:this={inputEl}
    bind:value={$searchQuery}
    onkeydown={onKeyDown}
    placeholder="Search SHA, subject, author…"
    spellcheck="false"
    aria-label="Search commits"
  />
  <span class="count" class:empty={$matchShas.length === 0 && $searchQuery.trim().length > 0}>
    {#if $searchQuery.trim().length === 0}
      &nbsp;
    {:else if $matchShas.length === 0}
      no matches
    {:else}
      {$currentMatchIdx + 1}/{$matchShas.length}
    {/if}
  </span>
  <button
    class="btn"
    onclick={() => jumpTo(prevMatch())}
    disabled={$matchShas.length === 0}
    title="Previous match (Shift+Enter)"
  >↑</button>
  <button
    class="btn"
    onclick={() => jumpTo(nextMatch())}
    disabled={$matchShas.length === 0}
    title="Next match (Enter)"
  >↓</button>
  <button class="btn close" onclick={closeSearch} title="Close (Esc)">×</button>
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border-strong);
    flex-shrink: 0;
    height: 28px;
  }
  input {
    flex: 1;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 4px 8px;
    font-size: 12px;
    outline: 0;
    min-width: 0;
  }
  input:focus { border-color: var(--accent); }
  .count {
    font-size: 11px;
    color: var(--fg-muted);
    min-width: 56px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .count.empty { color: #d35a5a; }
  .btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--fg-muted);
    padding: 0 8px;
    height: 22px;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
  }
  .btn:hover:not(:disabled) { color: var(--fg); border-color: var(--fg-muted); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn.close { font-size: 16px; padding: 0 6px; }
</style>
