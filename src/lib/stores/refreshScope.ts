/** How much of the repo a refresh reloads. `"status"` reloads only
 * `git status`; `"full"` also reloads the graph, stashes, remotes,
 * worktrees and operation state. See docs/specs/repo-refresh.md. */
export type RefreshScope = "status" | "full";

/** Coalesced refreshes must load the widest scope any caller asked for.
 * Example: `mergeScope("status", "full") === "full"` */
export function mergeScope(a: RefreshScope, b: RefreshScope): RefreshScope {
  return a === "full" || b === "full" ? "full" : "status";
}

/** Reads the `scope` field of a `repo-changed` event payload. Anything that
 * is not `scope: "status"` is a full refresh: a missed graph refresh shows
 * stale state, while an extra one only costs time.
 * Example: `parseScope({ path: "C:/r", scope: "status" }) === "status"` */
export function parseScope(payload: unknown): RefreshScope {
  if (typeof payload !== "object" || payload === null) return "full";
  return "scope" in payload && payload.scope === "status" ? "status" : "full";
}
