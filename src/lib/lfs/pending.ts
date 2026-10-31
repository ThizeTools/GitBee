// Batching for the LFS path checks. Paths asked for while a repo's status is
// still loading wait in the queue. Each debounce window then sends one
// lfs_files call per repo, not one per staging row. Spec: docs/specs/git-lfs.md.

/** Paths still to check, per repo path. A Set keeps each path once. */
export type PendingPaths = Map<string, Set<string>>;

/** One lfs_files call: the repo and the paths to ask about. */
export interface PathBatch { repo: string; paths: string[]; }

/**
 * Queues the paths of one repo. `isKnown` skips paths whose answer is already
 * cached, so a repaint does not ask git again. Refreshes pass `() => false`
 * because the cached answers may be stale.
 */
export function queuePaths(
  pending: PendingPaths,
  repo: string,
  paths: readonly string[],
  isKnown: (path: string) => boolean,
): void {
  const queue = pending.get(repo) ?? new Set<string>();
  for (const path of paths) {
    if (!isKnown(path)) queue.add(path);
  }
  if (queue.size > 0) pending.set(repo, queue);
}

/**
 * Removes and returns the batches whose repo is ready. A repo that is not
 * ready yet (its status still loads) keeps its queue for the next flush.
 */
export function takeReadyBatches(
  pending: PendingPaths,
  isReady: (repo: string) => boolean,
): PathBatch[] {
  const batches: PathBatch[] = [];
  for (const [repo, paths] of pending) {
    if (!isReady(repo)) continue;
    batches.push({ repo, paths: [...paths] });
    pending.delete(repo);
  }
  return batches;
}
