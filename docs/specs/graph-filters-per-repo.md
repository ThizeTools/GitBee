# Graph filters per repo (2026-10)

Neighbors: [keyboard-and-toasts.md](keyboard-and-toasts.md) (graph keys read
the visible rows this filter produces).

## Purpose

Hide, solo and pin mask refs, and the commits reachable only through them,
from the graph. They used to live in three global localStorage keys, so
hiding `gh-pages` in one repo hid it in every other repo. Users keep
different branch sets in different repos, and one shared list was wrong for
most of them. Each repo now keeps its own filters.

## Public contract

### Store: `src/lib/stores/graphFilter.ts`

The exported names and types did not change, so existing imports keep working.

| Export | Meaning |
|---|---|
| `hiddenRefs`, `soloRefs`, `pinnedRef` | Live stores. They hold the **active repo's** values. |
| `setFilterRepo(path \| null)` | Makes `path` the active repo and swaps the live stores to its values. `null` (the new-tab page, or no tab) clears them. |
| `hideRef`, `unhideRef`, `addSolo`, `removeSolo`, `toggleSolo`, `clearSolo`, `togglePin`, `clearAllFilters` | Unchanged. Each one changes the active repo's filters. |

`setFilterRepo` is called from `src/lib/stores/repo.ts` in three places:
`openRepo` (new tab), `activateTab` (every tab switch, with `null` for the
new-tab page) and `closeTab` (when the last tab closes).

### Storage

- One key, `gkp.graph.filters.v1`, holds a JSON object. Each key is a repo
  path normalized by `repoFilterKey`: backslashes become slashes, trailing
  slashes are dropped, and the result is lowercased. Each value is
  `{ hidden: string[], solo: string[], pinned: string | null }`.
- Pure helpers in `src/lib/stores/graphFilterMap.ts` do the parsing and
  get/set/seed. They are tested without storage.
- Corrupt JSON, or an entry with the wrong shape, degrades to empty filters for
  that repo. The other repos are unaffected.

### Migration from the global keys

The legacy keys are `gkp.graph.hiddenRefs.v1`, `gkp.graph.soloRefs.v2` (with
`gkp.graph.soloRef.v1` as a single-string fallback) and
`gkp.graph.pinnedRef.v2`.

- A repo with no entry is seeded from the legacy values the first time it
  becomes active. The seed is saved at once, so it survives a restart.
- The legacy keys are read but never written or deleted. A repo opened later
  inherits the same starting point.
- An entry that exists but is empty (the user cleared the filters) is kept,
  so it is never reseeded from the legacy values.

## Invariants

- The live stores always reflect the active repo. A change made while repo A is
  active is written to A's entry and to no other.
- Switching repos does not write a half-swapped state. The swap is applied with
  writes suspended, then the new entry is already on disk.
- Activating the repo that is already active is a no-op.
- An entry is never removed. Removing one would reseed it from the legacy
  globals on the next visit.

## Out of scope

- Filters shared across repos. The request was for per-repo behavior.
- Pruning entries for repos that no longer exist. The map is small: one entry
  per repo the user has opened.
- Migrating the filters of closed tabs. A repo's entry is kept on close.

## Rejected alternatives

- **Keeping one global list and filtering by repo at render time.** It would
  still mix two repos' hidden refs in one list, and a rename of a ref in one
  repo would leak into another. A map keyed by repo path has no such mixing.
- **Deleting the legacy keys after migration.** Then a repo visited for the
  first time after migration would start empty, and its old filters would be
  lost. Leaving the legacy keys read-only avoids that.
- **Per-repo localStorage keys (one per repo).** Many keys to enumerate and
  clean up. One map is a single read at startup.
- **Seeding every repo from the legacy values at startup.** Repos the user
  never opens would take up storage for nothing. Seeding on first activation is
  enough.
