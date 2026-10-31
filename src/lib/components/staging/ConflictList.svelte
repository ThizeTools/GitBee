<script lang="ts">
  import type { StatusEntry } from "$lib/ipc";
  import { takeSide } from "$lib/conflict/actions";
  import { takeLabel, type SideNames } from "$lib/conflict/labels";
  import { showConflict } from "$lib/stores/center";
  import { openMenu } from "$lib/stores/contextmenu";
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
          <span class="glyph">!</span>
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
    display: flex; align-items: center; gap: 8px; padding: 6px 12px;
    background: var(--bg-elev); border-bottom: 1px solid var(--border);
    height: 28px; box-sizing: border-box; flex-shrink: 0;
  }
  .title {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;
    font-weight: 700; color: var(--del);
  }
  .count {
    background: var(--bg); color: var(--del);
    padding: 1px 8px; border-radius: 10px; font-size: 11px;
    font-weight: 600; border: 1px solid var(--del);
  }
  ul { list-style: none; margin: 0; padding: 0; overflow: auto; min-height: 0; }
  li { border-bottom: 1px solid var(--border); padding: 4px 8px 6px; }
  li:last-child { border-bottom: 0; }
  .name {
    display: flex; gap: 8px; align-items: center; width: 100%;
    background: transparent; border: 0; color: var(--fg); padding: 2px 4px;
    font-family: "Cascadia Code", Consolas, monospace; font-size: 11px;
    text-align: left; cursor: pointer; min-width: 0;
  }
  .name:hover .path { text-decoration: underline; }
  .glyph { color: var(--del); font-weight: 700; flex-shrink: 0; }
  .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .actions { display: flex; gap: 6px; padding: 2px 4px 0 24px; flex-wrap: wrap; }
  .actions button {
    background: var(--bg); color: var(--fg); border: 1px solid var(--border);
    padding: 2px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;
  }
  .actions button:hover { border-color: var(--accent); color: var(--accent); }
  .actions button.resolve {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent); border-color: var(--accent);
  }
  .actions button.resolve:hover { background: var(--accent); color: var(--bg); }
</style>
