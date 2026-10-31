// Files of the selected commit, for the "/" file list. No backend command lists
// tracked files, so the palette offers changed files plus these. A failed read
// returns an empty list: the palette still works without this part.

import { ipc } from "$lib/ipc";

export async function loadCommitFiles(repo: string, sha: string): Promise<string[]> {
  try {
    const files = await ipc.commitFiles(repo, sha);
    return files.map((f) => f.path);
  } catch {
    return [];
  }
}
