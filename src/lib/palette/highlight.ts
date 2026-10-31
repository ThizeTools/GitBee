// Splits a palette title into runs of matched and unmatched text, so the row can
// wrap the matched runs in <mark> without using HTML strings.

export interface TitleSegment {
  text: string;
  match: boolean;
}

/**
 * Groups consecutive characters by whether their index is a match position.
 * Example: segmentTitle("Pull", [0, 1]) gives [{ text: "Pu", match: true }, { text: "ll", match: false }].
 */
export function segmentTitle(title: string, positions: readonly number[]): TitleSegment[] {
  const marked = new Set(positions);
  const out: TitleSegment[] = [];
  for (let i = 0; i < title.length; i++) {
    const match = marked.has(i);
    const last = out[out.length - 1];
    if (last !== undefined && last.match === match) last.text += title.charAt(i);
    else out.push({ text: title.charAt(i), match });
  }
  return out;
}
