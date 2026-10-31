# Commit details (2026-10)

Neighbors: [graph-loading.md](graph-loading.md) (the graph load, and the
per-file diff that replaced the whole-commit diff), [diff-viewer.md](diff-viewer.md)
(the viewer that draws each diff, word diff, `-w`), [repo-refresh.md](repo-refresh.md)
(when a commit's data is reloaded).

## Purpose
Selecting a commit must cost about the same whatever its size. The panel used
to run `git show` for the whole commit, so every file's patch was built and sent
before anything appeared. A commit touching thousands of files froze the window.

Now the panel loads the file list with per-file counts first. A file's diff
loads when the user expands it, the way GitKraken does it. The commit message
loads with the list, as before.

## Public contract

### Backend (`src-tauri/src/commands/commits.rs`, parsers in `src-tauri/src/git/numstat.rs`)

- `commit_files(path, sha) -> CommitFileStat[]`
  - `CommitFileStat { path, old_path, status, additions, deletions }`.
    `path` is the new path (the old path for a deletion). `old_path` is set
    for renames and copies. `status` is one letter: `A M D R C T`.
    `additions` and `deletions` are `null` for a binary file.
  - Runs two `git diff-tree -r -z -M --no-commit-id --root --diff-merges=first-parent`
    calls concurrently, one with `--numstat`, one with `--name-status`.
    The name-status list decides which files appear and their order. Numstat
    supplies the counts, matched by new path. A file missing from numstat
    gets `null` counts.
- `commit_stats(path, shas[]) -> CommitStat[]`
  - `CommitStat { sha, files, additions, deletions }`, in the order given.
    A binary file counts as one file with no lines.
  - One `git log --no-walk=unsorted --format=%x01%H --numstat -z -M --diff-merges=first-parent <shas>`
    process. An empty list runs nothing. More than 200 shas is an error that
    names the count.
  - Read by the graph's changes column (see graph-columns-and-markers.md).
- `commit_show(path, sha) -> string`
  - The commit message only: `git show -s --format=%B`. Subject, blank line,
    body. Before, it returned `--format=fuller` headers plus the full patch.
    Both callers (this panel's body, and the amend form's pre-fill in the
    staging box) read the text as the message, so both were wrong. See Invariants.
- `diff_commit(path, sha, file?, old_file?, ignore_ws?)` (`src-tauri/src/commands/diff.rs`)
  - Adds `--diff-merges=first-parent`. A merge is diffed against its first
    parent. The center diff panel gets the same base.
  - `old_file` is the file's name in the parent when the commit renamed it.
    With it the call adds `-M` and lists both paths after `--`, so git pairs
    them and the change shows as a rename. Without it the rename would show as
    an add, since git sees only the new path.
  - Every file path is a `:(literal)` pathspec, so `[`, `*` and `?` in a name
    are not read as globs. The shared helper is `push_file_paths`.

### IPC (`src/lib/ipc/index.ts`)
- `commitFiles(path, sha): CommitFileStat[]`, `commitStats(path, shas): CommitStat[]`.
- `commitShow(path, sha)` keeps its signature. `diffCommit(path, sha, file?, ignoreWs?, oldFile?)`
  adds `oldFile`, the rename's old name (see `diff_commit` above).

### Frontend
- `CommitDetailsPanel.svelte` (the panel) loads `commitFiles` and `commitShow`
  concurrently. It owns the sort and view state, the requested set and the
  loaded diffs. It publishes the visible file order to `commitFiles` in
  `stores/graphNav.ts` for ArrowUp/Down.
- Components in `src/lib/components/commit/`:
  - `CommitHeader.svelte`: sha and close, subject and body, author, parents, refs.
  - `CommitFileList.svelte`: Path or Tree list. Each row has a toggle that shows
    its diff below the list. A click on the row opens the file in the center diff.
    "Collapse All" folds tree directories. "Load all N diffs" appears past the cap.
  - `CommitInlineDiffs.svelte`: the shared `DiffViewer` with the requested diffs.
  - `CommitActions.svelte`: cherry-pick, revert, branch, tag, checkout, reset.
- Pure logic in `src/lib/commit/`:
  - `fileTree.ts`: tree, sort, visible order (`listOrder`).
  - `fileStatus.ts`: status names and colors, count labels (`bin` for binary).
  - `diffCache.ts`: `DiffCache`, the cache with an injected loader.
  - `commitDiffs.ts`: the app-wide cache, bound to `ipc.diffCommit`.
  - `renamedFrom.ts`: `renamedFromStats` finds a renamed file's old name in the
    commit's file list. `renamedFromLog` does the same for a file history row.
  - `diffRequests.ts`: the 30-diff cap for "Show diffs".
  - `format.ts`: commit body and local date text.
- The "Show diffs" checkbox requests the first 30 files of the visible order.
  Past 30, "Load all N diffs" requests the rest. Unchecking clears every request.
- Expanding a row calls `diffCommit(repo, sha, file, ignoreWs, oldFile)`, where
  `oldFile` is `renamedFromStats(files, file)`. The result is cached per
  `(repo, sha, ignoreWs, file, oldFile)`: the same new name with another old
  name is another diff.

## Invariants
- Selecting a commit runs at most three git processes, whatever its size:
  two `diff-tree` (concurrent) and one `commit_show`. Expanding a file runs one
  more (`diff_commit` with `file`). Nothing runs for a file that is not expanded.
- Merge commits diff against the first parent everywhere: the list, the inline
  diffs and the center diff. All three use `--diff-merges=first-parent`, so the
  list and the diff agree.
- A root commit diffs against the empty tree (`--root`). No parent lookup runs.
- Paths come from `-z` output only. Text output (`--numstat` without `-z`) quotes
  paths with tabs, newlines or non-ASCII bytes, so it is never parsed.
- The list order is `listOrder(files, view, sort)` in both the rows and the
  keyboard navigation. They cannot disagree.
- "Show diffs" requests at most `EXPAND_ALL_CAP` (30) diffs. More than that needs
  "Load all", which is shown only while some file is not requested.
- A diff result is dropped (kept in the cache only) when the user has left the
  commit, collapsed the row, or changed `-w` in the meantime.
- Cache keys include `ignoreWs`: `-w` changes which hunks git emits, so the two
  results are different diffs.
- A failed diff load is not cached. The next expand asks git again.
- A load carries a sequence number. A slow load for an earlier commit never
  replaces the files of the commit selected now.
- `-w` changes the diffs, not the file list. The list shows every changed file.
  Whitespace-only files stay in the list with `-w` on, and their diff reads "No
  changes (whitespace hidden)". Before this change they were dropped from the list.
- `commit_show` returns the message only. The amend pre-fill reads the same
  command, so it benefits too. Before, it read the `fuller` headers as the subject.
- The 200-sha cap on `commit_stats` is checked before git runs.

## Out of scope
- A combined (`-c` / `--cc`) diff for merges. A merge shows its first-parent
  diff only.
- Renames whose old name is not known. The center diff and the inline diff get
  the old name from the commit's own file list, so both show a rename. A file
  history row reads it from the next older row, so a rename at the end of a
  loaded page still shows as an add until the next page loads.
- Virtualizing the file list. A huge commit still renders every row. Only the
  diffs are lazy now.

## Rejected alternatives
- **`git show --numstat` text parsing without `-z`.** Paths with tabs, newlines
  or non-ASCII bytes come out quoted (`"dir\303\274.txt"`), and the split breaks.
- **Loading every diff in the background after the list.** Same memory and DOM
  cost, just later. Every diff still runs a git process, and the commit still
  renders everything at once.
- **`<sha>^1` as the diff base, with a parent lookup for root commits.** The
  lookup is a third git process per selection. `--root` with
  `--diff-merges=first-parent` takes one argument shape for every commit.
- **`git show --first-parent --numstat` for the list.** Works with `--format=`
  and `-z`, but `git show` is porcelain: user config such as `log.showSignature`
  changes its output. `diff-tree` is plumbing with a fixed format, which is what
  the parsers read.
- **Counting lines from the diff text.** Needs the diff, the cost this change removes.

## Tests
- `cargo test`:
  - `git/numstat.rs`: `-z` numstat and name-status records (plain, binary, rename,
    copy, tabs and newlines in paths, the leading newline of `git log`),
    the join by path, `commit_stats` totals and the real `git log` layout.
  - `commands/commits.rs`: `diff-tree` and `commit_stats` arguments, the sha cap,
    option-like shas refused, `commit_show` returns the message.
  - `commands/diff.rs`: `commit_diff_args` (first parent, file after the sha, `-w`).
- `bun test src/lib`: `commit/*.test.ts` (tree and order, cache, status labels,
  cap, body and date text).

## Implementation map
- Backend: `src-tauri/src/commands/commits.rs`, `src-tauri/src/git/numstat.rs`,
  `src-tauri/src/commands/diff.rs` (`commit_diff_args`).
- Frontend: `src/lib/components/CommitDetailsPanel.svelte` and
  `src/lib/components/commit/`. Pure logic in `src/lib/commit/`.
  Navigation store: `src/lib/stores/graphNav.ts`.
- `StashDetailsPanel.svelte` keeps its own loader (`diff_stash`, which takes the
  whole stash diff). It does not use this pattern.
