// Word-level diff for one removed/added line pair. Pure: callers decide which
// lines are paired (see linePairs.ts). The token LCS costs O(n*m) in tokens,
// so pairs longer than MAX_WORD_DIFF_CHARS are skipped instead of paid for.

/** Half-open UTF-16 range [start, end) inside one line's content. */
export interface CharRange { start: number; end: number; }

export interface WordRanges { old: CharRange[]; new: CharRange[]; }

export const MAX_WORD_DIFF_CHARS = 500;

export interface Token { text: string; start: number; end: number; }

// A token is a run of letters/digits/underscores, a run of whitespace, or one
// other character. Matching by code point keeps surrogate pairs unsplit.
const TOKEN_PATTERN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;

/** Splits text into word, whitespace and single-punctuation tokens. */
export function tokenize(text: string): Token[] {
  return Array.from(text.matchAll(TOKEN_PATTERN), (m) => {
    const start = m.index ?? 0;
    return { text: m[0], start, end: start + m[0].length };
  });
}

/**
 * Character ranges that changed between two lines, on each side. Tokens
 * outside the longest common token subsequence are the changed ones; runs of
 * adjacent changed tokens merge into one range. Usage:
 * wordDiffRanges("foo(bar)", "foo(baz)") gives old [4,7) and new [4,7).
 */
export function wordDiffRanges(oldText: string, newText: string): WordRanges {
  if (oldText.length > MAX_WORD_DIFF_CHARS || newText.length > MAX_WORD_DIFF_CHARS) {
    return { old: [], new: [] };
  }
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const { aMissing, bMissing } = unmatchedTokens(a, b);
  return { old: toRanges(a, aMissing), new: toRanges(b, bMissing) };
}

/** Flags tokens that fall outside one longest common subsequence. */
function unmatchedTokens(a: Token[], b: Token[]): { aMissing: boolean[]; bMissing: boolean[] } {
  const cols = b.length + 1;
  // Uint16 is enough: a line is capped at MAX_WORD_DIFF_CHARS tokens.
  const lcs = new Uint16Array((a.length + 1) * cols);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      lcs[i * cols + j] = a[i - 1].text === b[j - 1].text
        ? lcs[(i - 1) * cols + (j - 1)] + 1
        : Math.max(lcs[(i - 1) * cols + j], lcs[i * cols + (j - 1)]);
    }
  }
  return backtrack(a, b, lcs, cols);
}

/** Walks the LCS table back from the end. Equal tokens are always a valid
 *  match there, so taking them greedily keeps the subsequence optimal. */
function backtrack(
  a: Token[], b: Token[], lcs: Uint16Array, cols: number,
): { aMissing: boolean[]; bMissing: boolean[] } {
  const aMissing = a.map(() => true);
  const bMissing = b.map(() => true);
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1].text === b[j - 1].text) {
      aMissing[i - 1] = false;
      bMissing[j - 1] = false;
      i--;
      j--;
    } else if (lcs[(i - 1) * cols + j] >= lcs[i * cols + (j - 1)]) {
      i--;
    } else {
      j--;
    }
  }
  return { aMissing, bMissing };
}

function toRanges(tokens: Token[], missing: boolean[]): CharRange[] {
  const ranges: CharRange[] = [];
  tokens.forEach((t, k) => {
    if (!missing[k]) return;
    const last = ranges[ranges.length - 1];
    if (last && last.end === t.start) last.end = t.end;
    else ranges.push({ start: t.start, end: t.end });
  });
  return ranges;
}
