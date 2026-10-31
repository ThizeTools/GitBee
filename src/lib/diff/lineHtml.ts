import type { LineKind } from "$lib/ipc";
import { highlightCode } from "./highlight";
import type { CharRange } from "./wordDiff";

export interface Segment { text: string; changed: boolean; }

/**
 * Cuts `text` at every range boundary, so each piece sits entirely inside or
 * entirely outside every range. Ranges come from wordDiffRanges and lie within
 * the text. Splitting before highlighting keeps word ranges from being cut
 * mid-token by the highlighter's own spans.
 */
export function splitSegments(text: string, ranges: readonly CharRange[]): Segment[] {
  const cuts = new Set<number>([0, text.length]);
  for (const r of ranges) {
    cuts.add(r.start);
    cuts.add(r.end);
  }
  const bounds = [...cuts].sort((x, y) => x - y);
  const out: Segment[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const start = bounds[k];
    const end = bounds[k + 1];
    const changed = ranges.some((r) => start >= r.start && end <= r.end);
    out.push({ text: text.slice(start, end), changed });
  }
  return out;
}

/**
 * Safe HTML for one line: highlighted per segment, with changed-word segments
 * wrapped in `.dv-wd`. Each segment is highlighted on its own, so the wrapper
 * never contains unbalanced markup.
 */
export function renderLine(
  text: string, lang: string | null, ranges: readonly CharRange[] = [],
): string {
  if (ranges.length === 0) return highlightCode(text, lang);
  return splitSegments(text, ranges)
    .map((seg) => (seg.changed
      ? `<span class="dv-wd">${highlightCode(seg.text, lang)}</span>`
      : highlightCode(seg.text, lang)))
    .join("");
}

/** The one-column marker shown before a line's content in both views. */
export function linePrefix(kind: LineKind): string {
  switch (kind) {
    case "add": return "+";
    case "del": return "-";
    case "nonewline": return "\\";
    case "context": return " ";
  }
}
