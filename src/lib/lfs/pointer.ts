// Reads Git LFS pointer files out of a diff. A pointer is the three-line text
// git stores in place of a large file: version, oid, size. The diff viewer shows
// a card for it instead of the raw lines. Spec: docs/specs/git-lfs.md.

import type { FileDiff, LineKind } from "$lib/ipc";
import { formatSize } from "$lib/lfs/size";

export const LFS_VERSION_LINE = "version https://git-lfs.github.com/spec/v1";

const OID_RE = /^oid sha256:([0-9a-f]{64})$/;
const SIZE_RE = /^size (\d+)$/;

/** Length of the oid shown in the card. Enough to tell two objects apart. */
const SHORT_OID_LENGTH = 12;

export interface LfsPointer { oid: string; size: number; }

/** The pointer on each side of a diff. A null side had no lines (an added or removed file). */
export interface LfsPointerPair { old: LfsPointer | null; new: LfsPointer | null; }

/** Card text: each part reads "old → new" when both sides have a pointer. */
export interface PointerLabel { size: string; oid: string; }

/**
 * The pointer that three lines spell, or null when they are not exactly
 * version, oid, size in that order. WHY exact: a text file with extra lines is
 * not a pointer, and showing a card would hide its content.
 */
export function parsePointer(lines: readonly string[]): LfsPointer | null {
  if (lines.length !== 3) return null;
  const [version, oidLine, sizeLine] = lines.map((l) => l.trimEnd());
  if (version !== LFS_VERSION_LINE) return null;
  const oid = OID_RE.exec(oidLine);
  const size = SIZE_RE.exec(sizeLine);
  if (!oid || !size) return null;
  return { oid: oid[1], size: Number(size[1]) };
}

/**
 * The pointer pair of a file diff, or null when any side with text is not a
 * pointer. A truncated or binary diff is never shown as a card.
 */
export function pointerPairOf(file: FileDiff): LfsPointerPair | null {
  if (file.binary || file.omitted_lines > 0) return null;
  const oldLines = linesOf(file, ["context", "del"]);
  const newLines = linesOf(file, ["context", "add"]);
  if (oldLines.length === 0 && newLines.length === 0) return null;
  const old = oldLines.length > 0 ? parsePointer(oldLines) : null;
  const next = newLines.length > 0 ? parsePointer(newLines) : null;
  if (oldLines.length > 0 && old === null) return null;
  if (newLines.length > 0 && next === null) return null;
  return { old, new: next };
}

/** One side's text: context lines belong to both sides, add to new, del to old. */
function linesOf(file: FileDiff, kinds: readonly LineKind[]): string[] {
  return file.hunks.flatMap((h) =>
    h.lines.filter((l) => kinds.includes(l.kind)).map((l) => l.content),
  );
}

/** The first characters of an oid, as the card shows them. */
export function shortOid(oid: string): string {
  return oid.slice(0, SHORT_OID_LENGTH);
}

/**
 * Card text for a pair: "1.2 MB → 1.5 MB" and "oid abc… → def…" when both
 * sides have a pointer, the one side's text otherwise.
 */
export function describePointer(pair: LfsPointerPair): PointerLabel {
  const sizes = sideTexts(pair, (p) => formatSize(p.size));
  const oids = sideTexts(pair, (p) => shortOid(p.oid));
  return { size: sizes, oid: oids };
}

function sideTexts(pair: LfsPointerPair, text: (p: LfsPointer) => string): string {
  if (pair.old && pair.new) return `${text(pair.old)} → ${text(pair.new)}`;
  const only = pair.old ?? pair.new;
  return only ? text(only) : "";
}
