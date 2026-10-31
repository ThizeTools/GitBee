# Lane pin (2026-10)

Neighbors: [graph-visual-2026-10.md](graph-visual-2026-10.md) (how lanes are
painted), [graph-loading.md](graph-loading.md) (fingerprint, paging),
[graph-filters-per-repo.md](graph-filters-per-repo.md) (where a pin is stored).

## Purpose

"Pin to Left" used to reorder the ref badges only. The graph kept its
HEAD-first lanes, so a pinned branch could sit in lane 3 with its line
weaving between other branches. GitKraken gives the pinned branch lane 0 and
starts every other lane at 1. The pin now does the same in the Rust lane
engine, so the lines of the pinned branch stay on the left.

## Public contract

### Backend: `graph_load(opts)` (`src-tauri/src/commands/graph.rs`)

- `GraphLoadOpts.pinned_sha: Option<String>`: the target sha of the pinned
  ref. An empty string counts as None.
- The lane-0 tip is picked by `pick_lane0_tip` (`src-tauri/src/git/graph.rs`):
  the pinned commit when it is in the loaded slice, else HEAD when it is
  loaded, else none.
- `fingerprint` hashes `pinned_sha`, after `limit` and `all_branches`. A pin
  change therefore never answers `unchanged`.

### Backend: `assign_lanes(commits, lane0_tip)`

- The first-parent chain of `lane0_tip` takes lane 0. Every other lane starts
  at 1.
- A tip off the chain never takes lane 0, even while no lane is open yet. WHY:
  before this fix the first non-chain tip listed took lane 0 while the lane
  list was still empty, and the chain then had to boot it out. Regression test:
  `non_chain_tip_listed_first_does_not_take_lane_zero`.
- Lanes are still compacted by first use, with lane 0 kept in place.

### Frontend

- A pin is stored per repo as a qualified ref name (`graphFilter.ts`, one of
  `CommitRef.name`: `main` and `origin/main` are different pins).
- `pinnedShaFor(pin, refs)` (`src/lib/stores/graphFilterMap.ts`) resolves the
  pin to a sha from the refs of the graph on screen.
- `loadGraphFor(tab)` (`src/lib/stores/repoRefresh.ts`) sends that sha. When
  the refs of that load show the pinned ref moved or appeared, the graph is
  loaded once more with the fresh sha. WHY: otherwise lane 0 stays laid out
  from the old tip until the next refresh.
- A change of the pin (`pinnedRef`) runs a silent full refresh. The fingerprint
  keeps it cheap when nothing moved.
- A pinned ref that is gone, or whose commit is not in the graph, falls back to
  HEAD on lane 0. It is not an error.

### Badges

`RefBadges` still lists the pinned badge first. That is now a secondary effect;
the lane placement is the primary one.

## Invariants

- A pin never changes which commits are shown, only lanes. Hide and solo
  filters are separate and still decide the visible rows.
- With no pin, or a pin that is not in the graph, the layout is the HEAD-chain
  layout of before.
- Lane 0 holds the lane-0 chain only. Other lanes start at 1.
- The fingerprint changes when the pin changes.
- Lane layout stays in Rust. The frontend never reorders lanes.

## Out of scope

- Pinning more than one ref. One pin, as before.
- Loading history until a pinned ref's commit is in the graph. A pinned ref
  older than the load limit falls back to HEAD until the user scrolls further.
- Per-branch colors and palette changes.

## Rejected alternatives

- **Re-sorting lanes in TypeScript.** Lanes come from Rust, and the segment
  builder replays `lane` and `parent_lanes`. A second layout in TS would
  diverge from it.
- **Resolving the pinned name in Rust.** That would add a `for-each-ref` read
  inside `graph_load`. The frontend already holds the refs of the last load.
  The cost is one extra load when the pinned ref moved (see `loadGraphFor`).
- **Walking `git log --first-parent <pin>` for the chain.** One more git
  process per refresh. The chain is already in the loaded slice, and the walk
  in `build_lane0_chain` is linear.
- **Making lane 0 empty when the pin is not loaded.** Leaves a gap at the left
  edge. HEAD on lane 0 is the behavior the app already had.
