<script lang="ts">
  import { logsPanelOpen, appLogs, logsClear, fmtTime } from "$lib/stores/logs";
  import { currentRepo } from "$lib/stores/repo";
  import { ipc } from "$lib/ipc";
  import Icon from "$lib/icons/Icon.svelte";

  let tab = $state<"app" | "repo">("app");
  let repoLines = $state<Array<{ ts: string; subject: string; author: string }>>([]);

  // Backend returns ISO-ish timestamps like "2026-05-01 14:23:45 -0300";
  // strip everything but the HH:MM:SS so the panel matches the App tab's
  // time-only formatting.
  function timeOnly(ts: string): string {
    const m = ts.match(/(\d{2}:\d{2}:\d{2})/);
    return m ? m[1] : ts;
  }
  let loading = $state(false);

  async function loadRepo() {
    if (!$currentRepo) return;
    loading = true;
    try { repoLines = await ipc.repoLogs($currentRepo, 200); }
    catch { repoLines = []; }
    finally { loading = false; }
  }

  $effect(() => {
    if ($logsPanelOpen && tab === "repo") loadRepo();
  });
</script>

{#if $logsPanelOpen}
  <div class="overlay" onclick={() => logsPanelOpen.set(false)}
    role="presentation"></div>
  <div class="panel" role="dialog" aria-label="Logs">
    <header class="head">
      <span class="title">Logs</span>
      <div class="tabs">
        <button class:active={tab === "app"} onclick={() => tab = "app"}>Application</button>
        <button class:active={tab === "repo"} onclick={() => tab = "repo"}>Repository</button>
      </div>
      {#if tab === "app"}
        <button class="icon-btn end" type="button" title="Clear application log" aria-label="Clear application log"
          onclick={logsClear}><Icon name="trash" size={14} /></button>
      {:else}
        <button class="icon-btn end" type="button" title="Refresh repository log" aria-label="Refresh repository log"
          onclick={loadRepo}><Icon name="fetch" size={14} /></button>
      {/if}
      <button class="icon-btn" type="button" title="Close logs" aria-label="Close logs"
        onclick={() => logsPanelOpen.set(false)}><Icon name="close" size={14} /></button>
    </header>
    <div class="body">
      {#if tab === "app"}
        {#if $appLogs.length === 0}
          <div class="empty">No application logs yet.</div>
        {:else}
          <ul class="lines">
            {#each $appLogs as l (l.ts + l.msg)}
              <li class="line {l.level}">
                <span class="ts">{fmtTime(l.ts)}</span>
                <span class="lvl">{l.level}</span>
                <span class="msg">{l.msg}</span>
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        {#if loading}
          <div class="empty">Loading…</div>
        {:else if repoLines.length === 0}
          <div class="empty">No repository entries.</div>
        {:else}
          <ul class="lines">
            {#each repoLines as r, i (i)}
              <li class="line info">
                <span class="ts">{timeOnly(r.ts)}</span>
                <span class="lvl">{r.author}</span>
                <span class="msg">{r.subject}</span>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 800;
  }
  .panel {
    position: fixed;
    right: var(--sp-8);
    bottom: calc(var(--h-statusbar) + var(--sp-8));
    width: 640px;
    max-width: calc(100vw - 2 * var(--sp-8));
    height: 60vh;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: 0 12px 32px rgba(0,0,0,0.55);
    display: flex;
    flex-direction: column;
    z-index: 801;
  }
  /* Panel header: 30 px, the title and icon-button actions of the view header. */
  .head {
    display: flex; align-items: center; gap: var(--sp-5);
    height: var(--h-section);
    padding: 0 var(--sp-6);
    border-bottom: 1px solid var(--border);
  }
  .title { font-weight: 600; font-size: var(--fs-lg); }
  .tabs { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .tabs button {
    height: var(--h-row);
    background: transparent; border: 0; color: var(--fg-muted);
    padding: 0 var(--sp-5); cursor: pointer; font-size: var(--fs-sm); text-transform: uppercase; letter-spacing: 0.4px;
  }
  .tabs button.active { background: var(--border-strong); color: var(--fg); }
  /* Icon-only action: 24 x 24, the toolbar hit size. */
  .icon-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: var(--h-row); height: var(--h-row); padding: 0;
    background: transparent; border: 1px solid transparent; border-radius: var(--radius);
    color: var(--fg-muted); cursor: pointer;
  }
  .icon-btn.end { margin-left: auto; }
  .icon-btn:hover { color: var(--fg); background: var(--border); }
  .body { flex: 1; overflow: auto; padding: var(--sp-1) 0; }
  .empty { padding: var(--sp-8); color: var(--fg-muted); font-style: italic; text-align: center; }
  .lines { list-style: none; margin: 0; padding: 0; font-family: "Cascadia Code", Consolas, monospace; font-size: var(--fs-sm); }
  .line { display: grid; grid-template-columns: 64px 60px 1fr; gap: var(--sp-5); padding: var(--sp-1) var(--sp-6); align-items: baseline; }
  .line:hover { background: var(--bg); }
  .ts { color: var(--fg-muted); }
  .lvl { text-transform: uppercase; color: var(--fg-muted); }
  .line.warn .lvl { color: var(--modified); }
  .line.error .lvl, .line.error .msg { color: var(--del); }
  .msg { color: var(--fg); white-space: pre-wrap; }
</style>
