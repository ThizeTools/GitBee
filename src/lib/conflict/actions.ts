import { get } from "svelte/store";
import { ipc } from "$lib/ipc";
import { currentRepo, withBusy } from "$lib/stores/repo";
import { alertDialog, confirmDialog } from "$lib/stores/dialog";
import { logAppend } from "$lib/stores/logs";
import { hasMarkers } from "./parse";

// Repo-bound conflict actions. Each reads the open repo at call time, the same
// way the staging file actions do, so a click after a tab switch acts on the
// tab that is open at that moment.

/** Overwrites a conflicted file with one whole side, then stages it. Asks
 * first because the working-tree file, including hand edits, is replaced. */
export async function takeSide(
  file: string,
  side: "ours" | "theirs",
  sideName: string,
): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  const ok = await confirmDialog({
    title: `Take ${sideName.toLowerCase()} for ${file}?`,
    message: "The file in the working tree is replaced. Hand edits in it are lost.",
    confirmLabel: "Take",
    danger: true,
  });
  if (!ok) return;
  await withBusy(() => ipc.conflictTakeSide(repo, file, side));
}

/** Stages a file as resolved. Refuses while the file still has conflict
 * markers, because `git add` would stage them as content. A file that is gone
 * from disk (delete conflict) reads as empty and is allowed through. */
export async function markResolved(file: string): Promise<void> {
  const repo = get(currentRepo);
  if (!repo) return;
  const text = await ipc.fileRead(repo, file).catch(() => "");
  if (hasMarkers(text)) {
    await alertDialog({
      title: `${file} still has conflict markers`,
      message: "Resolve every block in the conflict editor first. Marking the file resolved would stage the markers.",
    });
    return;
  }
  await withBusy(() => ipc.markResolved(repo, file));
}

/** Writes the resolved text, then stages the file. Returns true only when both
 * steps succeeded. Refuses marker text again here, the last guard before disk. */
export async function saveResolution(file: string, text: string): Promise<boolean> {
  const repo = get(currentRepo);
  if (!repo) return false;
  if (hasMarkers(text)) {
    logAppend("error", `save refused: ${file} still contains conflict markers`);
    return false;
  }
  const done = await withBusy(async () => {
    await ipc.fileWrite(repo, file, text);
    await ipc.markResolved(repo, file);
    return true;
  });
  return done === true;
}
