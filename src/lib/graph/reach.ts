// Ancestry of a ref tip within the loaded graph, for the ref-hover highlight.
// Pure and iterative: deep histories would overflow a recursive walk.
import type { GraphNode } from "$lib/ipc";

// Every loaded commit reachable from `startSha` by following ALL parents,
// the start included. A parent outside `nodes` (beyond the load limit or
// filtered out) ends that branch of the walk. A start sha that is not loaded
// yields an empty set.
export function reachableFrom(startSha: string, nodes: readonly GraphNode[]): Set<string> {
  const bySha = new Map<string, GraphNode>();
  for (const n of nodes) bySha.set(n.sha, n);
  const out = new Set<string>();
  if (!bySha.has(startSha)) return out;
  const stack: string[] = [startSha];
  while (stack.length > 0) {
    const sha = stack.pop() as string;
    if (out.has(sha)) continue;
    out.add(sha);
    for (const parent of bySha.get(sha)?.parents ?? []) {
      if (bySha.has(parent) && !out.has(parent)) stack.push(parent);
    }
  }
  return out;
}

// The set the highlight uses: null when there is nothing to highlight, so
// the renderer and rows can treat "no highlight" and "not loaded" the same.
export function highlightFor(startSha: string, nodes: readonly GraphNode[]): ReadonlySet<string> | null {
  const set = reachableFrom(startSha, nodes);
  return set.size > 0 ? set : null;
}
