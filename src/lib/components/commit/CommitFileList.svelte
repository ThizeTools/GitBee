<script lang="ts">
  // The commit's file list, as a Path list or a nested Tree. A row's toggle
  // shows that file's diff below the list. A click on the row opens the file
  // in the center diff. The panel owns the requested set and the sort/view
  // state, so keyboard navigation sees the same order this list draws.
  import type { CommitFileStat } from "$lib/ipc";
  import { sortedChildren, type SortMode, type TreeNode, type ViewMode } from "$lib/commit/fileTree";
  import { changeCountLabel, statusColor, statusName } from "$lib/commit/fileStatus";

  interface Props {
    viewMode: ViewMode;
    sortMode: SortMode;
    tree: TreeNode;
    /** Rows for the Path view, already in display order. */
    pathRows: CommitFileStat[];
    /** Paths whose diff is shown below the list. */
    requested: Record<string, true>;
    /** Path of the row ArrowUp/Down highlights, or null. */
    navPath: string | null;
    /** Total for the "Load all N diffs" button, or null to hide it. */
    loadAllTotal: number | null;
    onToggleDiff: (path: string) => void;
    onOpen: (path: string) => void;
    onLoadAll: () => void;
  }
  let {
    viewMode, sortMode, tree, pathRows, requested, navPath, loadAllTotal,
    onToggleDiff, onOpen, onLoadAll,
  }: Props = $props();

  // Tree directories the user collapsed, keyed by full path.
  let collapsed = $state<Record<string, boolean>>({});
  let allExpanded = $state(true);

  function toggleDir(p: string): void { collapsed[p] = !collapsed[p]; }

  function toggleAllDirs(): void {
    collapsed = {};
    allExpanded = !allExpanded;
    if (!allExpanded) {
      // collapse everything: walk tree and mark every dir collapsed
      const c: Record<string, boolean> = {};
      const walk = (n: TreeNode): void => {
        if (!n.file && n.path) c[n.path] = true;
        for (const ch of n.children.values()) walk(ch);
      };
      walk(tree);
      collapsed = c;
    }
  }
</script>

<div class="expand-row">
  <button class="link" onclick={toggleAllDirs}>{allExpanded ? "Collapse All" : "Expand All"}</button>
  {#if loadAllTotal !== null}
    <button class="link load-all" onclick={onLoadAll}>Load all {loadAllTotal} diffs</button>
  {/if}
</div>

{#if viewMode === "tree"}
  <ul class="tree">
    {#each sortedChildren(tree, sortMode) as child (child.path)}
      {@render treeNode(child, 0)}
    {/each}
  </ul>
{:else}
  <ul class="flat">
    {#each pathRows as f (f.path)}
      {@render fileRow(f, f.path, 12)}
    {/each}
  </ul>
{/if}

{#snippet fileRow(f: CommitFileStat, label: string, indent: number)}
  <li class="file" style="padding-left: {indent}px">
    <button class="diff-toggle" type="button"
      aria-expanded={requested[f.path] === true}
      title={requested[f.path] ? "Hide diff" : "Show diff"}
      onclick={() => onToggleDiff(f.path)}>
      <span class="caret">{requested[f.path] ? "▼" : "▶"}</span>
    </button>
    <button class="file-btn" type="button"
      class:nav-current={navPath === f.path}
      onclick={() => onOpen(f.path)}>
      <span class="f-ico" style="color: {statusColor(f.status)}" title={statusName(f.status)}>{f.status}</span>
      <span class="f-count">{changeCountLabel(f)}</span>
      <span class="f-path">{label}</span>
    </button>
  </li>
{/snippet}

{#snippet treeNode(node: TreeNode, depth: number)}
  {#if node.file}
    {@render fileRow(node.file, node.name, 12 + depth * 14)}
  {:else}
    <li class="dir" style="padding-left: {12 + depth * 14}px">
      <button class="dir-toggle" onclick={() => toggleDir(node.path)}>
        <span class="caret">{collapsed[node.path] ? "▶" : "▼"}</span>
        <span class="name">{node.name}</span>
      </button>
    </li>
    {#if !collapsed[node.path]}
      {#each sortedChildren(node, sortMode) as ch (ch.path)}
        {@render treeNode(ch, depth + 1)}
      {/each}
    {/if}
  {/if}
{/snippet}

<style>
  .expand-row {
    display: flex; align-items: center; gap: 12px;
    padding: 6px 14px;
    border-bottom: 1px solid var(--border);
    background: transparent;
  }
  .link {
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer; font-size: 11px;
  }
  .link:hover { color: var(--fg); text-decoration: underline; }
  .load-all { margin-left: auto; color: var(--accent); }

  .tree, .flat { list-style: none; margin: 0; padding: 0; }
  .file, .dir {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    font-size: 11px;
    color: var(--fg);
  }
  .dir { padding: 3px 12px; }
  .diff-toggle {
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer; padding: 3px 0; width: 16px; flex-shrink: 0;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .diff-toggle:hover { color: var(--fg); }
  .file-btn {
    display: flex; align-items: center; gap: 8px;
    flex: 1; min-width: 0;
    padding: 3px 12px 3px 0;
    background: transparent; border: 0; color: inherit;
    text-align: left; font: inherit; cursor: pointer;
  }
  .file-btn:hover { background: rgba(255,255,255,0.06); }
  /* ArrowUp/Down highlight while in "files" focus mode — uses accent
     so it reads as keyboard-driven, distinct from mouse hover. */
  .file-btn.nav-current {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    outline: 1px solid var(--accent);
  }
  .f-ico { font-size: 11px; font-weight: 600; width: 10px; text-align: center; }
  .f-count { color: var(--fg-muted); font-size: 10px; min-width: 14px; }
  .f-path {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: "Cascadia Code", Consolas, monospace; font-size: 11px;
  }
  .dir-toggle {
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer; padding: 0; display: inline-flex; align-items: center; gap: 6px;
    font-size: 11px;
  }
  .dir-toggle:hover { color: var(--fg); }
  .caret { font-size: 9px; width: 10px; }
</style>
