<script lang="ts">
  // Bottom dock for embedded terminals: a tab strip plus one TerminalSurface per
  // session. Every session's surface stays mounted (see TerminalSurface). Only
  // the active tab of the open repo is shown. The dock belongs to a repo tab, so
  // it stays hidden on the new-tab and info pages.
  import { onMount } from "svelte";
  import { currentRepo } from "$lib/stores/repo";
  import { layout, setSize } from "$lib/stores/layout";
  import { showingInfo } from "$lib/stores/info";
  import { showingNewTab } from "$lib/stores/newtab";
  import {
    terminalSessions, repoSessions, shownSessionId, ensureTerminalListeners,
    openSession, closeSession, selectTerminal,
  } from "$lib/stores/terminal";
  import ResizeHandle from "./ResizeHandle.svelte";
  import TerminalSurface from "./TerminalSurface.svelte";

  const dockShown = $derived(
    $layout.terminalOpen && $currentRepo !== null && !$showingInfo && !$showingNewTab,
  );

  onMount(() => {
    void ensureTerminalListeners();
  });

  // Opening the dock on a repo with no shell starts one. The effect reads only a
  // boolean, so unrelated session updates (another repo's shell exiting) do not
  // re-run it. A failed start is not retried until the dock is opened again.
  const repoHasNoShell = $derived($repoSessions.length === 0);
  $effect(() => {
    const repo = $currentRepo;
    if (dockShown && repo && repoHasNoShell) void openSession(repo);
  });

  function newTerminal(): void {
    const repo = $currentRepo;
    if (repo) void openSession(repo);
  }

  function select(id: number): void {
    const repo = $currentRepo;
    if (repo) selectTerminal(repo, id);
  }

  /** Closes a tab. Closing the repo's last tab also hides the dock. */
  async function closeTab(id: number): Promise<void> {
    await closeSession(id);
    if ($repoSessions.length === 0) setSize("terminalOpen", false);
  }

  function hide(): void {
    setSize("terminalOpen", false);
  }
</script>

<div class="dock" class:closed={!dockShown} style:height="{$layout.terminalHeight}px">
  <ResizeHandle
    direction="h"
    invert
    value={$layout.terminalHeight}
    min={120}
    max={600}
    onChange={(v) => setSize("terminalHeight", v)}
  />
  <header class="head">
    <span class="title">▶_ Terminal</span>
    <div class="tabs" role="tablist">
      {#each $repoSessions as s (s.id)}
        <div class="tab" class:active={s.id === $shownSessionId} class:exited={s.exited}>
          <button
            class="tab-label"
            role="tab"
            aria-selected={s.id === $shownSessionId}
            onclick={() => select(s.id)}
          >{s.title}{s.exited ? " (exited)" : ""}</button>
          <button class="tab-close" title="Close terminal" onclick={() => closeTab(s.id)}>×</button>
        </div>
      {/each}
      <button class="ghost" title="New terminal" onclick={newTerminal}>+</button>
    </div>
    <button class="ghost" title="Hide terminal (Ctrl+`)" onclick={hide}>⌄</button>
  </header>
  <div class="surfaces">
    {#each $terminalSessions.list as s (s.id)}
      <TerminalSurface
        id={s.id}
        shown={dockShown && s.repo === $currentRepo && s.id === $shownSessionId}
      />
    {/each}
  </div>
</div>

<style>
  .dock {
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border-top: 1px solid var(--border-strong);
    flex-shrink: 0;
    min-height: 0;
    overflow: hidden;
  }
  .dock.closed { display: none; }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 2px 8px;
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    font-size: 11px;
  }
  .title { font-weight: 600; flex-shrink: 0; }
  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
  }
  .tab {
    display: flex;
    align-items: center;
    border-radius: 3px;
    color: var(--fg-muted);
    white-space: nowrap;
  }
  .tab.active { background: var(--border); color: var(--fg); }
  .tab.exited .tab-label { font-style: italic; }
  .tab-label {
    background: transparent; border: 0; color: inherit; cursor: pointer;
    font: inherit; padding: 2px 6px;
  }
  .tab-close {
    background: transparent; border: 0; color: var(--fg-muted); cursor: pointer;
    font-size: 12px; padding: 0 4px; border-radius: 3px;
  }
  .tab-close:hover { color: var(--fg); }
  .ghost {
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer; padding: 2px 8px; font-size: 13px; border-radius: 3px;
  }
  .ghost:hover { color: var(--fg); background: var(--border); }
  .surfaces {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
