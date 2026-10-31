// Fuzzy matcher for the command palette. A query matches when its characters
// occur in the title in order, ignoring case. The alignment is chosen by dynamic
// programming, so the score is the best possible alignment, not the first one a
// greedy scan finds. Spec: docs/specs/command-palette.md.

export interface FuzzyMatch {
  score: number;
  /** Title index of each matched query character, ascending. */
  positions: number[];
}

export interface RankedMatch<T> {
  item: T;
  score: number;
  positions: number[];
}

// WHY these weights: typing initials ("co" for "Checkout") should land on word
// starts and camel humps; a run of consecutive characters is a stronger signal
// than scattered ones; a gap costs more than the text after a match, so a
// prefix never loses to a match buried mid-word.
const MATCH_BASE = 1;
const START_BONUS = 8;
const BOUNDARY_BONUS = 8;
const CAMEL_BONUS = 6;
const CONSECUTIVE_BONUS = 5;
const PREFIX_BONUS = 10;
const GAP_OPEN = 3;
const GAP_EXTEND = 1;
// Tiny on purpose: it only breaks ties, so "Pull" ranks above "Pull (rebase)".
const TRAILING_PENALTY = 0.02;

const SEPARATOR = /[\s\-_/\\.:,()[\]{}#@]/;
const NONE = -Infinity;

interface Layer {
  scores: number[];
  from: number[];
}

/** Lower-cases one UTF-16 unit at a time so indexes into the title stay valid. */
function lowerUnits(s: string): string[] {
  return s.split("").map((c) => {
    const lower = c.toLowerCase();
    return lower.length === 1 ? lower : c;
  });
}

function boundaryBonus(text: string, j: number): number {
  if (j === 0) return START_BONUS;
  const prev = text[j - 1];
  if (SEPARATOR.test(prev)) return BOUNDARY_BONUS;
  if (/[a-z]/.test(prev) && /[A-Z]/.test(text[j])) return CAMEL_BONUS;
  return 0;
}

function charScore(text: string, j: number): number {
  return MATCH_BASE + boundaryBonus(text, j);
}

// One gap of `skipped` characters: opening costs more than extending, so one
// long gap is cheaper than several short ones.
function gapPenalty(skipped: number): number {
  if (skipped <= 0) return 0;
  return GAP_OPEN + (skipped - 1) * GAP_EXTEND;
}

/** Score of one explicit alignment. Shared by the DP candidates and the prefix candidate. */
export function scorePositions(text: string, positions: readonly number[]): number {
  let score = 0;
  positions.forEach((j, i) => {
    score += charScore(text, j);
    if (i === 0) score -= gapPenalty(j);
    else if (j === positions[i - 1] + 1) score += CONSECUTIVE_BONUS;
    else score -= gapPenalty(j - positions[i - 1] - 1);
  });
  const last = positions[positions.length - 1];
  score -= (text.length - 1 - last) * TRAILING_PENALTY;
  if (positions.every((p, i) => p === i)) score += PREFIX_BONUS;
  return score;
}

function firstLayer(ch: string, text: string, lower: readonly string[]): Layer {
  const scores = lower.map((c, j) => (c === ch ? charScore(text, j) - gapPenalty(j) : NONE));
  return { scores, from: lower.map(() => -1) };
}

// Best predecessor for each column: either the previous query character right
// before it (consecutive bonus), or any earlier one (gap penalty). The running
// maximum over earlier columns keeps each layer O(n) instead of O(n^2).
function nextLayer(prev: readonly number[], ch: string, text: string, lower: readonly string[]): Layer {
  const scores: number[] = [];
  const from: number[] = [];
  let earlier = NONE;
  let earlierAt = -1;
  for (let j = 0; j < lower.length; j++) {
    if (j >= 2 && prev[j - 2] + (j - 2) * GAP_EXTEND > earlier) {
      earlier = prev[j - 2] + (j - 2) * GAP_EXTEND;
      earlierAt = j - 2;
    }
    const gapped = earlier - (j - 2) * GAP_EXTEND - GAP_OPEN;
    const adjacent = j >= 1 ? prev[j - 1] + CONSECUTIVE_BONUS : NONE;
    const useAdjacent = adjacent > gapped;
    const best = useAdjacent ? adjacent : gapped;
    scores.push(lower[j] === ch && best > NONE ? charScore(text, j) + best : NONE);
    from.push(useAdjacent ? j - 1 : earlierAt);
  }
  return { scores, from };
}

// The end column is the best final layer entry, with the trailing penalty applied.
function bestEnd(scores: readonly number[], n: number): number {
  let end = -1;
  let endScore = NONE;
  for (let j = 0; j < n; j++) {
    if (!Number.isFinite(scores[j])) continue;
    const total = scores[j] - (n - 1 - j) * TRAILING_PENALTY;
    if (total > endScore) { endScore = total; end = j; }
  }
  return end;
}

function bestAlignment(query: readonly string[], text: string, lower: readonly string[]): number[] | null {
  const layers: Layer[] = [firstLayer(query[0], text, lower)];
  for (let i = 1; i < query.length; i++) {
    layers.push(nextLayer(layers[i - 1].scores, query[i], text, lower));
  }
  const m = query.length;
  const end = bestEnd(layers[m - 1].scores, lower.length);
  if (end < 0) return null;
  const positions = new Array<number>(m);
  positions[m - 1] = end;
  for (let i = m - 1; i > 0; i--) positions[i - 1] = layers[i].from[positions[i]];
  return positions;
}

// Contiguous match at the very start: "fetch" against "Fetch all remotes". The
// DP alone would not always find it, since a mid-word run can score similarly.
function prefixAlignment(query: readonly string[], lower: readonly string[]): number[] | null {
  if (lower.length < query.length) return null;
  const matches = query.every((c, i) => lower[i] === c);
  return matches ? query.map((_, i) => i) : null;
}

/** Best fuzzy match of `query` inside `text`, or null when the query is not a subsequence. */
export function fuzzyScore(query: string, text: string): FuzzyMatch | null {
  if (query.length === 0) return { score: 0, positions: [] };
  const q = lowerUnits(query);
  const t = lowerUnits(text);
  const candidates = [bestAlignment(q, text, t), prefixAlignment(q, t)];
  let best: FuzzyMatch | null = null;
  for (const positions of candidates) {
    if (positions === null) continue;
    const score = scorePositions(text, positions);
    if (best === null || score > best.score) best = { score, positions };
  }
  return best;
}

/**
 * Filters and orders `items` by fuzzy score against `title`. Equal scores keep
 * the input order, so providers list actions first and ties stay predictable.
 * An empty query returns the first `limit` items unranked.
 * Example: rankItems("chk", items, 50)[0].item.title is "Checkout branch".
 */
export function rankItems<T extends { title: string }>(
  query: string,
  items: readonly T[],
  limit: number,
): RankedMatch<T>[] {
  if (query.length === 0) return items.slice(0, limit).map((item) => ({ item, score: 0, positions: [] }));
  const hits: (RankedMatch<T> & { index: number })[] = [];
  items.forEach((item, index) => {
    const m = fuzzyScore(query, item.title);
    if (m) hits.push({ item, index, score: m.score, positions: m.positions });
  });
  hits.sort((a, b) => b.score - a.score || a.index - b.index);
  return hits.slice(0, limit).map(({ item, score, positions }) => ({ item, score, positions }));
}
