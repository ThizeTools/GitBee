// Entry point of the interactive rebase. Checks the range the menu chose,
// then mounts the editor on document.body. The editor is not in the root
// modal switch (stores/modals.ts) because that file and +page.svelte are
// shared; the reason is in docs/specs/interactive-rebase.md ("Where it mounts").

import { mount, unmount } from "svelte";
import { get } from "svelte/store";
import RebaseEditor from "$lib/components/rebase/RebaseEditor.svelte";
import { notifyError, notifyInfo } from "$lib/stores/notifications";
import { currentRepo, graph, status } from "$lib/stores/repo";
import { commitsToRebase, entriesFromCommits, hasMergeCommit, hasTrackedChanges } from "./range";
import type { RebaseEntry } from "./types";

interface EditorProps {
  repo: string;
  base: string;
  rows: RebaseEntry[];
}

/** Opens the editor for base..HEAD. Refuses, with a toast, what the backend
 * would refuse too: a dirty worktree, or a merge commit in the range. The
 * backend checks again when the list is started. */
export function openInteractiveRebase(baseSha: string): void {
  const repo = get(currentRepo);
  const g = get(graph);
  if (!repo || !g || !g.head_sha) return;
  if (hasTrackedChanges(get(status))) {
    notifyError("Commit or stash your changes first", "An interactive rebase needs a clean worktree.");
    return;
  }
  const commits = commitsToRebase(g.nodes, g.head_sha, baseSha);
  if (commits.length === 0) {
    notifyInfo("Nothing to rebase", "No commits sit above that one.");
    return;
  }
  if (hasMergeCommit(commits)) {
    notifyError("Merge commit in range", "Interactive rebase cannot replay merge commits.");
    return;
  }
  mountEditor({ repo, base: baseSha, rows: entriesFromCommits(commits) });
}

/** Mounts the editor in its own host element and unmounts it on close. The
 * flag makes a second close (a click racing the Start result) a no-op. */
function mountEditor(props: EditorProps): void {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let app: Record<string, unknown> | null = null;
  let closed = false;
  const onClose = (): void => {
    if (closed) return;
    closed = true;
    if (app) void unmount(app);
    host.remove();
  };
  app = mount(RebaseEditor, { target: host, props: { ...props, onClose } });
}
