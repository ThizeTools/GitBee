<script lang="ts">
  import type { StatusEntry } from "$lib/ipc";

  interface Props {
    files: StatusEntry[];
    side: "index" | "worktree";
    selected: string | null;
    /** Optional. When omitted, FileTree falls back to onSelect(path) for
     *  back-compat with callers that don't care about the click event. */
    onSelect?: (path: string) => void;
    /** Modern click handler — receives the MouseEvent so the parent can
     *  branch on Ctrl/Shift for multi-selection. Takes precedence over
     *  onSelect when both are supplied. */
    onClick?: (path: string, e: MouseEvent) => void;
    onAction?: (path: string, action: "stage" | "unstage" | "discard") => void;
    actionLabel?: "stage" | "unstage";
    /** Multi-select highlight set; rows whose path is in the set get the
     *  "multi-selected" visual. */
    selectionSet?: Set<string>;
    /** Folder-level batch action — passes every leaf path under the
     *  folder. Parent decides which IPC call to make. */
    onFolderAction?: (paths: string[], action: "stage" | "unstage") => void;
    /** When the file row is part of a multi-selection, the parent can
     *  return the batch path list here — the hover button will then act
     *  on every selected file instead of just the clicked one. Returning
     *  null means "act on this single file". */
    batchTargets?: (path: string) => string[] | null;
    /** Hover-button label override. Lets the parent show "Stage 5 Files"
     *  instead of "Stage File" when a multi-selection is active. */
    batchLabel?: (path: string) => string;
    /** Sort direction — folders always come first; only the alphabetical
     *  order inside each group flips. Defaults to ascending. */
    sortMode?: "asc" | "desc";
  }

  let {
    files, side, selected,
    onSelect, onClick,
    onAction, actionLabel,
    selectionSet, onFolderAction,
    batchTargets, batchLabel,
    sortMode = "asc",
  }: Props = $props();

  function rowClick(p: string, e: MouseEvent) {
    if (onClick) onClick(p, e);
    else onSelect?.(p);
  }

  // Collect every file path under a folder node — used by the
  // "Stage Folder" / "Unstage Folder" hover button on dir rows.
  function collectLeaves(n: TreeNode, out: string[]) {
    if (n.file) { out.push(n.file.path); return; }
    for (const c of n.children.values()) collectLeaves(c, out);
  }
  function folderPaths(n: TreeNode): string[] {
    const out: string[] = [];
    collectLeaves(n, out);
    return out;
  }
  function fileBtnLabel(p: string): string {
    return batchLabel ? batchLabel(p) : (actionLabel === "stage" ? "Stage File" : "Unstage File");
  }
  function onFileBtnClick(p: string) {
    const targets = batchTargets ? batchTargets(p) : null;
    if (targets && onFolderAction && actionLabel) {
      onFolderAction(targets, actionLabel);
    } else if (onAction && actionLabel) {
      onAction(p, actionLabel);
    }
  }

  type TreeNode = {
    name: string;
    path: string;
    file?: StatusEntry;
    children: Map<string, TreeNode>;
  };

  const root = $derived.by<TreeNode>(() => {
    const r: TreeNode = { name: "", path: "", children: new Map() };
    for (const f of files) {
      const parts = f.path.split("/").filter(Boolean);
      let cur = r;
      for (let i = 0; i < parts.length; i++) {
        const isLeaf = i === parts.length - 1;
        const seg = parts[i];
        let child = cur.children.get(seg);
        if (!child) {
          child = {
            name: seg,
            path: parts.slice(0, i + 1).join("/"),
            children: new Map(),
          };
          cur.children.set(seg, child);
        }
        if (isLeaf) child.file = f;
        cur = child;
      }
    }
    return r;
  });

  let collapsed = $state<Record<string, boolean>>({});
  function toggle(path: string) { collapsed[path] = !collapsed[path]; }

  // Directories first, then files — alphabetical inside each group with
  // direction driven by the parent-supplied sortMode prop.
  function sortedChildren(n: TreeNode): TreeNode[] {
    return [...n.children.values()].sort((a, b) => {
      const aIsDir = !a.file;
      const bIsDir = !b.file;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return sortMode === "asc"
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name);
    });
  }

  // Glyph indicators — match StagingArea so both list views read the same.
  function statusChar(s: StatusEntry): string {
    const v = side === "index" ? s.index : s.worktree;
    switch (v) {
      case "modified": return "●";
      case "added": return "+";
      case "deleted": return "−";
      case "renamed": return "→";
      case "copied": return "⎘";
      case "untracked": return "+";
      case "ignored": return "·";
      case "conflicted": return "!";
      default: return " ";
    }
  }
  function statusTitle(s: StatusEntry): string {
    const v = side === "index" ? s.index : s.worktree;
    switch (v) {
      case "modified": return "Modified";
      case "added": return "Added (new file)";
      case "deleted": return "Deleted";
      case "renamed": return "Renamed";
      case "copied": return "Copied";
      case "untracked": return "New file (untracked)";
      case "ignored": return "Ignored";
      case "conflicted": return "Conflicted";
      default: return "";
    }
  }

  function statusKind(s: StatusEntry): string {
    return side === "index" ? s.index : s.worktree;
  }
</script>

{#snippet treeNode(node: TreeNode, depth: number)}
  {#if node.file}
    <li class="file"
        class:active={selected === node.file.path}
        class:multi-selected={selectionSet?.has(node.file.path)}>
      <button
        class="row"
        style="padding-left: {12 + depth * 14}px"
        onclick={(e) => rowClick(node.file!.path, e)}
      >
        <span class="status {statusKind(node.file)}" title={statusTitle(node.file)}>{statusChar(node.file)}</span>
        <span class="name {statusKind(node.file)}">{node.name}</span>
      </button>
      {#if onAction && actionLabel}
        <button
          class="hover-btn {actionLabel}"
          onclick={() => onFileBtnClick(node.file!.path)}
          title={fileBtnLabel(node.file!.path)}
        >{fileBtnLabel(node.file!.path)}</button>
      {/if}
    </li>
  {:else}
    <li class="dir">
      <button
        class="row dir-row"
        style="padding-left: {12 + depth * 14}px"
        onclick={() => toggle(node.path)}
      >
        <span class="caret">{collapsed[node.path] ? "▶" : "▼"}</span>
        <span class="name">{node.name}/</span>
      </button>
      {#if onFolderAction && actionLabel}
        <button
          class="hover-btn {actionLabel}"
          onclick={(e) => { e.stopPropagation(); onFolderAction!(folderPaths(node), actionLabel!); }}
          title={actionLabel === "stage" ? "Stage Folder" : "Unstage Folder"}
        >{actionLabel === "stage" ? "Stage Folder" : "Unstage Folder"}</button>
      {/if}
    </li>
    {#if !collapsed[node.path]}
      {#each sortedChildren(node) as child (child.path)}
        {@render treeNode(child, depth + 1)}
      {/each}
    {/if}
  {/if}
{/snippet}

<ul class="tree">
  {#each sortedChildren(root) as child (child.path)}
    {@render treeNode(child, 0)}
  {/each}
</ul>

<style>
  .tree {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .file, .dir { display: flex; align-items: center; position: relative; }
  .row {
    flex: 1;
    background: transparent;
    border: 0;
    color: var(--fg);
    text-align: left;
    padding: 4px 8px;
    cursor: pointer;
    display: flex;
    gap: 8px;
    align-items: center;
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 12px;
    overflow: hidden;
    min-width: 0;
  }
  .row:hover { background: rgba(255,255,255,0.04); }
  .file.active .row { background: color-mix(in srgb, var(--renamed) 32%, transparent); }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .caret { width: 10px; color: var(--fg-muted); font-size: 9px; flex-shrink: 0; }
  .dir-row .name { color: var(--fg-muted); }
  .status {
    display: inline-block;
    width: 12px;
    text-align: center;
    font-weight: 700;
    font-size: 12px;
    line-height: 14px;
    flex-shrink: 0;
  }
  .status.modified, .name.modified   { color: var(--modified); }
  .status.added,    .name.added,
  .status.untracked, .name.untracked { color: var(--add, var(--accent)); }
  .status.deleted,  .name.deleted    { color: var(--del); }
  .status.renamed,  .name.renamed,
  .status.copied,   .name.copied     { color: var(--renamed); }
  .status.conflicted, .name.conflicted { color: var(--del); font-weight: 700; }
  .name.deleted { text-decoration: line-through; text-decoration-thickness: 1px; }
  /* Single-button hover affordance — same pattern as the Path-mode list
     in StagingArea so the two views feel identical. */
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
  .file:hover .hover-btn,
  .dir:hover .hover-btn { opacity: 1; pointer-events: auto; }
  .file:hover .hover-btn.stage,
  .dir:hover .hover-btn.stage { color: var(--accent); border-color: var(--accent); }
  .file:hover .hover-btn.stage:hover,
  .dir:hover .hover-btn.stage:hover { background: var(--accent); color: var(--bg); }
  .file:hover .hover-btn.unstage,
  .dir:hover .hover-btn.unstage { color: var(--del); border-color: var(--del); }
  .file:hover .hover-btn.unstage:hover,
  .dir:hover .hover-btn.unstage:hover { background: var(--del); color: var(--bg); }
  .file.multi-selected { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .file.multi-selected.active .row { background: color-mix(in srgb, var(--renamed) 32%, transparent); }
</style>
