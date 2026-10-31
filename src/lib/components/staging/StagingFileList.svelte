<script lang="ts">
  import FileTree from "$lib/components/FileTree.svelte";
  import type { StatusEntry } from "$lib/ipc";
  import { showFile } from "$lib/stores/center";
  import { openMenu } from "$lib/stores/contextmenu";
  import { setSize } from "$lib/stores/layout";
  import { currentRepo } from "$lib/stores/repo";
  import {
    discardFile, stageAll, stageFile, stageFiles,
    unstageAll, unstageFile, unstageFiles,
  } from "./fileActions";
  import { fileContextMenu } from "./fileContextMenu";
  import {
    batchLabelFor, blockFlex, collapseKeyFor, multiSelectionFor, shiftRange,
    sideOf, sortByPath, statusChar, statusTitle,
    type ActiveFile, type ListKind, type SortMode, type ViewMode,
  } from "./stagingHelpers";

  // One section of the panel: the Unstaged list or the Staged list. Both share
  // header, path/tree views, multi-select and the hover action; `kind` picks
  // the git side, the stage direction and the copy.
  interface Props {
    kind: ListKind;
    /** Entries for this side, without conflicts. */
    files: StatusEntry[];
    /** Conflicted entries; only the unstaged list has any. */
    conflicts?: StatusEntry[];
    viewMode: ViewMode;
    sortMode: SortMode;
    activeFile: ActiveFile | null;
    /** This section is folded down to its header. */
    collapsed: boolean;
    /** The sibling section is folded, so this one takes the free space. */
    otherCollapsed: boolean;
    /** Ctrl/Shift multi-selection. Bound so Commit can clear it on success. */
    selection: Set<string>;
    /** Shift-range anchor. Bound alongside `selection`. */
    anchor: string | null;
  }
  let {
    kind, files, conflicts = [], viewMode, sortMode, activeFile, collapsed, otherCollapsed,
    selection = $bindable(), anchor = $bindable(),
  }: Props = $props();

  const COPY: Record<ListKind, { title: string; bulk: string; empty: string }> = {
    unstaged: { title: "Unstaged Files", bulk: "Stage All Changes", empty: "working tree clean" },
    staged: { title: "Staged Files", bulk: "Unstage All Changes", empty: "no staged changes" },
  };

  const staged = $derived(kind === "staged");
  const side = $derived(sideOf(kind));
  const collapseKey = $derived(collapseKeyFor(kind));
  // Sort by full path. The Tree view passes sortMode straight to FileTree
  // so its internal sortedChildren() flips direction too.
  const sortedFiles = $derived(sortByPath(files, sortMode));
  const sortedConflicts = $derived(sortByPath(conflicts, sortMode));
  const total = $derived(files.length + conflicts.length);

  /** Fold or unfold this section. The flag lives in the persisted layout store. */
  function toggleCollapsed() { setSize(collapseKey, !collapsed); }

  /** Header button: stage everything, or unstage everything in the staged list. */
  function bulkAction() {
    if (staged) unstageAll();
    else stageAll();
  }

  // ---- Multi-selection (Ctrl/Shift like a file explorer) ----
  // Two independent selections — the staged and unstaged lists are
  // visually separate, so a Shift-range across them would be confusing.

  function handleRowClick(e: MouseEvent, path: string) {
    if (e.shiftKey) {
      extendSelection(path);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      toggleInSelection(path);
      return;
    }
    selection = new Set([path]);
    anchor = path;
    showFile(path, staged);
  }

  // Shift-range runs over the visible order (sorted flat list). In Tree mode the
  // visual order can differ, but the tree already lays files out in the same
  // alpha order within each folder so the mismatch is small in practice and
  // not worth a second ordered structure.
  function extendSelection(path: string) {
    const order = sortedFiles.map((f) => f.path);
    const next = shiftRange(order, anchor ?? path, path, selection);
    if (next) selection = next;
  }

  function toggleInSelection(path: string) {
    const next = new Set(selection);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    selection = next;
    anchor = path;
  }

  // Stage/unstage helper for the hover-btn: if the row is part of a
  // multi-selection, act on the whole batch; otherwise act on the row.
  async function batchAction(path: string) {
    if (!$currentRepo) return;
    const targets = multiSelectionFor(selection, path) ?? [path];
    if (staged) await unstageFiles(targets);
    else await stageFiles(targets);
    selection = new Set();
    anchor = null;
  }

  function batchLabel(path: string): string {
    return batchLabelFor(selection, path, staged ? "Unstage" : "Stage");
  }

  // Glue between FileTree's onAction and the file actions.
  function onTreeAction(path: string, action: "stage" | "unstage" | "discard") {
    if (action === "stage") stageFile(path);
    else if (action === "unstage") unstageFile(path);
    else discardFile(path);
  }

  async function onTreeFolderAction(paths: string[], action: "stage" | "unstage") {
    if (paths.length === 0) return;
    if (action === "stage") await stageFiles(paths);
    else await unstageFiles(paths);
  }

  function onFileContext(e: MouseEvent, f: StatusEntry) {
    openMenu(e, fileContextMenu(f.path, staged));
  }

  function isActive(path: string): boolean {
    return activeFile?.file === path && activeFile?.staged === staged;
  }
</script>

{#snippet tree(list: StatusEntry[])}
  <FileTree files={list} side={side} {sortMode}
    selected={activeFile?.staged === staged ? activeFile.file : null}
    selectionSet={selection}
    onClick={(p, e) => handleRowClick(e, p)}
    onAction={onTreeAction} actionLabel={staged ? "unstage" : "stage"}
    onFolderAction={onTreeFolderAction}
    batchTargets={(p) => multiSelectionFor(selection, p)}
    batchLabel={batchLabel} />
{/snippet}

<section
  class="block"
  class:collapsed
  style:flex={blockFlex(collapsed, otherCollapsed)}
>
  <header class="block-head">
    <button class="head-toggle" onclick={toggleCollapsed} title={collapsed ? "Expand" : "Collapse"}>
      <span class="chev">{collapsed ? "▶" : "▼"}</span>
      <span class="block-title">{COPY[kind].title}</span>
      <span class="block-count">{total}</span>
    </button>
    <button
      class="primary-link"
      class:danger={staged}
      onclick={bulkAction}
      disabled={total === 0}
    >{COPY[kind].bulk}</button>
  </header>
  {#if !collapsed}
    <div class="list-wrap">
      {#if viewMode === "tree"}
        {#if sortedConflicts.length > 0}
          {@render tree(sortedConflicts)}
        {/if}
        {#if total === 0}
          <div class="empty">{COPY[kind].empty}</div>
        {:else}
          {@render tree(sortedFiles)}
        {/if}
      {:else}
        {#if sortedConflicts.length > 0}
          <ul class="flat conflicts">
            {#each sortedConflicts as f (f.path)}
              <li
                class:active={isActive(f.path)}
                class:multi-selected={selection.has(f.path)}
                oncontextmenu={(e) => onFileContext(e, f)}
              >
                <button class="row" onclick={(e) => handleRowClick(e, f.path)}>
                  <span class="status conflicted" title="Conflicted">!</span>
                  <span class="path conflicted">{f.path}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        <ul class="flat">
          {#each sortedFiles as f (f.path)}
            <li
              class:active={isActive(f.path)}
              class:multi-selected={selection.has(f.path)}
              oncontextmenu={(e) => onFileContext(e, f)}
            >
              <button class="row" onclick={(e) => handleRowClick(e, f.path)}>
                <span class="status {f[side]}" title={statusTitle(f, side)}>{statusChar(f, side)}</span>
                <span class="path {f[side]}">{f.path}</span>
              </button>
              <button
                class="hover-btn"
                class:stage={!staged}
                class:unstage={staged}
                onclick={() => batchAction(f.path)}
                title={batchLabel(f.path)}
              >{batchLabel(f.path)}</button>
            </li>
          {/each}
          {#if total === 0}
            <li class="empty">{COPY[kind].empty}</li>
          {/if}
        </ul>
      {/if}
    </div>
  {/if}
</section>

<style>
  .block {
    border-bottom: 1px solid var(--border-strong);
    min-height: 36px;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .block.collapsed { flex: 0 0 auto !important; }
  .list-wrap { flex: 1; overflow: auto; }
  .block-head {
    display: flex; align-items: center; gap: 8px; padding: 6px 12px;
    background: var(--bg-elev); border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    height: 28px;
  }
  .head-toggle {
    background: transparent; border: 0; color: inherit;
    display: flex; align-items: center; gap: 8px;
    padding: 0; cursor: pointer;
    flex: 1; min-width: 0; text-align: left;
  }
  .head-toggle:hover .chev,
  .head-toggle:hover .block-title { color: var(--fg); }
  .chev {
    color: var(--fg-muted);
    font-size: 9px; width: 14px;
    flex-shrink: 0;
  }
  .block-title {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;
    font-weight: 700; color: var(--fg);
  }
  .block-count {
    background: var(--bg); color: var(--fg-muted);
    padding: 1px 8px; border-radius: 10px; font-size: 11px;
    font-weight: 600; border: 1px solid var(--border);
  }
  /* Same look as the Commit button: translucent fill + 100% border by
     default, fully filled on hover. Keeps every primary action across the
     panel visually consistent. */
  .primary-link {
    margin-left: auto;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    border: 1px solid var(--accent);
    padding: 4px 12px; border-radius: 4px; cursor: pointer;
    font-weight: 600; font-size: 11px;
    transition: background 120ms ease, color 120ms ease;
  }
  .primary-link:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  .primary-link:disabled {
    background: transparent; color: var(--fg-muted);
    border-color: var(--border); cursor: not-allowed;
  }
  /* Danger variant — same translucent-default / fill-on-hover pattern as
     the Unstage File hover button below, just at section-header scale.
     `:not(:disabled)` lets the disabled rule above win when there's
     nothing staged so the button visibly greys out instead of staying red. */
  .primary-link.danger:not(:disabled) {
    background: color-mix(in srgb, var(--del) 18%, transparent);
    color: var(--del);
    border-color: var(--del);
  }
  .primary-link.danger:hover:not(:disabled) { background: var(--del); color: var(--bg); }

  .flat { list-style: none; margin: 0; padding: 0; }
  .flat li {
    display: flex; align-items: center; border-bottom: 1px solid var(--border);
    position: relative;
  }
  .flat li:last-child { border-bottom: 0; }
  .flat li.empty {
    padding: 12px 16px; color: var(--fg-muted);
    font-style: italic; font-size: 11px; justify-content: center;
  }
  .flat li.active { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .flat li.active::before {
    content: ""; width: 3px; align-self: stretch; background: var(--accent);
  }
  /* Multi-select highlight — distinct from the single "active" file so
     the user can see what's currently being viewed vs. what's selected
     for a batched stage/unstage. */
  .flat li.multi-selected { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .flat li.multi-selected.active { background: color-mix(in srgb, var(--accent) 30%, transparent); }
  .row {
    flex: 1; background: transparent; border: 0; color: var(--fg);
    text-align: left; padding: 4px 12px; cursor: pointer;
    display: flex; gap: 8px; align-items: center;
    font-family: "Cascadia Code", Consolas, monospace; font-size: 11px;
    overflow: hidden; min-width: 0;
    line-height: 18px;
  }
  .row:hover { background: rgba(255,255,255,0.04); }
  /* Status glyph: color-only (no badge box). The shape is the message —
     `+` reads as "added", `−` as "removed", `●` as "edited", `→` as
     "renamed", `!` as "conflict". The full word lives in the title attr. */
  .status {
    display: inline-block; width: 12px;
    text-align: center; font-weight: 700; flex-shrink: 0;
    font-size: 12px; line-height: 14px;
  }
  .status.modified, .path.modified   { color: var(--modified); }
  .status.added,    .path.added,
  .status.untracked, .path.untracked { color: var(--add, var(--accent)); }
  .status.deleted,  .path.deleted    { color: var(--del); }
  .status.renamed,  .path.renamed,
  .status.copied,   .path.copied     { color: var(--renamed); }
  .status.conflicted, .path.conflicted { color: var(--del); font-weight: 700; }
  .path.deleted { text-decoration: line-through; text-decoration-thickness: 1px; }
  .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty {
    padding: 12px 16px; color: var(--fg-muted);
    font-style: italic; font-size: 11px; text-align: center;
  }

  .hover-btn {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: var(--bg-elev);
    color: transparent;
    border: 1px solid transparent;
    padding: 4px 12px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    pointer-events: none;
    opacity: 0;
    transition: opacity 100ms;
  }
  .flat li:hover .hover-btn { opacity: 1; pointer-events: auto; }
  .flat li:hover .hover-btn.stage { color: var(--accent); border-color: var(--accent); }
  .flat li:hover .hover-btn.stage:hover { background: var(--accent); color: var(--bg); }
  .flat li:hover .hover-btn.unstage { color: var(--del); border-color: var(--del); }
  .flat li:hover .hover-btn.unstage:hover { background: var(--del); color: var(--bg); }
</style>
