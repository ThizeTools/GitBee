// DEV-ONLY demo repository for the browser IPC mock (src/lib/dev/mockIpc.ts).
// Everything is derived from fixed constants (fixed clock, seeded PRNG), so the
// same history, lanes and shas come out on every load. Production builds never
// reach this file: its only importer is the DEV-guarded import in +layout.svelte.
import type {
  CommitFileStat, CommitRef, CommitStat, DiffLine, FileDiff, GraphNode, GraphPage,
  Hunk, OperationState, Remote, StashEntry, StatusEntry, Worktree,
} from "$lib/ipc";
import type { RepoIdentity } from "$lib/profiles/profile";

export const DEMO_REPO_PATH = "C:/demo/gitbee-demo";
/** Fixed "now" (2026-10-31 15:00 UTC). The history spans the 60 days before it. */
export const DEMO_NOW_SEC = Date.UTC(2026, 9, 31, 15, 0, 0) / 1000;

const DAY_SEC = 86_400;
const HISTORY_SPAN_SEC = 60 * DAY_SEC;
const COMMIT_TOTAL = 120;
const SEED = 20261031;
const START_SEC = DEMO_NOW_SEC - HISTORY_SPAN_SEC;

/** Mulberry32: a small seeded PRNG, so each run builds the same history. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length)];
}

/** A stable 40-char hex id for fixture commit `n`. */
function fakeSha(n: number): string {
  const rand = prng(0x5a17 + n * 7919);
  let out = "";
  for (let i = 0; i < 40; i++) out += Math.floor(rand() * 16).toString(16);
  return out;
}

function seedOf(sha: string): number {
  return parseInt(sha.slice(0, 8), 16);
}

/** 16 hex chars (FNV-1a, two lanes). Changes whenever the input changes. */
function hex16(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x27d4eb2d);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

const AUTHORS = [
  { name: "Ada Lovelace", email: "ada@example.test" },
  { name: "Grace Hopper", email: "grace@example.test" },
  { name: "Alan Turing", email: "alan@example.test" },
  { name: "Mira Okafor", email: "mira@example.test" },
] as const;

/** The repo's identity, as `git config user.*` would report it. */
export const DEMO_IDENTITY: RepoIdentity = {
  name: AUTHORS[0].name, email: AUTHORS[0].email, source: "local",
};

/** One commit as `git log` reports it, before lane assignment. */
export interface DemoCommit {
  sha: string;
  parents: string[];
  author_name: string;
  author_email: string;
  timestamp: number;
  subject: string;
}

interface Topic {
  subjects: readonly string[];
  /** Index into AUTHORS; cycled through for each commit on the topic. */
  authors: readonly number[];
}

const VERBS = ["add", "fix", "refactor", "tidy", "document", "speed up", "handle", "simplify", "extract", "test"];
const CORE: Topic = {
  subjects: ["graph canvas", "status bar", "diff viewer", "commit box", "stash list", "settings store", "repo watcher", "tab bar"],
  authors: [0, 1, 0, 2, 0, 1],
};
const AUTH: Topic = { subjects: ["login form", "session refresh", "OAuth callback", "logout cleanup", "token storage"], authors: [2] };
const CHARTS: Topic = { subjects: ["bar chart axes", "tooltip placement", "legend layout", "sparkline component"], authors: [3] };
const REMOTE: Topic = { subjects: ["remote tags list", "push progress bar", "fetch retry backoff"], authors: [1] };
const XBRANCH: Topic = { subjects: ["keyboard shortcut for branches", "drag ref to lane", "commit stats cache"], authors: [0, 3] };

/** Builds commits in creation order, which is also chronological order. */
class HistoryBuilder {
  readonly commits: DemoCommit[] = [];
  private readonly rand = prng(SEED);

  push(parents: string[], subject: string, authorIndex: number): string {
    const k = this.commits.length;
    const sha = fakeSha(k + 1);
    const author = AUTHORS[authorIndex];
    // Timestamps are strictly increasing in creation order, so a child is always newer than its parents.
    const spacing = HISTORY_SPAN_SEC / COMMIT_TOTAL;
    const timestamp = START_SEC + Math.floor((k + 0.8 * this.rand()) * spacing);
    this.commits.push({
      sha, parents, author_name: author.name, author_email: author.email, timestamp, subject,
    });
    return sha;
  }

  /** `count` commits in a line on `tip`; returns the new tip. */
  run(tip: string, count: number, topic: Topic): string {
    let parent = tip;
    for (let i = 0; i < count; i++) {
      const subject = `${pick(VERBS, this.rand)} ${pick(topic.subjects, this.rand)}`;
      parent = this.push([parent], subject, topic.authors[i % topic.authors.length]);
    }
    return parent;
  }

  merge(ours: string, theirs: string, subject: string): string {
    return this.push([ours, theirs], subject, 0);
  }

  subjectOf(sha: string): string {
    return this.commits.find((c) => c.sha === sha)?.subject ?? "";
  }

  /** A stash is two commits: the index snapshot, then the WIP commit that merges both. */
  stash(main: string): { sha: string; subject: string } {
    const head = `${short(main)} ${this.subjectOf(main)}`;
    const index = this.push([main], `index on main: ${head}`, 0);
    const subject = `WIP on main: ${head}`;
    return { sha: this.push([main, index], subject, 0), subject };
  }
}

function short(sha: string): string {
  return sha.slice(0, 7);
}

interface DemoHistory {
  commits: DemoCommit[];
  refs: CommitRef[];
  head: string;
  stash: { sha: string; subject: string };
}

/** Main plus three feature lines: auth and charts merged back, feature/x open, origin/feature/y remote-only. */
function buildHistory(): DemoHistory {
  const h = new HistoryBuilder();
  let main = h.push([], "Initial commit", 0);
  main = h.run(main, 10, CORE);
  let auth = h.run(main, 2, AUTH);
  main = h.run(main, 6, CORE);
  auth = h.run(auth, 2, AUTH);
  main = h.merge(main, auth, "Merge branch 'feature/auth'");
  const tagV03 = main;
  main = h.run(main, 10, CORE);
  let charts = h.run(main, 3, CHARTS);
  main = h.run(main, 8, CORE);
  charts = h.run(charts, 3, CHARTS);
  let remoteY = h.run(main, 3, REMOTE);
  main = h.run(main, 6, CORE);
  main = h.merge(main, charts, "Merge branch 'feature/charts'");
  const tagV04 = main;
  let openX = h.run(main, 2, XBRANCH);
  main = h.run(main, 10, CORE);
  openX = h.run(openX, 2, XBRANCH);
  remoteY = h.run(remoteY, 3, REMOTE);
  main = h.run(main, 8, CORE);
  const stash = h.stash(main);
  // origin/main sits two commits behind local main, so local is "ahead 2".
  main = h.run(main, COMMIT_TOTAL - 2 - h.commits.length, CORE);
  const originMain = main;
  main = h.run(main, 2, CORE);
  const refs: CommitRef[] = [
    { name: "main", kind: "localbranch", target_sha: main },
    { name: "feature/x", kind: "localbranch", target_sha: openX },
    { name: "origin/feature/y", kind: "remotebranch", target_sha: remoteY },
    { name: "origin/main", kind: "remotebranch", target_sha: originMain },
    { name: "stash", kind: "stash", target_sha: stash.sha },
    { name: "v0.3.0", kind: "tag", target_sha: tagV03 },
    { name: "v0.4.0", kind: "tag", target_sha: tagV04 },
  ];
  return { commits: h.commits, refs, head: main, stash };
}

let cachedHistory: DemoHistory | null = null;

function history(): DemoHistory {
  cachedHistory ??= buildHistory();
  return cachedHistory;
}

// Lane assignment: a port of assign_lanes in src-tauri/src/git/graph.rs, so the
// demo graph lays out the same way the real backend would. Keep the two in step.

function allocateLane(lanes: (string | null)[], forChain: boolean, lane0Active: boolean): number {
  if (forChain) {
    ensureLane(lanes, 0);
    return 0;
  }
  const start = lane0Active ? 1 : 0;
  while (lanes.length < start) lanes.push(null);
  for (let i = start; i < lanes.length; i++) {
    if (lanes[i] === null) return i;
  }
  lanes.push(null);
  return lanes.length - 1;
}

function ensureLane(lanes: (string | null)[], idx: number): void {
  while (lanes.length <= idx) lanes.push(null);
  lanes[idx] = null;
}

function sideParentLane(lanes: (string | null)[], parent: string, lane0Active: boolean): number {
  const existing = lanes.indexOf(parent);
  if (existing >= 0) return existing;
  const lane = allocateLane(lanes, false, lane0Active);
  lanes[lane] = parent;
  return lane;
}

function claimLane(lanes: (string | null)[], sha: string, onChain: boolean, lane0Active: boolean): number {
  const waiting: number[] = [];
  lanes.forEach((awaited, i) => { if (awaited === sha) waiting.push(i); });
  if (waiting.length === 0) return allocateLane(lanes, onChain, lane0Active);
  if (onChain && waiting[0] !== 0) {
    for (const i of waiting) lanes[i] = null;
    ensureLane(lanes, 0);
    return 0;
  }
  for (const i of waiting.slice(1)) lanes[i] = null;
  return waiting[0];
}

/** Shas on the first-parent chain from `tip` that are inside the loaded slice. */
function lane0Chain(commits: readonly DemoCommit[], tip: string | null): Set<string> {
  const chain = new Set<string>();
  if (!tip) return chain;
  const byId = new Map(commits.map((c) => [c.sha, c] as const));
  if (!byId.has(tip)) return chain;
  let cur: string | undefined = tip;
  while (cur !== undefined && !chain.has(cur)) {
    chain.add(cur);
    const c = byId.get(cur);
    cur = c && c.parents.length > 0 ? c.parents[0] : undefined;
  }
  return chain;
}

function compactLanes(nodes: GraphNode[], lane0Active: boolean): void {
  const firstSeen = new Map<number, number>();
  const note = (lane: number, row: number) => {
    if (!firstSeen.has(lane)) firstSeen.set(lane, row);
  };
  for (const n of nodes) {
    note(n.lane, n.row);
    for (const pl of n.parent_lanes) note(pl, n.row);
  }
  const pinRank = (lane: number) => (lane0Active && lane === 0 ? 0 : 1);
  const order = [...firstSeen].sort(([la, ra], [lb, rb]) => pinRank(la) - pinRank(lb) || ra - rb || la - lb);
  const remap = new Map(order.map(([lane], idx) => [lane, idx] as const));
  for (const n of nodes) {
    n.lane = remap.get(n.lane) ?? n.lane;
    n.parent_lanes = n.parent_lanes.map((pl) => remap.get(pl) ?? pl);
  }
}

/** Lanes for commits newest first, the order `git log --date-order` returns. */
export function assignLanes(commits: readonly DemoCommit[], lane0Tip: string | null): GraphNode[] {
  const chain = lane0Chain(commits, lane0Tip);
  const lane0Active = chain.size > 0;
  const lanes: (string | null)[] = [];
  const nodes: GraphNode[] = commits.map((c, row) => {
    const myLane = claimLane(lanes, c.sha, chain.has(c.sha), lane0Active);
    const parentLanes: number[] = [];
    if (c.parents.length === 0) {
      lanes[myLane] = null;
    } else {
      lanes[myLane] = c.parents[0];
      parentLanes.push(myLane);
      for (const p of c.parents.slice(1)) parentLanes.push(sideParentLane(lanes, p, lane0Active));
    }
    return {
      sha: c.sha, parents: [...c.parents], author_name: c.author_name, author_email: c.author_email,
      timestamp: c.timestamp, subject: c.subject, lane: myLane, row, parent_lanes: parentLanes,
    };
  });
  compactLanes(nodes, lane0Active);
  return nodes;
}

/** The pinned tip takes lane 0 when it is in the slice, else HEAD (mirrors pick_lane0_tip). */
function pickLane0Tip(commits: readonly DemoCommit[], pinned: string | null, head: string): string | null {
  const loaded = (sha: string) => commits.some((c) => c.sha === sha);
  if (pinned && loaded(pinned)) return pinned;
  return loaded(head) ? head : null;
}

/** graph_load: the first `limit` commits, laid out. Equal fingerprints return `unchanged`. */
export function demoGraphPage(limit: number, knownFingerprint: string | null, pinnedSha: string | null): GraphPage {
  const { commits, refs, head } = history();
  const fingerprint = hex16(`${head}|${pinnedSha ?? ""}|${limit}`);
  const base = { head_sha: head, head_branch: "main", fingerprint };
  if (knownFingerprint === fingerprint) {
    return { ...base, nodes: [], refs: [], unchanged: true, has_more: false };
  }
  const newestFirst = commits.slice().reverse().slice(0, limit);
  const lane0 = pickLane0Tip(newestFirst, pinnedSha, head);
  return {
    ...base,
    nodes: assignLanes(newestFirst, lane0),
    refs: refs.map((r) => ({ ...r })),
    unchanged: false,
    has_more: commits.length >= limit,
  };
}

/** graph_search: shas whose subject or author matches, newest first. */
export function demoSearchShas(query: string, limit: number): string[] {
  const needle = query.toLowerCase();
  return history().commits
    .slice().reverse()
    .filter((c) => `${c.subject} ${c.author_name}`.toLowerCase().includes(needle))
    .slice(0, limit)
    .map((c) => c.sha);
}

export function demoRecent(): { id: number; path: string; last_opened: number }[] {
  return [{ id: 1, path: DEMO_REPO_PATH, last_opened: DEMO_NOW_SEC }];
}

export function demoStatus(): StatusEntry[] {
  return [
    { path: "src/lib/graph/layout.ts", orig_path: null, index: "unmodified", worktree: "modified", conflicted: false },
    { path: "src/lib/graph/lanePin.ts", orig_path: null, index: "unmodified", worktree: "added", conflicted: false },
    { path: "src/lib/legacy/tabsMigration.ts", orig_path: null, index: "unmodified", worktree: "deleted", conflicted: false },
    { path: "README.md", orig_path: null, index: "modified", worktree: "unmodified", conflicted: false },
  ];
}

export function demoStashes(): StashEntry[] {
  const { stash } = history();
  return [{ index: 0, message: stash.subject, sha: stash.sha }];
}

export function demoRemotes(): Remote[] {
  return [{ name: "origin", url: "https://github.com/gitbee-demo/gitbee-demo.git" }];
}

export function demoWorktrees(): Worktree[] {
  return [{ path: DEMO_REPO_PATH, branch: "main", head: history().head, bare: false, locked: false }];
}

export const DEMO_OP_STATE: OperationState = {
  merging: false, rebasing: false, cherry_picking: false, reverting: false,
};

export function demoCommitShow(sha: string): string {
  const c = history().commits.find((x) => x.sha === sha);
  if (!c) return "";
  const when = new Date(c.timestamp * 1000).toUTCString();
  return `commit ${c.sha}\nAuthor: ${c.author_name} <${c.author_email}>\nDate:   ${when}\n\n    ${c.subject}\n`;
}

const FILE_POOL = [
  "src/lib/graph/layout.ts", "src/lib/components/GraphCanvas.svelte", "src/lib/ipc/index.ts",
  "src/routes/+layout.svelte", "src-tauri/src/git/graph.rs", "docs/specs/lane-pin.md",
  "assets/logo.png", "src/lib/stores/repo.ts",
];

function fileStat(path: string, rand: () => number): CommitFileStat {
  const status = pick(["M", "M", "M", "A", "D"], rand);
  if (path.endsWith(".png")) {
    return { path, old_path: null, status, additions: null, deletions: null };
  }
  const additions = status === "D" ? 0 : 1 + Math.floor(rand() * 60);
  const deletions = status === "A" ? 0 : Math.floor(rand() * 20);
  return { path, old_path: null, status, additions, deletions };
}

/** commit_files: 1 to 4 files per sha, derived from the sha so it stays stable. */
export function demoCommitFiles(sha: string): CommitFileStat[] {
  const rand = prng(seedOf(sha));
  const count = 1 + Math.floor(rand() * 4);
  const first = Math.floor(rand() * FILE_POOL.length);
  return Array.from({ length: count }, (_, i) => fileStat(FILE_POOL[(first + i) % FILE_POOL.length], rand));
}

/** commit_stats: totals of demoCommitFiles, so the two commands always agree. */
export function demoCommitStats(shas: readonly string[]): CommitStat[] {
  return shas.map((sha) => {
    const files = demoCommitFiles(sha);
    const total = (count: (f: CommitFileStat) => number | null) =>
      files.reduce((acc, f) => acc + (count(f) ?? 0), 0);
    return {
      sha, files: files.length,
      additions: total((f) => f.additions), deletions: total((f) => f.deletions),
    };
  });
}

export const DEMO_DIFF_FILE = "src/lib/graph/layout.ts";

type RowKind = "context" | "add" | "del";

/** Builds a hunk from (kind, text) rows and numbers its lines the way git does. */
function hunk(oldStart: number, newStart: number, header: string, rows: [RowKind, string][]): Hunk {
  let oldNo = oldStart;
  let newNo = newStart;
  const lines: DiffLine[] = rows.map(([kind, content]) => {
    if (kind === "add") return { kind, content, old_no: null, new_no: newNo++ };
    if (kind === "del") return { kind, content, old_no: oldNo++, new_no: null };
    return { kind, content, old_no: oldNo++, new_no: newNo++ };
  });
  return {
    header, old_start: oldStart, old_lines: rows.filter(([k]) => k !== "add").length,
    new_start: newStart, new_lines: rows.filter(([k]) => k !== "del").length, lines,
  };
}

/** Diffs for diff_* commands: one file with two hunks. `file` overrides the path. */
export function demoFileDiffs(file?: string): FileDiff[] {
  const path = file || DEMO_DIFF_FILE;
  const hunks = [
    hunk(12, 12, "@@ -12,7 +12,8 @@ export function laneFor(row: number)", [
      ["context", "  const lane = lanes.indexOf(sha);"],
      ["del", "  if (lane < 0) return 0;"],
      ["add", "  if (lane < 0) return fallbackLane(sha);"],
      ["add", "  // lane 0 is reserved for the HEAD chain"],
      ["context", "  return lane;"],
      ["context", "}"],
      ["context", ""],
    ]),
    hunk(48, 49, "@@ -48,4 +49,6 @@ export function rowHeight(zoom: number)", [
      ["context", "export function rowHeight(zoom: number): number {"],
      ["del", "  return 24;"],
      ["add", "  return Math.round(24 * zoom);"],
      ["context", "}"],
    ]),
  ];
  return [{ old_path: path, new_path: path, hunks, binary: false, omitted_lines: 0 }];
}
