# Graph loading and render cost (2026-10)

Neighbors: [repo-refresh.md](repo-refresh.md) (when a load happens),
[graph-visual-2026-10.md](graph-visual-2026-10.md) (how rows are painted).

## Purpose
Make a refresh cost proportional to what changed, and make scrolling the
graph cost proportional to what is on screen. Measured problems in v0.4.0:

- Every refresh ran `git log --all -n10000`, assigned lanes for 10 000
  commits, sent them over IPC and compared old vs new with
  `JSON.stringify` of the whole graph, even when no ref had moved.
- The canvas was reallocated (`canvas.width = …`) and redrawn on every
  scroll event, often twice per frame (scroll, then badge re-measure).
- Opening one file of a commit loaded the diff of every file in it.
- One huge file diff (lockfile, generated code) froze the diff view.

## Public contract

### `graph_load(opts)` (`src-tauri/src/commands/graph.rs`)
Input `GraphLoadOpts`:
- `path: String`, `limit: Option<usize>` (default 2000),
  `all_branches: Option<bool>` (default true),
- `known_fingerprint: Option<String>`: the `fingerprint` of the graph
  the caller already holds.

Output `GraphPage`: `nodes`, `refs`, `head_sha`, `head_branch`, plus
- `fingerprint: String`: hash of the inputs that decide the graph
  (limit, all_branches, `for-each-ref` output, HEAD sha, HEAD branch,
  stash shas). 16 hex chars.
- `unchanged: bool`: true when `known_fingerprint == fingerprint`. Then
  `nodes` and `refs` are empty and `git log` was not run; the caller
  keeps its current graph.
- `has_more: bool`: `git log` returned `limit` commits, so older
  commits may exist.

Errors: unchanged from before (git failures in log/refs still fall back
to an empty graph; see the QoL backlog).

### Paging (frontend, `src/lib/stores/repo.ts`)
- First load of a tab asks for `GRAPH_PAGE` (2000) commits.
- `loadMoreCommits()` grows the tab's limit by `GRAPH_PAGE` and runs a
  silent full refresh. It is a no-op while a previous load-more is
  pending or when the graph has `has_more == false`.
- `GraphCanvas` calls it when the scroll position is within
  `LOAD_MORE_OFFSET_PX` (1400 px, same as GitKraken) of the end.
- Search, keyboard nav and "jump to sha" still cover only loaded rows.

### Diffs (`src-tauri/src/commands/diff.rs`, `src-tauri/src/git/diff.rs`)
- `diff_commit(path, sha, file?)`: with `file`, runs
  `git show --format= --no-color -U3 <sha> -- <file>`. The center diff
  panel passes the file; the commit details panel does not.
- `FileDiff.omitted_lines: u32`: the parser keeps at most
  `MAX_FILE_DIFF_LINES` (5000) lines per file and counts the rest. The
  viewer shows "N more lines not shown" when it is non-zero.

### Render (`src/lib/components/GraphCanvas.svelte`)
- Draws are coalesced to one per animation frame.
- The canvas backing store is resized only when its size changes (the
  renderer clears with `clearRect` inside `save/restore`).
- The visible row window changes only at row boundaries, so badge
  re-measurement runs when rows enter/leave, not on every scroll pixel.
- Per-row lookups (stash index, branch kind of a containing ref) are
  Maps built once per data change.

## Invariants
- A refresh in which no ref, HEAD or stash moved does not run `git log`.
- Lanes are always assigned over the whole loaded set, so loading more
  never re-colors or re-lanes rows already on screen differently than a
  fresh load of the same size would.
- At most one canvas draw per animation frame.

## Out of scope
- True incremental log (`git log <new>..` merged into the old set).
- Backend commit search across unloaded history.
- Lazy per-file diffs in the commit details panel (it still loads the
  whole commit; the line cap bounds the worst case).

## Rejected alternatives
- **Append-only paging (`git log --skip=N`).** Lanes of the new page
  depend on branches open at the page boundary; stitching pages needs
  the full lane state anyway. Re-running with a larger limit keeps one
  code path. GitKraken also re-processes all rows on every change.
- **Fingerprint on the frontend (hash the received graph).** Still pays
  for `git log`, lane assignment and IPC; only the compare gets cheaper.
- **Content hash of `git log` output.** Needs the log, which is the cost
  we want to skip. Refs + HEAD + stashes fully decide the log for a
  fixed limit.
- **Pathspec-free single-file diff (filter client side).** What we had;
  pays for the whole commit. Cost accepted with `-- <file>`: a renamed
  file shows as added, because rename detection sees only that path.
