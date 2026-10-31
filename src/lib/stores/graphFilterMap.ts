// Pure storage model for per-repo graph filters (hide, solo, pin). graphFilter.ts
// keeps the live stores in sync with one JSON object in localStorage whose keys
// are normalized repo paths. Kept free of storage access so bun test can run it.
import type { CommitRef } from "$lib/ipc";
import { normTabPath } from "./repoPath";

export interface RepoFilters {
  hidden: string[];
  solo: string[];
  pinned: string | null;
}

export type FilterMap = Record<string, RepoFilters>;

export function emptyRepoFilters(): RepoFilters {
  return { hidden: [], solo: [], pinned: null };
}

// The same rule the repo tabs compare with (normTabPath, repoPath.ts), so
// "C:\\Repo\\" and "c:/repo" name one key.
/** Normalized map key for a repo path. Example: repoFilterKey("C:\\Code\\App\\") → "c:/code/app" */
export function repoFilterKey(path: string): string {
  return normTabPath(path);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Parses a JSON array of strings (legacy global keys use this shape).
 * Anything else, including corrupt JSON, yields []. */
export function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try { return stringList(JSON.parse(raw)); } catch { return []; }
}

// Drops malformed fields instead of rejecting the whole entry, so one bad
// value cannot wipe a repo's other filters.
function toRepoFilters(v: unknown): RepoFilters {
  if (!isRecord(v)) return emptyRepoFilters();
  const pinned = typeof v.pinned === "string" && v.pinned !== "" ? v.pinned : null;
  return { hidden: stringList(v.hidden), solo: stringList(v.solo), pinned };
}

/** Parses the stored JSON map. Missing or corrupt input yields an empty map.
 * Example: parseFilterMap('{"c:/a":{"hidden":["dev"],"solo":[],"pinned":null}}') */
export function parseFilterMap(raw: string | null): FilterMap {
  if (!raw) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!isRecord(parsed)) return {};
  const out: FilterMap = {};
  for (const [key, value] of Object.entries(parsed)) out[key] = toRepoFilters(value);
  return out;
}

export function serializeFilterMap(map: FilterMap): string {
  return JSON.stringify(map);
}

/** The filters stored for `key`, or null when the repo has never been seen.
 * Null (not empty) is what tells seeding apart from "user cleared everything". */
export function getRepoFilters(map: FilterMap, key: string): RepoFilters | null {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
}

/** Returns a new map with `key` set. The input map is not mutated. */
export function setRepoFilters(map: FilterMap, key: string, filters: RepoFilters): FilterMap {
  return { ...map, [key]: filters };
}

/** Gives a repo its first entry from the legacy global values. Once an entry
 * exists (even an empty one) it is never reseeded. Returns the same map object
 * when nothing changes. Example: seedRepoFilters(map, key, legacy) */
export function seedRepoFilters(map: FilterMap, key: string, legacy: RepoFilters): FilterMap {
  return getRepoFilters(map, key) === null ? setRepoFilters(map, key, legacy) : map;
}

/** The target sha of the pinned ref, or null when nothing is pinned or the pinned
 * ref is not among `refs`. Pins are stored by qualified ref name (`CommitRef.name`),
 * so "main" and "origin/main" pin different refs. WHY a null: the backend then
 * gives lane 0 to HEAD, the documented fallback (docs/specs/lane-pin.md).
 * Example: pinnedShaFor("origin/main", graph.refs) */
export function pinnedShaFor(pin: string | null, refs: readonly CommitRef[]): string | null {
  if (!pin) return null;
  const ref = refs.find((r) => r.name === pin && r.kind !== "stash");
  return ref?.target_sha ?? null;
}
