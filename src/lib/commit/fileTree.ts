// Ordering and tree shape for a commit's file list. Pure, so the list, the
// keyboard navigation order and the tests all agree on one order.
import type { CommitFileStat } from "$lib/ipc";

export type SortMode = "asc" | "desc";
export type ViewMode = "path" | "tree";

export interface TreeNode {
  name: string;
  path: string;
  /** Set on leaves only: the file this node stands for. */
  file?: CommitFileStat;
  children: Map<string, TreeNode>;
}

/**
 * Nests the files by path segment. A file's node is the leaf of its path.
 * Usage: buildTree([{ path: "src/a.ts", … }]) has one child "src" holding "a.ts".
 */
export function buildTree(files: CommitFileStat[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map() };
  for (const f of files) insertFile(root, f);
  return root;
}

function insertFile(root: TreeNode, f: CommitFileStat): void {
  const parts = f.path.split("/").filter(Boolean);
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    let child = cur.children.get(seg);
    if (!child) {
      child = { name: seg, path: parts.slice(0, i + 1).join("/"), children: new Map() };
      cur.children.set(seg, child);
    }
    if (i === parts.length - 1) child.file = f;
    cur = child;
  }
}

/**
 * Directories first, then files. Within each group the names sort A→Z or
 * Z→A, following the toolbar toggle.
 */
export function sortedChildren(n: TreeNode, sort: SortMode): TreeNode[] {
  return [...n.children.values()].sort((a, b) => {
    const aIsDir = !a.file;
    const bIsDir = !b.file;
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return sort === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
  });
}

/** Files ordered by full path, A→Z or Z→A. Used by the Path view. */
export function sortFilesByPath(files: CommitFileStat[], sort: SortMode): CommitFileStat[] {
  const arr = files.slice();
  arr.sort((a, b) => (sort === "asc" ? a.path.localeCompare(b.path) : b.path.localeCompare(a.path)));
  return arr;
}

/**
 * Depth-first walk of the tree in the order the Tree view renders it,
 * collapsed directories included: keyboard navigation has always walked every
 * file.
 */
export function flattenTree(root: TreeNode, sort: SortMode): CommitFileStat[] {
  const out: CommitFileStat[] = [];
  const walk = (n: TreeNode): void => {
    if (n.file) {
      out.push(n.file);
      return;
    }
    for (const ch of sortedChildren(n, sort)) walk(ch);
  };
  for (const ch of sortedChildren(root, sort)) walk(ch);
  return out;
}

/**
 * The files in the order the list shows them. ArrowUp/Down and "first N"
 * requests must follow the same order, or they pick the wrong rows.
 */
export function listOrder(files: CommitFileStat[], view: ViewMode, sort: SortMode): CommitFileStat[] {
  if (view === "path") return sortFilesByPath(files, sort);
  return flattenTree(buildTree(files), sort);
}
