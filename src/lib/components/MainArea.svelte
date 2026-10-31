<script lang="ts">
  // The window body between the tab/top bars and the status bar: sidebar,
  // centre and right panels, with the terminal dock below them. Extracted from
  // +page.svelte to keep that route file under the size limit.
  import { showingInfo } from "$lib/stores/info";
  import { showingNewTab } from "$lib/stores/newtab";
  import { currentRepo, busyVisible } from "$lib/stores/repo";
  import { layout, setSize } from "$lib/stores/layout";
  import InfoPage from "$lib/components/InfoPage.svelte";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import CenterPanel from "$lib/components/CenterPanel.svelte";
  import RightPanel from "$lib/components/RightPanel.svelte";
  import NewTabPage from "$lib/components/NewTabPage.svelte";
  import ResizeHandle from "$lib/components/ResizeHandle.svelte";
  import TerminalPanel from "$lib/components/TerminalPanel.svelte";
  import Icon from "$lib/icons/Icon.svelte";
</script>

<div class="body-col">
  <main class="row">
    {#if $showingInfo}
      <InfoPage />
    {:else if $showingNewTab || !$currentRepo}
      <NewTabPage />
    {:else}
      {#if $layout.sidebarCollapsed}
        <button class="rail" type="button" title="Expand sidebar" aria-label="Expand sidebar"
          onclick={() => setSize("sidebarCollapsed", false)}><Icon name="chevron-right" size={14} /></button>
      {:else}
        <aside class="left-pane" style:width="{$layout.sidebarWidth}px">
          <Sidebar />
          {#if $busyVisible}
            <!-- Lock the sidebar during git operations so the user can't
                 stack actions while one is running. The overlay catches
                 pointer events and shows a centered spinner.
                 Shown only after a 250 ms delay (busyVisible), so background
                 refreshes and fast operations never cover the sidebar. -->
            <div class="busy-veil" aria-hidden="true">
              <div class="spinner"></div>
              <div class="lbl">Working…</div>
            </div>
          {/if}
        </aside>
        <ResizeHandle direction="v" value={$layout.sidebarWidth} min={180} max={500}
          onChange={(v) => setSize("sidebarWidth", v)} />
      {/if}
      <div class="center-wrap">
        <CenterPanel />
      </div>
      {#if !$layout.rightPanelCollapsed}
        <ResizeHandle direction="v" invert value={$layout.rightPanelWidth} min={280} max={720}
          onChange={(v) => setSize("rightPanelWidth", v)} />
        <aside class="right-pane" style:width="{$layout.rightPanelWidth}px">
          <RightPanel />
        </aside>
      {/if}
    {/if}
  </main>
  <TerminalPanel />
</div>

<style>
  .body-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
  .row {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 0;
  }
  .left-pane {
    flex-shrink: 0;
    overflow: hidden;
    display: flex;
    position: relative; /* anchor for .busy-veil */
  }
  .busy-veil {
    position: absolute; inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(1px);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: var(--sp-6);
    z-index: 50;
    color: var(--fg);
    cursor: progress;
  }
  .busy-veil .lbl {
    font-size: var(--fs-sm); font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.6px;
    color: var(--fg-muted);
  }
  .spinner {
    width: 28px; height: 28px;
    border: 3px solid rgba(255, 255, 255, 0.12);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .rail {
    width: var(--h-row);
    flex-shrink: 0;
    background: var(--bg-elev);
    border: 0;
    border-right: 1px solid var(--border-strong);
    color: var(--fg-muted);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .rail:hover { background: var(--border); color: var(--fg); }
  .center-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }
  .right-pane {
    flex-shrink: 0;
    overflow: hidden;
    display: flex;
  }
</style>
