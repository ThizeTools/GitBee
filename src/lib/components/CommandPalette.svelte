<script lang="ts">
  // Ctrl+P: one fuzzy finder over actions, branches, repos, files, themes and
  // commits. A leading prefix character narrows it to one kind (see query.ts).
  // Spec: docs/specs/command-palette.md.
  import { paletteOpen, activeThemeId, customThemes, BUILTIN_THEMES } from "$lib/stores/ui";
  import {
    currentRepo, graph, recent, status, selectedSha, visibleGraphNodes, WIP_SHA,
  } from "$lib/stores/repo";
  import { layout } from "$lib/stores/layout";
  import { nextRedoLabel, nextUndoLabel } from "$lib/stores/history";
  import ShortcutsPanel from "$lib/components/ShortcutsPanel.svelte";
  import PaletteRow from "$lib/components/palette/PaletteRow.svelte";
  import { applyTypedInput, MODE_LABEL } from "$lib/palette/query";
  import { buildSources } from "$lib/palette/sources";
  import { searchPalette } from "$lib/palette/search";
  import { recentIds, rememberRecent } from "$lib/palette/recent";
  import { shortcutsOpen } from "$lib/palette/overlays";
  import { loadCommitFiles } from "$lib/palette/commitFiles";
  import type { PaletteItem, PaletteMode } from "$lib/palette/types";

  // PageUp and PageDown move a screenful of rows, not the whole list.
  const PAGE_STEP = 8;

  let mode = $state<PaletteMode>("all");
  let text = $state("");
  let activeIdx = $state(0);
  let committedPaths = $state<string[]>([]);
  let inputEl = $state<HTMLInputElement | undefined>(undefined);
  let listEl = $state<HTMLUListElement | undefined>(undefined);

  const sources = $derived(buildSources({
    repoOpen: $currentRepo !== null,
    refs: $graph?.refs ?? [],
    recentPaths: $recent.map((r) => r.path),
    changedPaths: $status.map((s) => s.path),
    committedPaths,
    commits: $visibleGraphNodes,
    themes: [...BUILTIN_THEMES, ...$customThemes],
    activeThemeId: $activeThemeId,
    layout: $layout,
    undoLabel: $nextUndoLabel,
    redoLabel: $nextRedoLabel,
  }));

  // Closed palette: no search at all. Store updates happen on every graph
  // refresh, and building ~2000 commit rows for a hidden list would waste that time.
  const results = $derived($paletteOpen ? searchPalette({ mode, text }, sources, $recentIds) : []);
  const placeholder = $derived(
    mode === "all"
      ? "Search actions, branches, files…  (> @ # / :)"
      : `Search ${MODE_LABEL[mode].toLowerCase()}…`,
  );

  // Each open starts from a clean finder, so the last query never lingers.
  $effect(() => {
    if (!$paletteOpen) return;
    mode = "all";
    text = "";
    activeIdx = 0;
    setTimeout(() => inputEl?.focus(), 0);
  });

  // Files of the selected commit join the "/" list. Loaded only while open, and
  // a stale load from an earlier selection is ignored.
  $effect(() => {
    const repo = $currentRepo;
    const sha = $selectedSha;
    if (!$paletteOpen || repo === null || sha === null || sha === WIP_SHA) {
      committedPaths = [];
      return;
    }
    let stale = false;
    loadCommitFiles(repo, sha).then((files) => { if (!stale) committedPaths = files; });
    return () => { stale = true; };
  });

  $effect(() => {
    if (activeIdx >= results.length) activeIdx = 0;
  });

  $effect(() => {
    listEl?.querySelector(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: "nearest" });
  });

  function close(): void {
    paletteOpen.set(false);
  }

  // Reads the box, not an event value, so a prefix character can be stripped
  // from the box itself when it switches the mode.
  function onInput(): void {
    const raw = inputEl?.value ?? "";
    const next = applyTypedInput(raw, mode);
    mode = next.mode;
    text = next.text;
    activeIdx = 0;
    if (inputEl && inputEl.value !== next.text) inputEl.value = next.text;
  }

  // The palette closes before the item runs, so a dialog the item opens is
  // never stacked on top of the finder.
  async function run(item: PaletteItem): Promise<void> {
    rememberRecent(item.id);
    close();
    await item.run();
  }

  function runActive(): void {
    const r = results[activeIdx];
    if (r) void run(r.item);
  }

  function moveBy(delta: number): void {
    if (results.length === 0) return;
    activeIdx = Math.min(results.length - 1, Math.max(0, activeIdx + delta));
  }

  // Backspace on an empty box drops the mode chip first, so one press undoes a prefix.
  function clearModeOnBackspace(e: KeyboardEvent): void {
    if (text !== "" || mode === "all") return;
    e.preventDefault();
    mode = "all";
  }

  function onKey(e: KeyboardEvent): void {
    if (e.isComposing) return;
    switch (e.key) {
      case "Escape": close(); return;
      case "ArrowDown": e.preventDefault(); moveBy(1); return;
      case "ArrowUp": e.preventDefault(); moveBy(-1); return;
      case "PageDown": e.preventDefault(); moveBy(PAGE_STEP); return;
      case "PageUp": e.preventDefault(); moveBy(-PAGE_STEP); return;
      case "Enter": e.preventDefault(); runActive(); return;
      case "Backspace": clearModeOnBackspace(e); return;
    }
  }
</script>

{#if $paletteOpen}
  <div
    class="backdrop"
    role="presentation"
    onclick={close}
    onkeydown={(e) => e.key === "Escape" && close()}
  >
    <div
      class="palette"
      role="dialog"
      tabindex="-1"
      aria-label="Command palette"
      onclick={(e) => e.stopPropagation()}
      onkeydown={onKey}
    >
      <div class="search">
        {#if mode !== "all"}
          <span class="chip" title="Backspace on an empty box clears the mode">{MODE_LABEL[mode]}</span>
        {/if}
        <input
          bind:this={inputEl}
          value={text}
          oninput={onInput}
          placeholder={placeholder}
          spellcheck="false"
          autocomplete="off"
          aria-label="Search"
        />
      </div>
      <ul bind:this={listEl}>
        {#each results as r, i (r.item.id)}
          <PaletteRow
            item={r.item}
            positions={r.positions}
            index={i}
            active={i === activeIdx}
            onRun={() => run(r.item)}
            onHover={() => (activeIdx = i)}
          />
        {:else}
          <li class="muted">no matches</li>
        {/each}
      </ul>
      <footer class="hints">&gt; actions &middot; @ branches &middot; # commits &middot; / files &middot; : themes</footer>
    </div>
  </div>
{/if}

<ShortcutsPanel open={$shortcutsOpen} onClose={() => shortcutsOpen.set(false)} />

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    z-index: 1000;
    padding-top: 80px;
  }
  .palette {
    width: 560px;
    max-width: 90vw;
    max-height: 60vh;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    padding-left: 14px;
  }
  input {
    flex: 1;
    min-width: 0;
    background: transparent;
    color: var(--fg);
    border: 0;
    padding: 12px 14px 12px 0;
    font-size: 14px;
  }
  input:focus { outline: none; }
  .chip {
    background: color-mix(in srgb, var(--accent) 25%, transparent);
    color: var(--accent);
    border-radius: 3px;
    padding: 2px 8px;
    font-size: 12px;
    white-space: nowrap;
  }
  ul { list-style: none; margin: 0; padding: 4px; overflow-y: auto; }
  li.muted { color: var(--fg-muted); padding: 12px; font-style: italic; }
  .hints {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--fg-muted);
    font-size: 11px;
    padding: 6px 12px;
    border-top: 1px solid var(--border);
  }
</style>
