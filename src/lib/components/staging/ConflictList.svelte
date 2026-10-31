<script lang="ts">
  import type { StatusEntry } from "$lib/ipc";
  import { takeSide } from "$lib/conflict/actions";
  import { takeLabel, type SideNames } from "$lib/conflict/labels";
  import { showConflict } from "$lib/stores/center";
  import { openMenu } from "$lib/stores/contextmenu";
  import Icon from "$lib/icons/Icon.svelte";
  import { conflictContextMenu } from "./conflictContextMenu";
  import { sortByPath, type SortMode } from "./stagingHelpers";

  // Conflicted files sit above the Unstaged and Staged lists, each with the
  // actions a conflict needs. Plain rows had none, so these were easy to miss.
  interface Props {
    files: StatusEntry[];
    names: SideNames;
    sortMode: SortMode;
  }
  let { files, names, sortMode }: Props = $props();

  const sorted = $derived(sortByPath(files, sortMode));
</script>

<section class="conflicts" aria-label="Conflicted files">
  <header class="head">
    <span class="title">Conflicts</span>
    <span class="count">{files.length}</span>
  </header>
  <ul>
    {#each sorted as f (f.path)}
      <li oncontextmenu={(e) => openMenu(e, conflictContextMenu(f.path, names))}>
        <button class="name" onclick={() => showConflict(f.path)} title={f.path}>
          <span class="glyph"><Icon name="conflict" size={16} /></span>
          <span class="path">{f.path}</span>
        </button>
        <div class="actions">
          <button onclick={() => takeSide(f.path, "ours", names.ours)}
            title={takeLabel("ours", names)}>{names.ours}</button>
          <button onclick={() => takeSide(f.path, "theirs", names.theirs)}
            title={takeLabel("theirs", names)}>{names.theirs}</button>
          <button class="resolve" onclick={() => showConflict(f.path)}
            title="Open the conflict editor">Resolve…</button>
        </div>
      </li>
    {/each}
  </ul>
</section>

<style>
  .conflicts {
    flex-shrink: 0;
    border-bottom: 1px solid var(--border-strong);
    max-height: 40%;
    display: flex; flex-direction: column;
    background: color-mix(in srgb, var(--del) 6%, transparent);
  }
  .head {
    display: flex; align-items: center; gap: var(--sp-4); padding: 0 var(--sp-6);
    background: var(--bg-elev); border-bottom: 1px solid var(--border);
    height: 28px; box-sizing: border-box; flex-shrink: 0;
  }
  .title {
    font-size: var(--fs-sm); text-transform: uppercase; letter-spacing: 0.04em;
    font-weight: 700; color: var(--del);
  }
  .count {
    background: var(--bg); color: var(--del);
    padding: 0 var(--sp-4); border-radius: var(--radius-lg); font-size: var(--fs-xs);
    font-weight: 600; border: 1px solid var(--del); line-height: 14px;
  }
  ul { list-style: none; margin: 0; padding: 0; overflow: auto; min-height: 0; }
  li { border-bottom: 1px solid var(--border); padding: var(--sp-2) var(--sp-4) var(--sp-3); }
  li:last-child { border-bottom: 0; }
  .name {
    display: flex; gap: var(--sp-4); align-items: center; width: 100%;
    background: transparent; border: 0; color: var(--fg);
    padding: var(--sp-1) var(--sp-2);
    font-family: "Cascadia Code", Consolas, monospace; font-size: var(--fs-sm);
    text-align: left; cursor: pointer; min-width: 0;
  }
  .name:hover .path { text-decoration: underline; }
  .glyph { color: var(--del); display: inline-flex; flex-shrink: 0; }
  .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  /* Left inset lines the buttons up under the file name, past the status icon. */
  .actions {
    display: flex; gap: var(--sp-3); flex-wrap: wrap;
    padding: var(--sp-1) var(--sp-2) 0 calc(var(--sp-2) + var(--icon) + var(--sp-4));
  }
  .actions button {
    height: var(--h-row);
    background: var(--bg); color: var(--fg); border: 1px solid var(--border);
    padding: 0 var(--sp-4); border-radius: var(--radius); cursor: pointer;
    font-size: var(--fs-sm);
  }
  .actions button:hover { border-color: var(--accent); color: var(--accent); }
  .actions button.resolve {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent); border-color: var(--accent);
  }
  .actions button.resolve:hover { background: var(--accent); color: var(--bg); }
</style>
