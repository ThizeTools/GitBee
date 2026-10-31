// Builds the patch for a hunk or for picked +/- lines. The patch carries only
// the picked changes, so applying it stages, unstages or discards exactly what
// the user chose. Pure: no I/O, so bun test covers it. Spec: docs/specs/hunk-staging.md.

import type { DiffLine, FileDiff, Hunk, LineKind } from "$lib/ipc";

/** One +/- line of a file diff. `line` indexes `hunks[hunk].lines`. */
export interface LineRef {
  hunk: number;
  line: number;
}

/** What the patch keeps: one whole hunk, or the picked +/- lines. */
export type PatchSelection =
  | { kind: "hunk"; hunkIndex: number }
  | { kind: "lines"; lines: readonly LineRef[] };

/** The mark that opens a body line of a patch. */
type Mark = " " | "-" | "+";

/** One hunk after selection: its body lines and the counts its header needs. */
interface EmittedHunk {
  body: string[];
  oldCount: number;
  newCount: number;
  /** True when a picked +/- line made it into the body. */
  changed: boolean;
}

const NO_PICKS: ReadonlySet<number> = new Set();

/** True for an added or removed line, the only lines a user can pick. */
export function isChangeLine(line: DiffLine): boolean {
  return line.kind === "add" || line.kind === "del";
}

/**
 * Builds a patch from `file` that holds only the selected changes, or null when
 * no selected line is a change. `reverse` marks a patch for `git apply --reverse`
 * (unstage, discard). Then an unselected addition stays as context, because the
 * target already has it, and an unselected removal is dropped. A forward patch
 * (stage) does the opposite. Usage: buildPatch(file, { kind: "hunk", hunkIndex: 0 })
 * is the patch for "Stage this hunk".
 */
export function buildPatch(
  file: FileDiff,
  selection: PatchSelection,
  reverse = false,
): string | null {
  const picks = pickedByHunk(file, selection);
  const lines: string[] = [];
  let delta = 0;
  file.hunks.forEach((hunk, h) => {
    const emitted = emitHunk(hunk, picks.get(h) ?? NO_PICKS, reverse);
    if (!emitted.changed) return;
    if (sealedThenChanged(emitted.body)) {
      throw new Error(`cannot build a patch for ${file.new_path || file.old_path}: `
        + "a context line at the end of the file has no newline, so changes after it cannot be applied. Pick the whole hunk.");
    }
    lines.push(headerLine(hunk, emitted, delta), ...emitted.body);
    delta += emitted.newCount - emitted.oldCount;
  });
  if (lines.length === 0) return null;
  return [...fileHeader(file), ...lines].map((l) => `${l}\n`).join("");
}

/** Picked line indexes per hunk. A whole-hunk selection picks every +/- line of that hunk. */
function pickedByHunk(file: FileDiff, selection: PatchSelection): Map<number, Set<number>> {
  const picks = new Map<number, Set<number>>();
  if (selection.kind === "hunk") {
    const hunk = file.hunks[selection.hunkIndex];
    if (hunk) picks.set(selection.hunkIndex, new Set(changeIndexes(hunk)));
    return picks;
  }
  for (const ref of selection.lines) {
    const set = picks.get(ref.hunk) ?? new Set<number>();
    set.add(ref.line);
    picks.set(ref.hunk, set);
  }
  return picks;
}

function changeIndexes(hunk: Hunk): number[] {
  return hunk.lines.flatMap((line, i) => (isChangeLine(line) ? [i] : []));
}

/** Body of one hunk: unselected changes become context or disappear, and each
 * "\ No newline" marker follows the line it belongs to, only when that line stayed. */
function emitHunk(hunk: Hunk, picked: ReadonlySet<number>, reverse: boolean): EmittedHunk {
  const out: EmittedHunk = { body: [], oldCount: 0, newCount: 0, changed: false };
  let keptPrevious = false;
  hunk.lines.forEach((line, i) => {
    if (line.kind === "nonewline") {
      if (keptPrevious) out.body.push(`\\${line.content}`);
      return;
    }
    const isPicked = picked.has(i) && isChangeLine(line);
    const mark = markFor(line, isPicked, reverse);
    keptPrevious = mark !== null;
    if (mark === null) return;
    out.body.push(`${mark}${line.content}`);
    if (mark !== "+") out.oldCount += 1;
    if (mark !== "-") out.newCount += 1;
    if (isPicked) out.changed = true;
  });
  return out;
}

/** The mark for one body line, or null when the line is left out. Context always
 * stays. A picked change keeps its own mark. An unpicked change is context when
 * its kind is the one the target still holds, and dropped otherwise. */
function markFor(line: DiffLine, picked: boolean, reverse: boolean): Mark | null {
  if (line.kind === "context") return " ";
  if (picked) return line.kind === "add" ? "+" : "-";
  const keptKind: LineKind = reverse ? "add" : "del";
  return line.kind === keptKind ? " " : null;
}

/** The `@@` line. The old start keeps the file's own numbering. The new start shifts
 * by the net change of the hunks emitted before it, so the patch reads as one edit.
 * A side with no lines names the line before the insertion, which is git's `,0` form. */
function headerLine(hunk: Hunk, emitted: EmittedHunk, delta: number): string {
  const before = hunk.old_lines > 0 ? hunk.old_start - 1 : hunk.old_start;
  const oldStart = emitted.oldCount > 0 ? before + 1 : before;
  const newBefore = before + delta;
  const newStart = emitted.newCount > 0 ? newBefore + 1 : newBefore;
  return `@@ -${oldStart},${emitted.oldCount} +${newStart},${emitted.newCount} @@`;
}

/** True when a kept context line ends the file and a change follows it. A
 * "\ No newline" marker says its line is the last of the file, so no patch can
 * place a change after it. Applying one would silently join two lines. */
function sealedThenChanged(body: readonly string[]): boolean {
  const marker = body.findIndex((l, i) => l.startsWith("\\") && i > 0 && body[i - 1].startsWith(" "));
  return marker >= 0 && body.slice(marker + 1).some((l) => l.startsWith("+") || l.startsWith("-"));
}

/** The `diff --git`, `---` and `+++` lines. Both sides keep the real path, even
 * for an added or deleted file. `/dev/null` would make `git apply --reverse`
 * read a partial unstage as a whole-file deletion, and that empties the index
 * entry. Git only needs the file to exist on the side it patches. */
function fileHeader(file: FileDiff): string[] {
  const oldName = file.old_path || file.new_path;
  const newName = file.new_path || file.old_path;
  return [
    `diff --git a/${oldName} b/${newName}`,
    `--- ${sideName("a", oldName)}`,
    `+++ ${sideName("b", newName)}`,
  ];
}

/** A path with a space ends in a tab, the way git writes it, so git reads the whole name. */
function sideName(prefix: "a" | "b", path: string): string {
  return path.includes(" ") ? `${prefix}/${path}\t` : `${prefix}/${path}`;
}
