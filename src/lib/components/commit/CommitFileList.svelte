<script lang="ts">
  // The commit's file list, as a Path list or a nested Tree. A row's toggle
  // shows that file's diff below the list. A click on the row opens the file
  // in the center diff. The panel owns the requested set and the sort/view
  // state, so keyboard navigation sees the same order this list draws.
  import type { CommitFileStat } from "$lib/ipc";
  import { sortedChildren, type SortMode, type TreeNode, type ViewMode } from "$lib/commit/fileTree";
  import { changeCountLabel, statusColor, statusName } from "$lib/commit/fileStatus";
  import { currentRepo } from "$lib/stores/repo";
  import { currentLfsFlags, requestLfsPaths } from "$lib/stores/lfs";
  import LfsBadge from "$lib/components/lfs/LfsBadge.svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import { commitStatusIcon } from "./commitStatusIcon";

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

  // LFS flags of the listed files. The answers are cached per repo, so a commit
  // seen before asks git nothing (docs/specs/git-lfs.md).
  const lfsFlags = $derived($currentLfsFlags);
  $effect(() => {
    if ($currentRepo) requestLfsPaths($currentRepo, pathRows.map((f) => f.path));
  });

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
      aria-label={requested[f.path] ? "Hide diff" : "Show diff"}
      onclick={() => onToggleDiff(f.path)}>
      <Icon name={requested[f.path] ? "chevron-down" : "chevron-right"} size={14} />
    </button>
    <button class="file-btn" type="button"
      class:nav-current={navPath === f.path}
      onclick={() => onOpen(f.path)}>
      <span class="f-ico" style="color: {statusColor(f.status)}" title={statusName(f.status)}>
        <Icon name={commitStatusIcon(f.status)} size={16} />
      </span>
      <span class="f-count">{changeCountLabel(f)}</span>
      <span class="f-path">{label}</span>
      {#if lfsFlags[f.path]}<LfsBadge />{/if}
    </button>
  </li>
{/snippet}

{#snippet treeNode(node: TreeNode, depth: number)}
  {#if node.file}
    {@render fileRow(node.file, node.name, 12 + depth * 14)}
  {:else}
    <li class="dir" style="padding-left: {12 + depth * 14}px">
      <button class="dir-toggle" onclick={() => toggleDir(node.path)}>
        <Icon name={collapsed[node.path] ? "chevron-right" : "chevron-down"} size={14} />
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
    display: flex; align-items: center; gap: var(--sp-6);
    padding: var(--sp-4) var(--sp-8);
    border-bottom: 1px solid var(--border);
    background: transparent;
  }
  .link {
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer; font-size: var(--fs-sm);
  }
  .link:hover { color: var(--fg); text-decoration: underline; }
  .load-all { margin-left: auto; color: var(--accent); }

  .tree, .flat { list-style: none; margin: 0; padding: 0; }
  .file, .dir {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 0;
    font-size: var(--fs-sm);
    color: var(--fg);
  }
  .file { height: var(--h-row); }
  .dir { height: var(--h-row); padding-right: var(--sp-6); }
  .diff-toggle {
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer; padding: 0; width: var(--h-row); height: 100%; flex-shrink: 0;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .diff-toggle:hover { color: var(--fg); }
  .file-btn {
    display: flex; align-items: center; gap: var(--sp-4);
    flex: 1; min-width: 0; height: 100%;
    padding: 0 var(--sp-6) 0 0;
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
  .f-ico { display: inline-flex; align-items: center; flex-shrink: 0; }
  .f-count { color: var(--fg-muted); font-size: var(--fs-xs); min-width: var(--sp-8); }
  .f-path {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: "Cascadia Code", Consolas, monospace; font-size: var(--fs-sm);
  }
  .dir-toggle {
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer; padding: 0; height: 100%;
    display: inline-flex; align-items: center; gap: var(--sp-3);
    font-size: var(--fs-sm);
  }
  .dir-toggle:hover { color: var(--fg); }
</style>
