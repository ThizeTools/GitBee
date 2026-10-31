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
  import Icon from "$lib/icons/Icon.svelte";

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
  <!-- Dock header: one 30 px row, the tabs and icon-button actions. -->
  <header class="head">
    <span class="title"><Icon name="terminal" size={14} />Terminal</span>
    <div class="tabs" role="tablist">
      {#each $repoSessions as s (s.id)}
        <div class="tab" class:active={s.id === $shownSessionId} class:exited={s.exited}>
          <button
            class="tab-label"
            role="tab"
            aria-selected={s.id === $shownSessionId}
            onclick={() => select(s.id)}
          >{s.title}{s.exited ? " (exited)" : ""}</button>
          <button class="tab-close" type="button" title="Close terminal" aria-label="Close terminal"
            onclick={() => closeTab(s.id)}><Icon name="close" size={12} /></button>
        </div>
      {/each}
      <button class="icon-btn" type="button" title="New terminal" aria-label="New terminal" onclick={newTerminal}>
        <Icon name="add" size={14} />
      </button>
    </div>
    <button class="icon-btn" type="button" title="Hide terminal (Ctrl+`)" aria-label="Hide terminal" onclick={hide}>
      <Icon name="chevron-down" size={14} />
    </button>
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
    gap: var(--sp-5);
    height: var(--h-section);
    padding: 0 var(--sp-4);
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    font-size: var(--fs-sm);
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-3);
    font-size: var(--fs-md);
    font-weight: 600;
    flex-shrink: 0;
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    flex: 1;
    min-width: 0;
    overflow-x: auto;
  }
  /* Tabs and every icon button are 24 px high, the toolbar hit size. */
  .tab {
    display: flex;
    align-items: center;
    height: var(--h-row);
    border-radius: var(--radius);
    color: var(--fg-muted);
    white-space: nowrap;
  }
  .tab.active { background: var(--border); color: var(--fg); }
  .tab.exited .tab-label { font-style: italic; }
  .tab-label {
    height: 100%;
    background: transparent; border: 0; color: inherit; cursor: pointer;
    font: inherit; padding: 0 var(--sp-4);
  }
  .tab-close,
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--h-row);
    height: var(--h-row);
    padding: 0;
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer; border-radius: var(--radius);
  }
  .tab-close:hover,
  .icon-btn:hover { color: var(--fg); background: var(--border); }
  .icon-btn { flex-shrink: 0; }
  .surfaces {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
