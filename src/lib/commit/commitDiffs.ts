// The app-wide cache of per-file commit diffs. Shared by every commit details
// panel, so a file expanded once stays loaded while the user moves between
// commits. 200 entries bound memory: each diff is capped at 5000 lines.
import { ipc } from "$lib/ipc";
import { DiffCache } from "./diffCache";

export const commitDiffCache = new DiffCache(
  (k) => ipc.diffCommit(k.repo, k.sha, k.file, k.ignoreWs, k.oldFile),
  200,
);
