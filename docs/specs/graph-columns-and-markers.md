# Graph columns, merge dimming, ref hover and scroll markers

Neighbors: [graph-visual-2026-10.md](graph-visual-2026-10.md) (how rows and
lanes are painted), [graph-loading.md](graph-loading.md) (what the graph
holds and when it redraws), [commit-details.md](commit-details.md) (the
`commit_stats` contract the changes column reads).

## Purpose
The graph showed only refs, lanes and subject. Users need the author, the
age and the short sha on the same line, a way to hide columns they do not
read, a way to see one branch's history without leaving the graph, and a
way to see where HEAD, the selection, branches, stashes and search matches
sit in a long history. A fifth, the changes column, shows each commit's
files and line counts. This spec covers those five features. They share
one rule: every cost is paid when data or layout changes, never per scroll.
The changes column is the one place that pays a git cost, so it loads only
the rows in view (see its own section).

## Public contract

### Columns (`src/lib/graph/columns.ts`)
- `GraphCol = "refs" | "graph" | "msg" | "author" | "date" | "sha" | "changes"`.
- Default visible order: refs, graph, msg, author, date. `sha` and `changes`
  are hidden.
- The last VISIBLE column takes the `1fr` track. With the defaults that is
  `date`, so the msg column keeps its stored width and date fills the rest.
- Cells:
  - `author`: `author_name`, one line, ellipsis.
  - `date`: `formatRelativeDate(timestamp, nowMs)` (`src/lib/graph/relativeDate.ts`).
    Forms: `just now`, `N min ago`, `N h ago`, `N d ago` (under 30 days),
    then `Mar 4` (current year) or `Mar 4, 2025`. Tooltip:
    `formatAbsoluteDate(timestamp)`, local date and time.
  - `sha`: first 7 chars, monospace.
  - `changes`: see the Changes column section below.
  - The WIP row renders all three cells empty so the grid stays aligned.
- Layout state (`src/lib/stores/layout.ts`, persisted):
  - `graphColOrder: GraphCol[]`: the full order, hidden columns included.
  - `hiddenCols: GraphCol[]`.
  - Widths: `graphRefsWidth`, `graphWidth`, `graphMsgWidth` (existing), plus
    `graphAuthorWidth` 140, `graphDateWidth` 110, `graphShaWidth` 80,
    `graphChangesWidth` 120.
  - Minimum drag width: 50 for author, date, sha; 70 for changes; 80 for the others.
- Migration on load (`migrateColOrder`, `normalizeHidden`, `hideNewDefaults`):
  a stored order without author, date, sha or changes gets them appended in
  default order. A missing `hiddenCols` falls back to `["sha", "changes"]`.
  A default-hidden column that the stored order lacks is added to
  `hiddenCols`, so an upgrading user does not see changes appear with git work
  they did not ask for. Unknown and duplicate ids are dropped,
  and `graph` and `msg` are removed from `hiddenCols` if stored there.

### Changes column
Files: `src/lib/components/graph/ChangesCell.svelte` (the cell),
`src/lib/graph/changes.ts` (bar, labels, the request window),
`src/lib/graph/commitStatsCore.ts` (the fetch queue, a class whose git call
is injected), `src/lib/stores/commitStatsCache.ts` (the app-wide instance,
wired to `ipc.commitStats`).

- Cell: `+12 −3` as text, and under it a 3 px bar split green (additions) and
  red (deletions). The bar's length is `log10(additions + deletions + 1) / 3`
  of the cell width, capped at the full width, so 1 000 changed lines fill it.
  The green share is `additions / total`. The tooltip is `N files` (`1 file`
  for one).
- Empty cell (`null`): the WIP row and stash rows. Nothing is requested for them.
- Loading (`undefined`): a faint placeholder bar until the stat lands. A failed
  request leaves it in place until the window changes.
- Data: `ipc.commitStats(repo, shas)` (contract in `commit-details.md`). A
  `commit_stats` call takes at most 200 shas, so larger requests are split.
- Request window: the visible rows plus `CHANGES_OVERSCAN_ROWS` (20) on each
  side. The request starts 120 ms (`STATS_DEBOUNCE_MS`) after the last change
  to the visible row range. A later change replaces the pending request.
- Only shas that are neither cached nor in flight are sent. Each sha is in
  flight at most once per repo.
- Cache: a `Map` per repo path, capped at 20 000 entries (`STATS_LRU_CAP`).
  Visible shas are touched on each request, so eviction drops rows the user
  scrolled away from. A stat never changes for a given sha, so there is no
  invalidation; switching repos just selects another map.
- The graph reads the cache through `statsLookup(repo, version)`. The version
  is bumped when a batch lands, which repaints the cells. The graph does not
  copy the cache on each batch.
- Column hidden: the pending request is cancelled and nothing runs.
- A failed batch is logged with `warn` and not thrown. Its shas leave the
  in-flight set, so the next window change asks again.

Why hidden by default: each stat is a `git log --numstat` over the commit's
diff. That is real work for every visible row, and most users do not read the
column, so it should not cost anything until they turn it on.

Why it loads only the visible rows: the column is per commit, and a long
history has tens of thousands of them. A request for all of them would cost
the same whatever the user looks at. The window plus the debounce means a
fling scroll sends one request, for where it stops.

### Header menu (`src/lib/components/graph/graphHeaderMenu.ts`)
- Right-click on the header opens the existing context menu (`openMenu`).
- One row per column in layout order, `✓ Author` when visible and `   Author`
  when hidden. `graph` and `msg` are listed, checked and disabled.
- A separator, then `✓ Dim merge commits` (or unchecked).
- Toggling a column writes `hiddenCols` through `toggleHidden`. Toggling
  dimming writes `dimMergeCommits`.
- Drag-reorder works on the full order, so a hidden column keeps its slot.

### Merge dimming
- `dimMergeCommits: boolean`, default `false`.
- A merge is a commit with `parents.length >= 2` (`isMergeNode`).
- When on, the merge row's text (msg, refs, author, date, sha) fades to
  opacity 0.4. The canvas node and lane are not dimmed (text only, as asked).

### Ref hover highlight
- Hovering a ref badge for `REF_HOVER_DELAY_MS` (150 ms) sets
  `hoveredRefSha` (`src/lib/stores/refHover.ts`) to the badge's
  `target_sha`. Ghost badges (containing-branch previews) do not arm it.
- Leaving the badge, or any scroll, clears it. A row that unmounts while
  its badge is hovered releases only its own highlight.
- `reachableFrom(sha, nodes)` (`src/lib/graph/reach.ts`) returns the loaded
  commits reachable by following all parents. `highlightFor` maps an empty
  result (sha not loaded) to `null`, meaning no highlight.
- `GraphCanvas` derives `highlightSet` from `$hoveredRefSha` and `nodes`, so
  it recomputes only when either changes.
- HTML rows outside the set get the `dimmed` class (`isRowDimmed`).
- The canvas renderer takes `highlightSet`. Rows outside it paint at
  `DIM_ALPHA` 0.25: segments, nodes, avatars and the WIP connector follow
  the HEAD row.

### Scroll markers (`src/lib/graph/scrollMarkers.ts`, `ScrollMarkers.svelte`)
- Kinds, in draw order, with thickness in CSS px:

  | kind | source | thickness | color |
  |---|---|---|---|
  | match | `matchShas` (search) | 1 | `--modified` |
  | stash | stash rows | 2 | `--fg-muted` |
  | branch | commits with a `localbranch` ref | 2 | lane color of that row |
  | selected | selected row (WIP = row 0) | 2 | `--fg` |
  | head | HEAD commit | 3 | `--accent` |

- `markerRows(input)` maps each display row to y as `row / totalRows *
  height`. Rows outside `[0, totalRows)` are dropped.
- `buildMarkerInput(source)` owns the WIP row offset. Display rows include
  the WIP row when it is shown.
- Click: `nearestMarkerRow(markers, rowAt)` picks the marked row closest to
  the pointer. Row 0 with WIP shown scrolls to the top. Other rows go
  through `graphScrollTarget`, which centers the row and selects it (the
  same path a tag click uses).
- The strip is a DPR-aware canvas, 10 px wide, placed over the graph's
  right edge just left of the native scrollbar (`right` = measured
  scrollbar width). It repaints when markers or height change. Scrolling
  does not reach it.

## Invariants
- Hidden columns keep their slot in `graphColOrder` and their width, so
  re-showing one restores both.
- `graph` and `msg` are never hidden, by the store, the migration or the menu.
- A visible column list always contains `graph` and `msg`.
- Highlight and markers depend on data only (`nodes`, refs, stashes, the
  selection, the search matches, HEAD). Scroll position is not an input, so a
  scroll event never runs `reachableFrom` or `markerRows`.
- The highlight dims only what is outside the hovered ref's history. It does
  not change selection, checkout or the right panel.
- At most one canvas draw per animation frame. `highlightSet` is listed in
  the `void` list of the draw effect in `GraphCanvas.svelte`.
- The date text refreshes once a minute (`nowMs` tick). The tick does not
  repaint the canvas.
- Changes column: git runs only while the column is visible. The request
  follows the visible row range (rows change, not pixels), so a scroll that
  stays inside one row does not ask again.
- A commit's stats are requested at most once per repo while cached, and
  never for the WIP or stash rows.
- Every `commit_stats` call carries at most 200 shas.

## Out of scope
- Per-column filters and column-specific sorting.
- Filling the changes column for rows scrolled past the overscan. A fast
  scroll shows placeholders for a moment.
- Keeping stats across app restarts, or capping how many repos stay in memory.
  Each repo keeps its own map for the session.
- Retrying a failed batch without a window change.
- Dimming the canvas node or lane for merge commits (text only).
- Highlight for the containing-branch ghost badges.
- Markers for remote branch tips, tags or the WIP row's breakdown.
- Localized date formats; month names are English on purpose so the cell
  width and tests are stable across machines.

## Rejected alternatives
- **Computing ancestry in Rust.** Every hover would pay an IPC round trip
  and the rows already loaded carry `parents`. The walk is O(loaded rows),
  memoized in a `$derived`, and only runs when the hovered ref changes.
- **Drawing markers into the lane canvas.** That canvas is viewport-sized and
  translated with the scroll, so marks would move with the content. A
  separate strip keeps the marks at fixed positions over the track.
- **Hiding a column by removing it from `graphColOrder`.** Loses its slot and
  its width. A separate `hiddenCols` list keeps both.
- **Dimming merges by default.** It changes how every existing graph looks.
  Off by default; the toggle is one click away in the header menu.
- **Hover highlight with no dwell.** Moving the pointer across a row of
  badges would flash the graph on and off. The 150 ms dwell is the GitKraken
  behavior.
- **Marker hit-testing through per-marker DOM elements.** A search for a
  common word can mark thousands of rows; one canvas and one click handler
  stays cheap.
- **Loading stats for every commit at graph load.** The cost grows with the
  history length, and the user sees a few dozen rows at a time. The window
  pays for what is shown.
- **Computing line counts from the loaded nodes.** The graph's node data
  carries no per-commit line counts; it would need the same git call.
- **Invalidating the stats cache on refresh.** A commit's stats are fixed by
  its sha, so a refresh has nothing to invalidate. Only eviction removes entries.
- **Overscan of zero.** A short scroll would show placeholders on every
  step. Twenty rows on each side covers a normal wheel flick.
