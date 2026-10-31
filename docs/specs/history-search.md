# History search beyond the loaded graph (2026-10)

Neighbors: [graph-loading.md](graph-loading.md) (paging and "load more"),
[graph-filters-per-repo.md](graph-filters-per-repo.md) (hidden and solo refs
also hide matches), [lane-pin.md](lane-pin.md) (lanes of the matched rows).

## Purpose

Ctrl+F searched only the loaded slice, 2000 commits per page. A commit older
than that could not be found by its message or author. The search bar now
also asks the backend, which searches every ref. When a match is not loaded
yet, the user loads older history up to it with one click.

## Public contract

### Backend: `graph_search(path, query, limit?) -> string[]` (`src-tauri/src/commands/search.rs`)

- Returns full commit shas, newest first by committer time, at most `limit`
  (default 200). The cap bounds the work and the count shown to the user.
- Sources, run at the same time:
  1. For a query of 4 to 40 hex characters: `git rev-parse --verify --quiet
     <q>^{commit}`. That hit comes first, because an exact sha is the most
     specific match.
  2. `git log --all --format=%H %ct -i --fixed-strings --grep=<q> -n<limit>`.
  3. The same with `--author=<q>`.
- The query is attached to its flag (`--grep=<q>`), so a query that starts
  with `-` stays a value and never becomes an option.
- A query that is empty after trimming returns `[]`. A failing git call adds
  no hits: the local matches keep working.

### Frontend

- `remoteHits` (`src/lib/stores/graphSearch.ts`) holds the backend shas for the
  open query on the active repo. Hits are keyed by query, so hits for an
  earlier query are ignored.
- Scheduling (`src/lib/stores/historySearch.ts`): each query change schedules a
  search `REMOTE_DEBOUNCE_MS` (300 ms) after the last keystroke. A query under
  `REMOTE_MIN_CHARS` (3, trimmed) schedules nothing and clears the hits.
- `matchShas`: loaded, visible commits that match locally or are in the
  backend hits, in graph order. Local matching is unchanged and instant.
- `olderMatchShas`: backend hits whose commit is not loaded, newest first. The
  bar shows "N more matches in older history" with a "Show" button.
- "Show" (`revealOlderMatch`) loads pages with `loadMoreCommits`. That is the
  same path as scrolling, so the tab's commit limit grows and stays grown. It
  stops once the newest older match is loaded, after `MAX_OLDER_PAGES` (10
  pages of 2000), or on "Cancel". Then it moves the cursor to that match and
  scrolls to it. Pages already loaded stay loaded.
- A tab switch re-runs the search for the open query on the new repo. Closing
  the bar clears the hits and stops an older load in progress.

## Invariants

- Typing is never blocked by the backend. Local matches update on every
  keystroke. Backend hits arrive later and merge into the list.
- A match older than the loaded slice is counted but not listed until it is
  loaded. "Show" is the only thing that loads it.
- A hit hidden by a filter (hidden or solo ref) is neither listed nor
  counted. The count adds only commits that are not loaded, so the filters
  keep deciding what is visible.
- A response for an old query, an old repo or an old schedule is dropped.
- At most one older-history load runs at a time (`olderLoading` guard).
- Loading older history lays out lanes over the whole loaded set, as in
  graph-loading.md, so rows already on screen keep the lanes a fresh load of
  the same size gives them.

## Out of scope

- Regex search. Git's regex dialect differs from JavaScript's, and fixed
  strings keep the result predictable.
- Searching file contents (`-S` / `-G` pickaxe).
- A path filter.
- Loading older history while typing, without the "Show" click.

## Rejected alternatives

- **Loading the whole history to search in the frontend.** Every refresh would
  pay for every commit. That is the cost graph-loading.md removed.
- **A separate results list instead of graph navigation.** A hit must land on
  its row, where the lane, the badges and the scroll markers already show it.
  A list would fork Enter/F3 and the scroll markers.
- **One `git log` per keystroke.** A process per keystroke. The 300 ms pause
  and the 3-character minimum keep the count of calls low.
- **Auto-loading pages until the first hit appears.** An unbounded walk the
  user did not ask for. The count and the "Show" button make the cost visible,
  and "Cancel" stops it.
- **Sorting the backend hits by graph row.** The graph is not known to the
  backend. Committer time is the order `--date-order` uses, so it is the
  closest order the backend can give.
