import { writable } from "svelte/store";

// Per-repo viewing filters that mask refs (and the commits reachable only
// through them) from the graph. State is keyed by ref name (the qualified
// `CommitRef.name`: "main", "origin/main", "v1.0", …) so a remote branch
// can be hidden without affecting its local counterpart.
//
// Persistence is intentionally global (not per-repo) — the same .git
// usually has the same noisy refs (gh-pages, dependabot/*, etc.) so a
// single shared list is more useful than per-repo bookkeeping. Fits in a
// single localStorage key.
const STORAGE_HIDDEN = "gkp.graph.hiddenRefs.v1";
// v2 — solo is now multi-valued (a Set of refs). Old single-string v1
// values are migrated lazily on first read.
const STORAGE_SOLO = "gkp.graph.soloRefs.v2";
const STORAGE_SOLO_LEGACY = "gkp.graph.soloRef.v1";
// v2 — pin is now single-valued (one branch pinned at a time). Old v1
// arrays in localStorage are silently dropped on first read.
const STORAGE_PINNED = "gkp.graph.pinnedRef.v2";

function loadSet(key: string): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === "string")) : new Set();
  } catch { return new Set(); }
}

function loadString(key: string): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(key) || null;
}

// Read solo set, migrating from the v1 single-string key on first run.
function loadSoloSet(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  const v2 = loadSet(STORAGE_SOLO);
  if (v2.size > 0) return v2;
  const legacy = localStorage.getItem(STORAGE_SOLO_LEGACY);
  if (legacy) {
    localStorage.removeItem(STORAGE_SOLO_LEGACY);
    const s = new Set([legacy]);
    localStorage.setItem(STORAGE_SOLO, JSON.stringify([...s]));
    return s;
  }
  return new Set();
}

export const hiddenRefs = writable<Set<string>>(loadSet(STORAGE_HIDDEN));
export const soloRefs = writable<Set<string>>(loadSoloSet());
export const pinnedRef = writable<string | null>(loadString(STORAGE_PINNED));

hiddenRefs.subscribe((s) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_HIDDEN, JSON.stringify([...s]));
});
soloRefs.subscribe((s) => {
  if (typeof localStorage === "undefined") return;
  if (s.size > 0) localStorage.setItem(STORAGE_SOLO, JSON.stringify([...s]));
  else localStorage.removeItem(STORAGE_SOLO);
});
pinnedRef.subscribe((s) => {
  if (typeof localStorage === "undefined") return;
  if (s) localStorage.setItem(STORAGE_PINNED, s);
  else localStorage.removeItem(STORAGE_PINNED);
});

export function hideRef(name: string): void {
  hiddenRefs.update((s) => { const n = new Set(s); n.add(name); return n; });
  // Hiding a ref while it's in the solo set would shrink visible history;
  // remove it from solo so the user doesn't end up with an empty graph.
  soloRefs.update((s) => {
    if (!s.has(name)) return s;
    const n = new Set(s); n.delete(name); return n;
  });
}

export function unhideRef(name: string): void {
  hiddenRefs.update((s) => { const n = new Set(s); n.delete(name); return n; });
}

// Add a ref to the solo set (multi-solo). Pass `null` to clear all.
export function addSolo(name: string): void {
  soloRefs.update((s) => { const n = new Set(s); n.add(name); return n; });
}

export function removeSolo(name: string): void {
  soloRefs.update((s) => {
    if (!s.has(name)) return s;
    const n = new Set(s); n.delete(name); return n;
  });
}

export function toggleSolo(name: string): void {
  soloRefs.update((s) => {
    const n = new Set(s);
    if (n.has(name)) n.delete(name); else n.add(name);
    return n;
  });
}

export function clearSolo(): void {
  soloRefs.set(new Set());
}

// Single-pin model: only one ref can be "pinned to left" at a time.
// Pinning a different ref unpins the previous one automatically; pinning
// the currently-pinned ref again unpins it (toggle).
export function togglePin(name: string): void {
  pinnedRef.update((cur) => (cur === name ? null : name));
}

export function clearAllFilters(): void {
  hiddenRefs.set(new Set());
  soloRefs.set(new Set());
}
