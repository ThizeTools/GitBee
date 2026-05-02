<script lang="ts">
  import { logsPanelOpen, appLogs, logsClear, fmtTime } from "$lib/stores/logs";
  import { currentRepo } from "$lib/stores/repo";
  import { ipc } from "$lib/ipc";

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
        <button class="ghost" onclick={logsClear}>Clear</button>
      {:else}
        <button class="ghost" onclick={loadRepo}>Refresh</button>
      {/if}
      <button class="ghost close" onclick={() => logsPanelOpen.set(false)}>×</button>
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
    right: 16px; bottom: 40px;
    width: 640px;
    max-width: calc(100vw - 32px);
    height: 60vh;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.55);
    display: flex;
    flex-direction: column;
    z-index: 801;
  }
  .head {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }
  .title { font-weight: 600; }
  .tabs { display: inline-flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
  .tabs button {
    background: transparent; border: 0; color: var(--fg-muted);
    padding: 4px 12px; cursor: pointer; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px;
  }
  .tabs button.active { background: var(--border-strong); color: var(--fg); }
  .ghost {
    background: transparent; border: 1px solid var(--border); color: var(--fg-muted);
    border-radius: 3px; padding: 3px 10px; cursor: pointer; font-size: 11px;
    margin-left: auto;
  }
  .ghost.close { font-size: 18px; padding: 0 8px; line-height: 22px; margin-left: 0; }
  .ghost:hover { color: var(--fg); background: var(--border); }
  .body { flex: 1; overflow: auto; padding: 4px 0; }
  .empty { padding: 30px; color: var(--fg-muted); font-style: italic; text-align: center; }
  .lines { list-style: none; margin: 0; padding: 0; font-family: "Cascadia Code", Consolas, monospace; font-size: 11px; }
  .line { display: grid; grid-template-columns: 64px 60px 1fr; gap: 10px; padding: 2px 14px; align-items: baseline; }
  .line:hover { background: var(--bg); }
  .ts { color: var(--fg-muted); }
  .lvl { text-transform: uppercase; color: var(--fg-muted); }
  .line.warn .lvl { color: var(--modified); }
  .line.error .lvl, .line.error .msg { color: var(--del); }
  .msg { color: var(--fg); white-space: pre-wrap; }
</style>
