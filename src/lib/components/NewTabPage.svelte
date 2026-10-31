<script lang="ts">
  import { recent, openRepo, forgetRepo, tabs } from "$lib/stores/repo";
  import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
  import CloneModal from "./CloneModal.svelte";
  import CreateRepoModal from "./CreateRepoModal.svelte";
  import Icon from "$lib/icons/Icon.svelte";

  let creating = $state(false);
  // #18 — Clone is a single button that opens a modal (GitKraken-style),
  // not an inline expanding card. Inline form was distorting the action
  // grid as the GitHub picker grew.
  let cloneOpen = $state(false);
  // Create modal: local-only or on-GitHub. Replaces the old plain
  // folder-picker that only did `git init`.
  let createOpen = $state(false);

  async function browseOpen() {
    const picked = await openFolderDialog({ directory: true, multiple: false, title: "Open repository" });
    if (typeof picked === "string" && picked.length > 0) await openRepo(picked);
  }

  function normPath(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  }
  const openPaths = $derived(new Set($tabs.map((t) => normPath(t.path))));
  function isOpen(p: string): boolean { return openPaths.has(normPath(p)); }
</script>

<div class="newtab">
  <!-- View header: one 30 px row, the title as in the other center views. -->
  <header class="view-head">
    <h1>Repositories</h1>
  </header>
  <div class="scroll">
    <div class="inner">
      <div class="actions">
        <button class="action" onclick={browseOpen} disabled={creating}>
          <span class="ico"><Icon name="folder" size={18} /></span><span class="lbl">Open</span>
          <span class="hint">Open an existing repo</span>
        </button>
        <button class="action" onclick={() => cloneOpen = true} disabled={creating}>
          <span class="ico"><Icon name="download" size={18} /></span><span class="lbl">Clone</span>
          <span class="hint">From URL or GitHub</span>
        </button>
        <button class="action" onclick={() => createOpen = true} disabled={creating}>
          <span class="ico"><Icon name="add" size={18} /></span><span class="lbl">Create</span>
          <span class="hint">Local or on GitHub</span>
        </button>
      </div>

      <h2>Recent</h2>
      <ul class="recent">
        {#each $recent as r (r.id)}
          {@const open = isOpen(r.path)}
          <li class:open>
            <button class="row" onclick={() => openRepo(r.path)} title={open ? `Switch to tab — ${r.path}` : r.path}>
              <span class="ico"><Icon name="folder" size={14} /></span>
              <span class="name">{r.path.split(/[\\/]/).filter(Boolean).pop()}</span>
              <span class="path">{r.path}</span>
              {#if open}<span class="open-pill" title="Already open">open</span>{/if}
            </button>
            <button
              class="forget"
              type="button"
              title="Remove from recents (doesn't delete the repo)"
              aria-label="Remove {r.path} from recents"
              onclick={(e) => { e.stopPropagation(); forgetRepo(r.path); }}
            ><Icon name="close" size={12} /></button>
          </li>
        {:else}
          <li class="muted">No recent repositories.</li>
        {/each}
      </ul>
    </div>
  </div>
</div>

{#if cloneOpen}
  <CloneModal onClose={() => cloneOpen = false} />
{/if}
{#if createOpen}
  <CreateRepoModal onClose={() => createOpen = false} />
{/if}

<style>
  .newtab {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg);
  }
  .view-head {
    display: flex;
    align-items: center;
    height: var(--h-section);
    padding: 0 var(--sp-8);
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border-strong);
    flex-shrink: 0;
  }
  h1 {
    font-size: var(--fs-lg);
    font-weight: 600;
    margin: 0;
    color: var(--fg);
  }
  .scroll { flex: 1; overflow: auto; padding: var(--sp-8); }
  .inner { max-width: 920px; margin: 0 auto; }
  h2 {
    font-size: var(--fs-sm);
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--fg-muted);
    margin: var(--sp-8) 0 var(--sp-3);
    border-bottom: 1px solid var(--border);
    padding-bottom: var(--sp-3);
  }
  .actions {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--sp-6);
  }
  .action {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    padding: var(--sp-8);
    cursor: pointer;
    color: var(--fg);
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    font: inherit;
  }
  .action:hover:not(:disabled) { border-color: var(--accent); }
  .action:disabled { opacity: 0.5; cursor: not-allowed; }
  .ico { display: inline-flex; color: var(--fg-muted); }
  .action .ico { color: var(--accent); }
  .lbl { font-size: var(--fs-lg); font-weight: 600; }
  .hint { color: var(--fg-muted); font-size: var(--fs-sm); }
  .recent { list-style: none; margin: 0; padding: 0; }
  .recent li {
    border-bottom: 1px solid var(--border);
    position: relative;
    display: flex;
    align-items: stretch;
  }
  .recent li.muted { padding: var(--sp-8); color: var(--fg-muted); font-style: italic; display: block; }
  /* Repo row: 28 px, the list-row size in the layout spec. */
  .recent .row {
    flex: 1;
    min-height: 28px;
    background: transparent;
    border: 0;
    color: var(--fg);
    text-align: left;
    padding: 0 var(--sp-6);
    cursor: pointer;
    display: grid;
    grid-template-columns: var(--h-row) 1fr 2fr auto;
    gap: var(--sp-6);
    align-items: center;
    font: inherit;
    font-size: var(--fs-md);
    min-width: 0;
  }
  .recent li:hover { background: var(--bg-elev); }
  .recent .name { font-weight: 600; }
  .recent .path { color: var(--fg-muted); font-family: "Cascadia Code", Consolas, monospace; font-size: var(--fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* X to remove from recents — only visible when hovering the row.
     Doesn't touch the repo on disk; just deletes the cache entry. */
  .recent .forget {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--h-row);
    align-self: center;
    margin: 0 var(--sp-4);
    background: transparent;
    border: 0;
    color: var(--fg-muted);
    cursor: pointer;
    padding: 0;
    opacity: 0;
    transition: opacity 80ms;
    flex-shrink: 0;
  }
  .recent li:hover .forget { opacity: 0.7; }
  .recent .forget:hover {
    color: var(--del);
    opacity: 1;
  }
  .recent li.open .name { color: var(--accent); }
  /* State pill: 18 px high (no token), radius-sm, with a CSS dot for the open state. */
  .open-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    height: 18px;
    color: var(--accent);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
    border-radius: var(--radius-sm);
    padding: 0 var(--sp-4);
    white-space: nowrap;
  }
  .open-pill::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
</style>
