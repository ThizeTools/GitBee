<script lang="ts">
  import { recent, openRepo, forgetRepo } from "$lib/stores/repo";
  import { ipc } from "$lib/ipc";
  import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
  import { logAppend } from "$lib/stores/logs";
  import CloneModal from "./CloneModal.svelte";

  let creating = $state(false);
  // #18 — Clone is a single button that opens a modal (GitKraken-style),
  // not an inline expanding card. Inline form was distorting the action
  // grid as the GitHub picker grew.
  let cloneOpen = $state(false);

  async function browseOpen() {
    const picked = await openFolderDialog({ directory: true, multiple: false, title: "Open repository" });
    if (typeof picked === "string" && picked.length > 0) await openRepo(picked);
  }
  async function browseCreate() {
    const picked = await openFolderDialog({ directory: true, multiple: false, title: "Create repository in" });
    if (typeof picked === "string" && picked.length > 0) {
      try {
        creating = true;
        const path = await ipc.repoCreate(picked);
        logAppend("info", `created repo at ${path}`);
        await openRepo(path);
      } catch (e) {
        logAppend("error", `create failed: ${e}`);
      } finally { creating = false; }
    }
  }
</script>

<div class="newtab">
  <div class="inner">
    <h1>Repositories</h1>
    <div class="actions">
      <button class="action" onclick={browseOpen} disabled={creating}>
        <span class="ico">📂</span><span class="lbl">Open</span>
        <span class="hint">Open an existing repo</span>
      </button>
      <button class="action" onclick={() => cloneOpen = true} disabled={creating}>
        <span class="ico">⤓</span><span class="lbl">Clone</span>
        <span class="hint">From URL or GitHub</span>
      </button>
      <button class="action" onclick={browseCreate} disabled={creating}>
        <span class="ico">＋</span><span class="lbl">Create</span>
        <span class="hint">git init in folder</span>
      </button>
    </div>

    <h2>Recent</h2>
    <ul class="recent">
      {#each $recent as r (r.id)}
        <li>
          <button class="row" onclick={() => openRepo(r.path)} title={r.path}>
            <span class="ico">📁</span>
            <span class="name">{r.path.split(/[\\/]/).filter(Boolean).pop()}</span>
            <span class="path">{r.path}</span>
          </button>
          <button
            class="forget"
            title="Remove from recents (doesn't delete the repo)"
            onclick={(e) => { e.stopPropagation(); forgetRepo(r.path); }}
          >×</button>
        </li>
      {:else}
        <li class="muted">No recent repositories.</li>
      {/each}
    </ul>
  </div>
</div>

{#if cloneOpen}
  <CloneModal onClose={() => cloneOpen = false} />
{/if}

<style>
  .newtab {
    flex: 1;
    overflow: auto;
    background: var(--bg);
    padding: 32px;
  }
  .inner { max-width: 920px; margin: 0 auto; }
  h1 {
    font-size: 22px;
    margin: 0 0 18px;
    color: var(--fg);
  }
  h2 {
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--fg-muted);
    margin: 28px 0 10px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 6px;
  }
  .actions {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }
  .action {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    padding: 18px;
    cursor: pointer;
    color: var(--fg);
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font: inherit;
  }
  .action:hover:not(:disabled) { border-color: var(--accent); }
  .action:disabled { opacity: 0.5; cursor: not-allowed; }
  .ico { font-size: 22px; }
  .lbl { font-size: 14px; font-weight: 600; }
  .hint { color: var(--fg-muted); font-size: 11px; }
  .recent { list-style: none; margin: 0; padding: 0; }
  .recent li {
    border-bottom: 1px solid var(--border);
    position: relative;
    display: flex;
    align-items: stretch;
  }
  .recent li.muted { padding: 16px; color: var(--fg-muted); font-style: italic; display: block; }
  .recent .row {
    flex: 1;
    background: transparent;
    border: 0;
    color: var(--fg);
    text-align: left;
    padding: 10px 12px;
    cursor: pointer;
    display: grid;
    grid-template-columns: 28px 1fr 2fr;
    gap: 12px;
    align-items: center;
    font: inherit;
    min-width: 0;
  }
  .recent li:hover { background: var(--bg-elev); }
  .recent .name { font-weight: 600; }
  .recent .path { color: var(--fg-muted); font-family: "Cascadia Code", Consolas, monospace; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* X to remove from recents — only visible when hovering the row.
     Doesn't touch the repo on disk; just deletes the cache entry. */
  .recent .forget {
    background: transparent;
    border: 0;
    color: var(--fg-muted);
    cursor: pointer;
    padding: 0 14px;
    font-size: 18px;
    line-height: 1;
    opacity: 0;
    transition: opacity 80ms;
    flex-shrink: 0;
  }
  .recent li:hover .forget { opacity: 0.7; }
  .recent .forget:hover {
    color: var(--del);
    opacity: 1;
  }
</style>
