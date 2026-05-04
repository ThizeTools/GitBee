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
const STORAGE_SOLO = "gkp.graph.soloRef.v1";
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

export const hiddenRefs = writable<Set<string>>(loadSet(STORAGE_HIDDEN));
export const soloRef = writable<string | null>(loadString(STORAGE_SOLO));
export const pinnedRef = writable<string | null>(loadString(STORAGE_PINNED));

hiddenRefs.subscribe((s) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_HIDDEN, JSON.stringify([...s]));
});
soloRef.subscribe((s) => {
  if (typeof localStorage === "undefined") return;
  if (s) localStorage.setItem(STORAGE_SOLO, s);
  else localStorage.removeItem(STORAGE_SOLO);
});
pinnedRef.subscribe((s) => {
  if (typeof localStorage === "undefined") return;
  if (s) localStorage.setItem(STORAGE_PINNED, s);
  else localStorage.removeItem(STORAGE_PINNED);
});

export function hideRef(name: string): void {
  hiddenRefs.update((s) => { const n = new Set(s); n.add(name); return n; });
  // Hiding a ref while it's the solo target would leave nothing visible —
  // unset solo so the user doesn't get stuck on an empty graph.
  soloRef.update((cur) => (cur === name ? null : cur));
}

export function unhideRef(name: string): void {
  hiddenRefs.update((s) => { const n = new Set(s); n.delete(name); return n; });
}

export function setSolo(name: string | null): void {
  soloRef.set(name);
}

// Single-pin model: only one ref can be "pinned to left" at a time.
// Pinning a different ref unpins the previous one automatically; pinning
// the currently-pinned ref again unpins it (toggle).
export function togglePin(name: string): void {
  pinnedRef.update((cur) => (cur === name ? null : name));
}

export function clearAllFilters(): void {
  hiddenRefs.set(new Set());
  soloRef.set(null);
}
