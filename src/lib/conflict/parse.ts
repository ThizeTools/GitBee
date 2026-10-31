// Splits a conflicted worktree file into plain text and git conflict blocks,
// then rebuilds the file from a choice per block. Pure text in, text out, so the
// editor and the tests share one implementation. See docs/specs/conflict-resolution.md.

/** One `<<<<<<<` ... `>>>>>>>` region. Side lines carry no line terminator. */
export interface ConflictBlock {
  kind: "conflict";
  ours: string[];
  /** Only in diff3/zdiff3 output (the `|||||||` section). Every choice drops it. */
  base: string[] | null;
  theirs: string[];
  /** Text after `<<<<<<< ` (usually a branch name). Empty when git wrote none. */
  oursLabel: string;
  theirsLabel: string;
  /** Original marker and body lines. Re-emitted while the block is undecided,
   * so an unresolved block keeps exactly the markers git wrote. */
  raw: string[];
}

export interface TextSegment {
  kind: "text";
  lines: string[];
}

export type ConflictSegment = TextSegment | ConflictBlock;

export interface ConflictDoc {
  segments: ConflictSegment[];
  /** Blocks in file order. A choice is keyed by its index in this array. */
  conflicts: ConflictBlock[];
  /** Terminator used when rebuilding: the file's dominant one. A file that mixes
   * endings comes back with a single one, because sides are stored as lines. */
  eol: "\n" | "\r\n";
  /** A marker line exists that does not form a complete block. It stays as text. */
  malformed: boolean;
}

/** How one block is resolved. `both` keeps ours then theirs, `bothReverse` the
 * opposite. `custom` replaces the block with hand-typed text. */
export type ConflictChoice =
  | "ours"
  | "theirs"
  | "both"
  | "bothReverse"
  | { custom: string };

interface ParsedBlock {
  block: ConflictBlock;
  next: number;
}

interface Collected {
  body: string[];
  at: number;
}

const START = /^<{7}(?: |$)/;
const BASE = /^\|{7}(?: |$)/;
const SEP = /^={7}\s*$/;
const END = /^>{7}(?: |$)/;
const ANY_MARKER = /^(?:<{7}|\|{7}|>{7})(?: |$)/;

/**
 * Parses every conflict block in `text`. A start marker with no separator or
 * end marker is kept as plain text and sets `malformed`, so nothing is guessed.
 *
 * @example parseConflicts("a\n<<<<<<< H\nx\n=======\ny\n>>>>>>> f\nb\n").conflicts[0].theirs // ["y"]
 */
export function parseConflicts(text: string): ConflictDoc {
  const { segments, malformed } = splitSegments(text.split(/\r?\n/));
  return {
    segments,
    conflicts: segments.filter(isConflict),
    eol: detectEol(text),
    malformed,
  };
}

function splitSegments(lines: string[]): { segments: ConflictSegment[]; malformed: boolean } {
  const segments: ConflictSegment[] = [];
  let plain: string[] = [];
  let malformed = false;
  let i = 0;
  while (i < lines.length) {
    const parsed = START.test(lines[i]) ? readBlock(lines, i) : null;
    if (parsed === null) {
      if (ANY_MARKER.test(lines[i])) malformed = true;
      plain.push(lines[i]);
      i++;
      continue;
    }
    pushText(segments, plain);
    plain = [];
    segments.push(parsed.block);
    i = parsed.next;
  }
  pushText(segments, plain);
  return { segments, malformed };
}

/**
 * Rebuilds the file. Blocks without a choice keep their original markers, so
 * the result still has markers exactly where the user has not decided.
 *
 * @example resolveConflicts(doc, { 0: "ours" }) // the file with block 0 replaced by its ours side
 */
export function resolveConflicts(
  doc: ConflictDoc,
  choices: Record<number, ConflictChoice>,
): string {
  const out: string[] = [];
  let index = 0;
  for (const seg of doc.segments) {
    if (!isConflict(seg)) {
      appendAll(out, seg.lines);
      continue;
    }
    const choice: ConflictChoice | undefined = choices[index];
    appendAll(out, linesForChoice(seg, choice));
    index++;
  }
  return out.join(doc.eol);
}

/**
 * True when a line still holds a start, diff3 base or end marker. Save is
 * refused while this is true. The bare `=======` line is not counted: it is
 * common in Markdown and setext headings.
 *
 * @example hasMarkers("<<<<<<< HEAD\r\nx\r\n") // true
 */
export function hasMarkers(text: string): boolean {
  return text.split(/\r?\n/).some((line) => ANY_MARKER.test(line));
}

/**
 * True when the text holds a NUL byte, which means a binary file. The editor
 * then offers only whole-file Mine or Theirs.
 *
 * @example looksBinary("a\u0000b") // true
 */
export function looksBinary(text: string): boolean {
  return text.includes("\u0000");
}

function readBlock(lines: string[], start: number): ParsedBlock | null {
  const ours = collectUntil(lines, start + 1, (l) => BASE.test(l) || SEP.test(l));
  if (ours === null) return null;
  const hasBase = BASE.test(lines[ours.at]);
  const base = hasBase ? collectUntil(lines, ours.at + 1, isSep) : null;
  if (hasBase && base === null) return null;
  const sepAt = base === null ? ours.at : base.at;
  const theirs = collectUntil(lines, sepAt + 1, (l) => END.test(l));
  if (theirs === null) return null;
  return {
    block: {
      kind: "conflict",
      ours: ours.body,
      base: base === null ? null : base.body,
      theirs: theirs.body,
      oursLabel: labelOf(lines[start]),
      theirsLabel: labelOf(lines[theirs.at]),
      raw: lines.slice(start, theirs.at + 1),
    },
    next: theirs.at + 1,
  };
}

/** Collects lines from `from` up to the first line matching `stop`. Returns null
 * when the input ends first, or when another start marker shows up: that is a
 * nested or truncated block, which we refuse to guess at. */
function collectUntil(
  lines: string[],
  from: number,
  stop: (line: string) => boolean,
): Collected | null {
  for (let i = from; i < lines.length; i++) {
    if (stop(lines[i])) return { body: lines.slice(from, i), at: i };
    if (START.test(lines[i])) return null;
  }
  return null;
}

/**
 * The lines one block contributes for a choice, or its raw markers when
 * undecided. The editor uses it to seed "Edit result" with what is shown now.
 *
 * @example linesForChoice(block, "both") // ours lines followed by theirs lines
 */
export function linesForChoice(
  block: ConflictBlock,
  choice: ConflictChoice | undefined,
): string[] {
  if (choice === undefined) return block.raw;
  if (typeof choice === "object") return linesOf(choice.custom);
  switch (choice) {
    case "ours": return block.ours;
    case "theirs": return block.theirs;
    case "both": return block.ours.concat(block.theirs);
    case "bothReverse": return block.theirs.concat(block.ours);
  }
}

/** Splits typed text into lines. A single trailing newline is not a blank line,
 * so `"a\n"` is one line, as in a text editor. */
function linesOf(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\r?\n$/, "").split(/\r?\n/);
}

function labelOf(markerLine: string): string {
  return markerLine.replace(/^(?:<{7}|\|{7}|>{7})\s*/, "").trim();
}

function detectEol(text: string): "\n" | "\r\n" {
  const crlf = text.split("\r\n").length - 1;
  const lf = text.split("\n").length - 1 - crlf;
  return crlf > lf ? "\r\n" : "\n";
}

function pushText(segments: ConflictSegment[], lines: string[]): void {
  if (lines.length > 0) segments.push({ kind: "text", lines: [...lines] });
}

function appendAll(out: string[], lines: string[]): void {
  for (const line of lines) out.push(line);
}

function isConflict(seg: ConflictSegment): seg is ConflictBlock {
  return seg.kind === "conflict";
}

function isSep(line: string): boolean {
  return SEP.test(line);
}
