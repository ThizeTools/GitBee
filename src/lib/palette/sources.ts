// Turns the app's store values into the plain PaletteSources the providers read.
// Keeping this step pure means the filtering rules (HEAD refs skipped, WIP row
// dropped, duplicate files merged) are covered by tests without a Svelte runtime.

import type { CommitRef, GraphNode } from "$lib/ipc";
import type { GraphCol } from "$lib/graph/columns";
import type { Theme } from "$lib/stores/ui";
import { WIP_SHA } from "$lib/stores/repoState";

export interface BranchRef {
  name: string;
  kind: "local" | "remote";
}

export interface CommitRow {
  sha: string;
  subject: string;
}

// The flags the view actions read to pick "Show" or "Hide" wording.
export interface PaletteLayout {
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  dimMergeCommits: boolean;
  hiddenCols: readonly GraphCol[];
}

export interface PaletteSources {
  repoOpen: boolean;
  branches: readonly BranchRef[];
  recentRepos: readonly string[];
  files: readonly string[];
  commits: readonly CommitRow[];
  themes: readonly Theme[];
  activeThemeId: string;
  layout: PaletteLayout;
  undoLabel: string | null;
  redoLabel: string | null;
}

export interface PaletteStoreSnapshot {
  repoOpen: boolean;
  refs: readonly CommitRef[];
  recentPaths: readonly string[];
  changedPaths: readonly string[];
  committedPaths: readonly string[];
  commits: readonly Pick<GraphNode, "sha" | "subject">[];
  themes: readonly Theme[];
  activeThemeId: string;
  layout: PaletteLayout;
  undoLabel: string | null;
  redoLabel: string | null;
}

/**
 * Local branches plus remote-tracking branches. `origin/HEAD` is a symbolic
 * alias of a branch already listed, so it would only duplicate a row.
 */
export function branchesOf(refs: readonly CommitRef[]): BranchRef[] {
  const out: BranchRef[] = [];
  for (const ref of refs) {
    if (ref.kind === "localbranch") out.push({ name: ref.name, kind: "local" });
    else if (ref.kind === "remotebranch" && !ref.name.endsWith("/HEAD")) {
      out.push({ name: ref.name, kind: "remote" });
    }
  }
  return out;
}

/** Working-tree changes first, then the selected commit's files, each path once. */
export function uniqueFiles(changed: readonly string[], committed: readonly string[]): string[] {
  return [...new Set([...changed, ...committed])];
}

/** Graph rows as palette rows. The WIP pseudo-row has no commit to jump to, so it is dropped. */
export function commitRows(nodes: readonly Pick<GraphNode, "sha" | "subject">[]): CommitRow[] {
  return nodes
    .filter((n) => n.sha !== WIP_SHA)
    .map((n) => ({ sha: n.sha, subject: n.subject }));
}

export function buildSources(snap: PaletteStoreSnapshot): PaletteSources {
  return {
    repoOpen: snap.repoOpen,
    branches: snap.repoOpen ? branchesOf(snap.refs) : [],
    recentRepos: snap.recentPaths,
    files: snap.repoOpen ? uniqueFiles(snap.changedPaths, snap.committedPaths) : [],
    commits: snap.repoOpen ? commitRows(snap.commits) : [],
    themes: snap.themes,
    activeThemeId: snap.activeThemeId,
    layout: snap.layout,
    undoLabel: snap.undoLabel,
    redoLabel: snap.redoLabel,
  };
}
