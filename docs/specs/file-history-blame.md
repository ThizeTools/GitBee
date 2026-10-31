# File history and blame (2026-10)

Neighbors: [commit-details.md](commit-details.md) (the per-file diff that the
history view reuses, and the `-z` and first-parent rules), [diff-viewer.md](diff-viewer.md)
(the viewer that draws the commit diff, read-only here), [graph-loading.md](graph-loading.md)
(the graph row that "Show in graph" scrolls to).

## Purpose
Answer two questions about one file without leaving the app:

- Which commits changed this file, and what did each one change? (history)
- Who last changed each line, and when? (blame)

The old viewers were a dialog that listed 50 subjects, and a dialog that showed
the first 40 blame lines as text. Neither could follow a rename, reach the graph,
or open the file as it was at an older commit. Both are now center-pane views,
opened from the staging file menu, the diff header, or the palette.

## Public contract

### Backend (`src-tauri/src/commands/files.rs`, parsers in `src-tauri/src/git/file_log.rs` and `src-tauri/src/git/blame.rs`)

- `file_history(path, file, limit?, skip?) -> FileLogEntry[]`
  - `limit` defaults to 500 and is clamped to 1..2000. `skip` defaults to 0.
  - Runs `git log --follow --name-status -z --diff-merges=first-parent --format=%x01%H%x00%P%x00%an%x00%ae%x00%at%x00%s -n<limit> --skip=<skip> -- :(literal)<file>`.
  - `FileLogEntry { sha, parents, author_name, author_email, timestamp, subject, path_at_commit, status }`.
    `path_at_commit` is the file's name in that commit. Before a rename it is the
    old name. `status` is one letter: `A M D R C T U X`.
  - A commit with no change record for the file is not listed.
- `file_blame(path, file, rev?) -> BlameResult`
  - Runs `git blame --porcelain [<rev>] -- <file>`. Without `rev` it blames the
    working tree, so uncommitted lines appear.
  - `BlameResult { lines: BlameLine[], commits: { [sha]: BlameCommit } }`.
    `BlameLine { sha, orig_line, final_line, content }`. `BlameCommit { author_name,
    author_email, author_time, summary }`. Lines are in file order. `author_time`
    is seconds since the epoch.
  - An all-zero sha is an uncommitted line. Its commit entry has the summary
    `Not committed yet`.
- Errors: an empty file name, an option-like `rev` (`-x`), and a git failure all
  return `AppError`. The message names the value.

### IPC (`src/lib/ipc/index.ts`)
- `fileHistory(path, file, limit?, skip?)`, `fileBlame(path, file, rev?)`, with
  the types `FileLogEntry`, `BlameLine`, `BlameCommit`, `BlameResult`.
- `diffCommit(path, sha, file)` (unchanged) draws the selected commit's diff.

### Center modes (`src/lib/stores/center.ts`)
- `{ kind: "history", file }`, set by `showFileHistory(file)`.
- `{ kind: "blame", file, rev? }`, set by `showFileBlame(file, rev?)`. `rev`
  omitted means the working tree.
- `CenterPanel.svelte` renders `FileHistory` and `FileBlame` for these modes.

### Components (`src/lib/components/history/`)
- `FileHistory.svelte`: left list of commits, right diff of the selected commit.
  - Pages of 200. "Load more" asks for the next page with `skip`.
  - `HistoryRow.svelte`: avatar, subject, author and relative date, status badge
    for a non-modified file, short sha. A click selects. A right click or the `⋯`
    button opens the row menu.
  - Row menu and header buttons: "Show in graph", "Blame at this commit",
    "Copy sha". The diff comes from `diffCommit(repo, sha, path_at_commit)`,
    read-only (`DiffViewer mode="readonly"`).
- `FileBlame.svelte`: code with syntax highlighting and a gutter per run of lines
  from one commit.
  - Gutter: short sha, author, relative date, and a 3px age bar. The bar is
    fully opaque for the newest commit and 0.2 for the oldest.
  - Hovering the gutter shows a tooltip with the summary, author, full date and
    full sha.
  - Clicking the sha shows the commit in the graph. The `↶` button blames the
    parent revision (`sha^`).
  - Rows are fixed at 18px. Only the rows on screen (plus 10 above and below)
    are drawn.
- Entry points: the staging file menu "File History" and "File Blame"
  (`staging/fileActions.ts`), and the "History" and "Blame" buttons in the diff
  header (`DiffPanel.svelte`).

### Pure logic (`src/lib/history/`)
- `age.ts`: `ageBounds(times)`, `ageOpacity(ts, bounds)`.
- `blameRows.ts`: `blameRowViews(result, range, bounds)`, `startsGroup`,
  `isUncommittedSha`, `committedTimes`, `resultAgeBounds`.
- `virtualRange.ts`: `visibleRows(scrollTop, viewport, rowHeight, count, overscan)`.
- `historyMenu.ts`: the row menu items, built from injected actions.
- `historyActions.ts`: the store-bound actions (graph scroll, center mode, clipboard).

## Invariants
- A view load runs one git process. History: one `git log` per page. Blame: one
  `git blame` per load. "Show in graph" and the row menu run no git. Selecting a
  commit runs one `diff_commit`, and nothing runs for a commit that is not selected.
- `file_history` matches the file literally: the `:(literal)` pathspec stops git
  from reading `*`, `?` or `[` in a name as glob characters. `git blame` takes its
  file argument as a literal path and refuses the magic (`no such path`), so blame
  gets no prefix. Both forms are covered by tests.
- `--` separates the file from options in both commands. A name that starts with
  `-` cannot become an option.
- Revisions pass `checked_ref`, so a value starting with `-` is refused.
- Paths come from `-z` output and the porcelain `content` lines only, never from
  quoted text output.
- The commit diff and "Blame at this commit" use `path_at_commit`, the file's
  name at that commit. Using the current name would miss a file before a rename.
- A load carries a sequence number. A reply for an older file, revision or repo is
  dropped, so the view never shows another file's rows or diff.
- Blame rows are positioned by index (`top = index * 18px`). The DOM holds only
  the visible range, whatever the file length.
- Age shading is computed from the whole blame's commit times, not from the rows
  on screen. A row's shade does not change as the user scrolls.
- Uncommitted lines are full strength, have no date, and get no sha link or
  `sha^` action.

## Out of scope
- Line-level history (`git log -L`). The view lists commits that touched the file,
  not those that touched one line.
- `--ignore-revs-file` and the `-w`, `-M` and `-C` blame options. Blame uses git's
  defaults.
- Renames in the diff. `diff_commit` takes one path, so a rename commit's diff
  shows the whole file as added. This is the same limit as commit-details.md.
  Fixing it changes `diff_commit`'s contract for every caller.
- Blame of a line across a rename at `sha^`. The `↶` action reuses the current
  file name, so a file renamed before that commit fails with git's error.
- Files with more than about 1.8 million lines. The scroll height is one element,
  and browsers cap element heights near 33 million px.
- Keyboard navigation of the history list, and a list virtualizer. A page is 200
  rows, and "Load more" fetches the next page.

## Rejected alternatives
- **`git log -p --follow` loading every patch.** Each commit's patch reaches the
  webview before anything shows. The history of a large file would be megabytes.
  The diff for one commit comes from `diff_commit` when the user selects it.
- **`git blame` without `--porcelain`.** Its text columns are padded and the
  author name can contain spaces and parentheses, so a parser cannot tell a
  name from the line content reliably. Porcelain gives each field its own line.
- **`git blame --line-porcelain`** (what the old code used). It repeats the
  metadata for every line, so the output grows with the line count. `--porcelain`
  sends the metadata once per commit, and the parser keeps one map for it.
- **`:(literal)` on blame.** git refuses it (`no such path`). Blame does not read
  pathspecs, so a plain path after `--` is already literal.
- **One DOM row per line with no virtualizing.** A 50k-line file would build
  50k rows and their highlighted HTML at once, and every blame load would pay for it.
- **Native `title` tooltips on each line.** A group spans many rows, so a row
  tooltip shows only one line's text. The custom tooltip is placed at the pointer
  and shows the commit once.
- **A virtualized history list.** Paging 200 commits per click keeps each
  git call and each render bounded, with much less code than a virtualizer.

## Tests
- `cargo test` (`src-tauri`):
  - `git/file_log.rs`: header and record parsing, a rename (new name for the
    renamed commit, old name before it), a delete, multiple parents, a path
    with a tab and a newline, a commit with no record, the literal pathspec,
    the limit clamp, and an empty file name.
  - `git/blame.rs`: porcelain with a repeated sha header, boundary and previous
    lines, uncommitted lines, tabs in content, SHA-256 names, and the blame
    arguments (rev placement, option-like rev refused, no literal magic).
  - `commands/files.rs`: the existing image and write-path tests (unchanged).
- `bun test src/lib/history`: `age.test.ts`, `virtualRange.test.ts`,
  `blameRows.test.ts`, `historyMenu.test.ts`.

## Implementation map
- Backend: `src-tauri/src/commands/files.rs` (`file_history`, `file_blame`),
  `src-tauri/src/git/file_log.rs`, `src-tauri/src/git/blame.rs`.
- Frontend: `src/lib/components/history/` (`FileHistory.svelte`,
  `HistoryRow.svelte`, `FileBlame.svelte`), `src/lib/history/` (pure logic and
  `historyActions.ts`), `src/lib/stores/center.ts` (modes and setters),
  `src/lib/components/CenterPanel.svelte` (branches),
  `src/lib/components/staging/fileActions.ts` and `DiffPanel.svelte` (entry points).
