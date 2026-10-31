// "LFS: ..." rows, offered only when git-lfs is installed for the open repo.
// Each row reads the repo when it runs, as the repo actions do. Runs go through
// runAction so they log and toast like the menus. Spec: docs/specs/git-lfs.md.

import { get } from "svelte/store";
import { ipc, type LfsInfo } from "$lib/ipc";
import { currentRepo } from "$lib/stores/repoState";
import { currentLfs, refreshLfs } from "$lib/stores/lfs";
import { choiceDialog, promptDialog } from "$lib/stores/dialog";
import { notifyError, notifyInfo, notifySuccess } from "$lib/stores/notifications";
import { runAction } from "$lib/menus/menuActions";
import { patternError } from "$lib/lfs/pattern";
import type { PaletteItem } from "$lib/palette/types";

/** Runs one LFS git call with a toast. Actions that change which files are LFS refresh the repo's state. */
async function runLfs(
  repo: string,
  label: string,
  op: () => Promise<unknown>,
  changesLfs: boolean,
): Promise<void> {
  const r = await runAction(label, op);
  if (!r.ok) {
    notifyError(`${label} failed`, r.error);
    return;
  }
  notifySuccess(`${label} done`);
  if (changesLfs) await refreshLfs(repo);
}

/** Runs `fn` with the repo open now, not the one open when the palette opened. */
async function onRepo(fn: (repo: string) => Promise<void>): Promise<void> {
  const repo = get(currentRepo);
  if (repo !== null) await fn(repo);
}

async function trackPattern(repo: string): Promise<void> {
  const typed = await promptDialog({
    title: "Track pattern:",
    placeholder: "*.psd",
    confirmLabel: "Track",
    validate: patternError,
  });
  if (typed === null) return;
  const pattern = typed.trim();
  await runLfs(repo, `LFS track ${pattern}`, () => ipc.lfsTrack(repo, pattern), true);
}

async function untrackPattern(repo: string): Promise<void> {
  const patterns = get(currentLfs)?.patterns ?? [];
  if (patterns.length === 0) {
    notifyInfo("Nothing to untrack", "No LFS pattern in .gitattributes");
    return;
  }
  const pattern = await choiceDialog<string>({
    title: "Untrack pattern:",
    choices: patterns.map((p) => ({ label: p, value: p })),
  });
  if (pattern === null) return;
  await runLfs(repo, `LFS untrack ${pattern}`, () => ipc.lfsUntrack(repo, pattern), true);
}

function lfsRow(key: string, title: string, run: () => Promise<void>): PaletteItem {
  return { id: `lfs:${key}`, title, category: "LFS", run };
}

/** The LFS rows for one repo's status. Empty when git-lfs is missing, so no row is offered that cannot run. */
export function lfsItemsFor(info: LfsInfo | null): PaletteItem[] {
  if (info === null || !info.installed) return [];
  return [
    lfsRow("pull", "LFS: Pull", () =>
      onRepo((r) => runLfs(r, "LFS pull", () => ipc.lfsPull(r), false))),
    lfsRow("fetch", "LFS: Fetch", () =>
      onRepo((r) => runLfs(r, "LFS fetch", () => ipc.lfsFetch(r), false))),
    lfsRow("track", "LFS: Track pattern…", () => onRepo(trackPattern)),
    lfsRow("untrack", "LFS: Untrack pattern…", () => onRepo(untrackPattern)),
    lfsRow("install", "LFS: Install hooks in this repo", () =>
      onRepo((r) => runLfs(r, "LFS install hooks", () => ipc.lfsInstall(r), true))),
  ];
}

/** The LFS rows for the open repo, read at the time the palette collects its rows. */
export function lfsItems(): PaletteItem[] {
  return lfsItemsFor(get(currentLfs));
}
