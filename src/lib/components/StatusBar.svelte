<script lang="ts">
  import { layout, setZoom, ZOOM_STEPS, displayPercent } from "$lib/stores/layout";
  import { logsPanelOpen } from "$lib/stores/logs";
  import { currentRepo } from "$lib/stores/repo";
  import { showingInfo } from "$lib/stores/info";
  import { ipc } from "$lib/ipc";
  import { logAppend } from "$lib/stores/logs";
  import { appVersion } from "$lib/version";
  import { updateState, installNow } from "$lib/stores/updater";
  import ShortcutsPanel from "./ShortcutsPanel.svelte";

  let zoomMenu = $state(false);
  let shortcutsOpen = $state(false);

  async function openTerm() {
    if (!$currentRepo) return;
    try { await ipc.openTerminal($currentRepo); }
    catch (e) { logAppend("error", `terminal: ${e}`); }
  }
  function pickZoom(z: number) { setZoom(z); zoomMenu = false; }
</script>

<footer class="status">
  <div class="left">
    <button class="bi" onclick={openTerm} disabled={!$currentRepo} title="Open external terminal (Ctrl+`)">
      <span class="ico">▶_</span>
    </button>
  </div>
  <div class="right">
    <button class="bi" onclick={() => logsPanelOpen.update((v) => !v)} title="Logs (Ctrl+L)">
      <span class="ico">≡</span><span>Logs</span>
    </button>
    <button class="bi" onclick={() => shortcutsOpen = true} title="Keyboard shortcuts">
      <span class="ico">⌨</span><span>Shortcuts</span>
    </button>
    <button class="bi" onclick={() => showingInfo.update((v) => !v)} title="Features / about">
      <span class="ico">ⓘ</span><span>Info</span>
    </button>
    {#if $updateState.kind === "downloading"}
      <span class="upd downloading" title="Downloading update v{$updateState.version}">
        <span class="upd-spin"></span>
        <span>Downloading update… {$updateState.progress}%</span>
      </span>
    {:else if $updateState.kind === "ready"}
      <button class="bi upd ready" onclick={installNow}
        title={$updateState.notes ?? `v${$updateState.version} ready to install`}>
        <span class="ico">⤓</span>
        <span>Update v{$updateState.version} — click to install</span>
      </button>
    {:else if $updateState.kind === "error"}
      <span class="upd err" title={$updateState.message}>
        <span class="ico">⚠</span><span>Update check failed</span>
      </span>
    {/if}
    <div class="zoom">
      <button class="bi" onclick={() => zoomMenu = !zoomMenu} title="UI zoom">
        <span class="ico">⊕</span>
        <span>{displayPercent($layout.uiScale)}%</span>
      </button>
      {#if zoomMenu}
        <div class="zoom-menu">
          {#each [...ZOOM_STEPS].reverse() as z (z)}
            <button
              class:active={Math.abs(z - $layout.uiScale) < 0.01}
              onclick={() => pickZoom(z)}
            >{displayPercent(z)}%</button>
          {/each}
        </div>
      {/if}
    </div>
    <span class="version">v{appVersion}</span>
  </div>
</footer>

<ShortcutsPanel open={shortcutsOpen} onClose={() => shortcutsOpen = false} />

<style>
  .status {
    display: flex;
    align-items: center;
    height: 22px;
    background: var(--bg-elev);
    border-top: 1px solid var(--border-strong);
    font-size: 10px;
    flex-shrink: 0;
    z-index: 50;
  }
  .left { display: flex; padding-left: 4px; }
  .right { margin-left: auto; display: flex; align-items: center; gap: 2px; padding-right: 8px; }
  .bi {
    background: transparent;
    border: 0;
    color: var(--fg-muted);
    cursor: pointer;
    padding: 0 8px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    border-radius: 0;
  }
  .bi:hover { color: var(--fg); background: rgba(255,255,255,0.05); }
  .bi .ico { font-size: 13px; }
  .version {
    color: var(--fg-muted);
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 10px;
    padding: 0 8px 0 12px;
    border-left: 1px solid var(--border);
    margin-left: 4px;
  }
  .zoom { position: relative; }
  .zoom-menu {
    position: absolute;
    bottom: 100%;
    right: 0;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.5);
    padding: 4px;
    margin-bottom: 4px;
    display: flex;
    flex-direction: column;
    min-width: 90px;
  }
  .zoom-menu button {
    background: transparent;
    border: 0;
    color: var(--fg);
    padding: 6px 12px;
    cursor: pointer;
    text-align: right;
    border-radius: 3px;
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 11px;
  }
  .zoom-menu button.active { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .zoom-menu button:hover { background: rgba(255,255,255,0.06); }

  /* Update pill — three states. Downloading is informational (no click),
     ready is an inviting accent-colored CTA, error is a quiet warning. */
  .upd {
    display: inline-flex; align-items: center; gap: 6px;
    height: 22px;
    padding: 0 10px;
    font-size: 10px;
    margin-right: 4px;
  }
  .upd.downloading {
    color: var(--fg-muted);
  }
  .upd.ready {
    background: color-mix(in srgb, var(--add, var(--accent)) 18%, transparent);
    color: var(--add, var(--accent));
    border: 1px solid var(--add, var(--accent));
    border-radius: 3px;
    cursor: pointer;
    font-weight: 600;
  }
  .upd.ready:hover {
    background: var(--add, var(--accent));
    color: var(--bg);
  }
  .upd.err {
    color: var(--del);
  }
  .upd-spin {
    width: 10px; height: 10px;
    border: 1.5px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: upd-spin 0.8s linear infinite;
  }
  @keyframes upd-spin { to { transform: rotate(360deg); } }
</style>
