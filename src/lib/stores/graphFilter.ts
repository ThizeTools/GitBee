import { writable, get } from "svelte/store";
import {
  emptyRepoFilters, getRepoFilters, parseFilterMap, parseStringArray, repoFilterKey,
  seedRepoFilters, serializeFilterMap, setRepoFilters,
  type FilterMap, type RepoFilters,
} from "$lib/stores/graphFilterMap";

// Per-repo viewing filters that mask refs (and the commits reachable only
// through them) from the graph. State is keyed by ref name (the qualified
// `CommitRef.name`: "main", "origin/main", "v1.0", …) so a remote branch
// can be hidden without affecting its local counterpart.
//
// Each repo keeps its own hide / solo / pin set. WHY: with one global list, a
// branch hidden in repo A also vanished from repo B (user complaint). The three
// stores below always hold the ACTIVE repo's filters; setFilterRepo() swaps
// them when the active tab changes. Storage is one JSON map keyed by the
// normalized repo path (see graphFilterMap.ts).
const STORAGE_MAP = "gkp.graph.filters.v1";
// Legacy global keys from before per-repo filters. Read-only: a repo seen for
// the first time is seeded from them once. They are never written or deleted,
// so a repo opened later still starts from the same values.
const LEGACY_HIDDEN = "gkp.graph.hiddenRefs.v1";
const LEGACY_SOLO = "gkp.graph.soloRefs.v2";
const LEGACY_SOLO_V1 = "gkp.graph.soloRef.v1";
const LEGACY_PINNED = "gkp.graph.pinnedRef.v2";

function readStorage(key: string): string | null {
  if (typeof localStorage === "undefined") return null;
  try { return localStorage.getItem(key); } catch { return null; }
}

// A failed write (quota, privacy mode) keeps the in-memory filters working
// for this session; they just do not survive a restart.
function writeStorage(key: string, value: string): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(key, value); } catch { /* in-memory state still applies */ }
}

// Legacy global values as one RepoFilters. A v1 single-string solo value
// predates the v2 set and still counts as one soloed ref.
function readLegacyFilters(): RepoFilters {
  const solo = parseStringArray(readStorage(LEGACY_SOLO));
  const soloV1 = readStorage(LEGACY_SOLO_V1);
  return {
    hidden: parseStringArray(readStorage(LEGACY_HIDDEN)),
    solo: solo.length === 0 && soloV1 ? [soloV1] : solo,
    pinned: readStorage(LEGACY_PINNED) || null,
  };
}

// Live stores: always the active repo's filters. Empty until a repo is active.
export const hiddenRefs = writable<Set<string>>(new Set());
export const soloRefs = writable<Set<string>>(new Set());
export const pinnedRef = writable<string | null>(null);

let activeKey: string | null = null;
let filterMap: FilterMap = parseFilterMap(readStorage(STORAGE_MAP));
// True while setFilterRepo swaps the stores, so half-swapped states are never written.
let swapping = false;

function currentFilters(): RepoFilters {
  return { hidden: [...get(hiddenRefs)], solo: [...get(soloRefs)], pinned: get(pinnedRef) };
}

// Subscribing (rather than wrapping each mutator) catches every writer,
// including direct .set() calls from other modules.
function persistActive(): void {
  if (swapping || activeKey === null) return;
  filterMap = setRepoFilters(filterMap, activeKey, currentFilters());
  writeStorage(STORAGE_MAP, serializeFilterMap(filterMap));
}
hiddenRefs.subscribe(persistActive);
soloRefs.subscribe(persistActive);
pinnedRef.subscribe(persistActive);

// Stored filters for `key`. A repo with no entry is seeded from the legacy
// globals and the map is saved right away, so the seed survives a restart even
// if the user never changes a filter.
function loadFilters(key: string): RepoFilters {
  if (getRepoFilters(filterMap, key) === null) {
    filterMap = seedRepoFilters(filterMap, key, readLegacyFilters());
    writeStorage(STORAGE_MAP, serializeFilterMap(filterMap));
  }
  return getRepoFilters(filterMap, key) ?? emptyRepoFilters();
}

/** Points the live filter stores at one repo, or at none (null). Called from
 * repo.ts whenever the active tab changes. Activating the same repo again is a
 * no-op. Example: setFilterRepo("C:\\Code\\App") */
export function setFilterRepo(path: string | null): void {
  const key = path ? repoFilterKey(path) : null;
  if (key === activeKey) return;
  activeKey = key;
  const next = key === null ? emptyRepoFilters() : loadFilters(key);
  swapping = true;
  try {
    hiddenRefs.set(new Set(next.hidden));
    soloRefs.set(new Set(next.solo));
    pinnedRef.set(next.pinned);
  } finally {
    swapping = false;
  }
}

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
