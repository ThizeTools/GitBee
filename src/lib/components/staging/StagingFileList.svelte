<script lang="ts">
  import FileTree from "$lib/components/FileTree.svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import type { StatusEntry } from "$lib/ipc";
  import { showFile } from "$lib/stores/center";
  import { openMenu } from "$lib/stores/contextmenu";
  import { setSize } from "$lib/stores/layout";
  import { currentRepo } from "$lib/stores/repo";
  import { currentLfsFlags, requestLfsPaths } from "$lib/stores/lfs";
  import LfsBadge from "$lib/components/lfs/LfsBadge.svelte";
  import {
    discardFile, stageAll, stageFile, stageFiles,
    unstageAll, unstageFile, unstageFiles,
  } from "./fileActions";
  import { fileContextMenu } from "./fileContextMenu";
  import {
    batchLabelFor, blockFlex, collapseKeyFor, multiSelectionFor, shiftRange,
    sideOf, sortByPath, statusIconFor, statusTitle,
    type ActiveFile, type ListKind, type SortMode, type ViewMode,
  } from "./stagingHelpers";

  // One section of the panel: the Unstaged list or the Staged list. Both share
  // header, path/tree views, multi-select and the hover action; `kind` picks
  // the git side, the stage direction and the copy.
  interface Props {
    kind: ListKind;
    /** Entries for this side. Conflicted entries live in ConflictList instead. */
    files: StatusEntry[];
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
    kind, files, viewMode, sortMode, activeFile, collapsed, otherCollapsed,
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
  const total = $derived(files.length);
  // Which shown files Git LFS stores. Answers are cached per repo, so a list that
  // has not changed asks git nothing (docs/specs/git-lfs.md).
  const lfsFlags = $derived($currentLfsFlags);
  $effect(() => {
    if ($currentRepo) requestLfsPaths($currentRepo, files.map((f) => f.path));
  });

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
    lfsFlags={lfsFlags}
    batchLabel={batchLabel} />
{/snippet}

<section
  class="block"
  class:collapsed
  style:flex={blockFlex(collapsed, otherCollapsed)}
>
  <header class="block-head">
    <button class="head-toggle" onclick={toggleCollapsed} title={collapsed ? "Expand" : "Collapse"}>
      <span class="chev"><Icon name={collapsed ? "chevron-right" : "chevron-down"} size={14} /></span>
      <span class="block-title">{COPY[kind].title}</span>
      <span class="block-count">{total}</span>
    </button>
    <button
      class="head-action"
      class:primary={!staged}
      class:secondary={staged}
      onclick={bulkAction}
      disabled={total === 0}
    >{COPY[kind].bulk}</button>
  </header>
  {#if !collapsed}
    <div class="list-wrap">
      {#if viewMode === "tree"}
        {#if total === 0}
          <div class="empty">{COPY[kind].empty}</div>
        {:else}
          {@render tree(sortedFiles)}
        {/if}
      {:else}
        <ul class="flat">
          {#each sortedFiles as f (f.path)}
            {@const icon = statusIconFor(f, side)}
            <li
              class:active={isActive(f.path)}
              class:multi-selected={selection.has(f.path)}
              oncontextmenu={(e) => onFileContext(e, f)}
            >
              <button class="row" onclick={(e) => handleRowClick(e, f.path)}>
                <span class="status {f[side]}" title={statusTitle(f, side)}>
                  {#if icon}<Icon name={icon} size={16} />{/if}
                </span>
                <span class="path {f[side]}">{f.path}</span>
                {#if lfsFlags[f.path]}<LfsBadge />{/if}
              </button>
              <button
                class="hover-btn"
                class:stage={!staged}
                class:unstage={staged}
                onclick={() => batchAction(f.path)}
                title={batchLabel(f.path)}
                aria-label={batchLabel(f.path)}
              >
                <Icon name={staged ? "remove" : "add"} size={14} />
              </button>
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
    min-height: var(--h-section);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .block.collapsed { flex: 0 0 auto !important; }
  .list-wrap { flex: 1; overflow: auto; }
  .block-head {
    display: flex; align-items: center; gap: var(--sp-4); padding: 0 var(--sp-6);
    background: var(--bg-elev); border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    height: 28px;
  }
  .head-toggle {
    background: transparent; border: 0; color: inherit;
    display: flex; align-items: center; gap: var(--sp-4);
    padding: 0; cursor: pointer;
    flex: 1; min-width: 0; text-align: left;
  }
  .head-toggle:hover .chev,
  .head-toggle:hover .block-title { color: var(--fg); }
  .chev { color: var(--fg-muted); display: inline-flex; flex-shrink: 0; }
  .block-title {
    font-size: var(--fs-sm); text-transform: uppercase; letter-spacing: 0.04em;
    font-weight: 700; color: var(--fg);
  }
  .block-count {
    background: var(--bg); color: var(--fg-muted);
    padding: 0 var(--sp-4); border-radius: var(--radius-lg); font-size: var(--fs-xs);
    font-weight: 600; border: 1px solid var(--border); line-height: 14px;
  }
  /* Stage All is the primary action (translucent accent, filled on hover) and
     Unstage All the secondary one (neutral outline), so the two read apart.
     The :not(:disabled) guard lets the disabled rule win when the list is empty. */
  .head-action {
    margin-left: auto;
    height: var(--h-row); padding: 0 var(--sp-6);
    border: 1px solid transparent; border-radius: var(--radius); cursor: pointer;
    font-size: var(--fs-sm); font-weight: 600;
    transition: background 120ms ease, color 120ms ease;
  }
  .head-action.primary:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent); border-color: var(--accent);
  }
  .head-action.primary:not(:disabled):hover { background: var(--accent); color: var(--bg); }
  .head-action.secondary:not(:disabled) {
    background: transparent; color: var(--fg); border-color: var(--border-strong);
  }
  .head-action.secondary:not(:disabled):hover { background: var(--border-strong); }
  .head-action:disabled {
    background: transparent; color: var(--fg-muted);
    border-color: var(--border); cursor: not-allowed;
  }

  .flat { list-style: none; margin: 0; padding: 0; }
  .flat li {
    display: flex; align-items: center; border-bottom: 1px solid var(--border);
    position: relative; height: var(--h-row);
  }
  .flat li:last-child { border-bottom: 0; }
  .flat li.empty {
    height: auto; padding: var(--sp-6) var(--sp-8); color: var(--fg-muted);
    font-style: italic; font-size: var(--fs-sm); justify-content: center;
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
    flex: 1; height: 100%; min-width: 0;
    background: transparent; border: 0; color: var(--fg);
    text-align: left; padding: 0 var(--sp-6); cursor: pointer;
    display: flex; gap: var(--sp-4); align-items: center;
    font-family: "Cascadia Code", Consolas, monospace; font-size: var(--fs-sm);
    overflow: hidden;
  }
  .row:hover { background: rgba(255,255,255,0.04); }
  /* Status icon: the shape says what happened, the color comes from the
     status classes below. The full word lives in the title attr. */
  .status {
    display: inline-flex; align-items: center; justify-content: center;
    width: var(--icon); height: var(--icon); flex-shrink: 0;
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
    padding: var(--sp-6) var(--sp-8); color: var(--fg-muted);
    font-style: italic; font-size: var(--fs-sm); text-align: center;
  }

  /* Hover action: a 24 px icon button at the row's right edge, shown only
     while the row is hovered. Its label is the title and aria-label. */
  .hover-btn {
    position: absolute;
    right: var(--sp-4);
    top: 50%;
    transform: translateY(-50%);
    width: var(--h-row); height: var(--h-row); padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--bg-elev);
    color: var(--fg-muted);
    border: 1px solid transparent;
    border-radius: var(--radius);
    cursor: pointer;
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
