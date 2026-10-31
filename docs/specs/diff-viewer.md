# Diff viewer (2026-10)

Neighbors: [graph-loading.md](graph-loading.md) (per-file line cap and
`omitted_lines`, commit diffs loaded per file), [repo-refresh.md](repo-refresh.md)
(when the working-tree diff reloads).

## Purpose
Make diffs faster to read without making them slower to load:

- Syntax colors for code lines.
- Word-level marks on lines that changed in place, so the changed token is
  visible without comparing two lines by eye.
- Side-by-side view for review of rewritten blocks.
- Ignore whitespace, for reformatting commits.
- Image previews (old and new) instead of "Binary file".

The viewer is shared by the center diff panel, commit details and stash details.
Each feature is an add-on to the existing hunk rendering; the hunk model and the
line cap are unchanged.

## Public contract

### Backend commands (`src-tauri/src/commands/diff.rs`)
- `diff_commit(path, sha, file?, old_file?, ignore_ws?)`, `diff_stash(path, index, ignore_ws?)`,
  `diff_workdir(path, file?, ignore_ws?)`, `diff_index(path, file?, ignore_ws?)`
  return `FileDiff[]`. `ignore_ws: true` adds `-w`. Absent or `false` gives the
  exact diff. `diff_commit` diffs a merge against its first parent
  (`--diff-merges=first-parent`), see [commit-details.md](commit-details.md).
- `file_bytes_base64(path, rev?, file)` (`src-tauri/src/commands/files.rs`)
  returns `{ base64, mime }`.
  - `rev` absent: the working-tree file.
  - `rev = "INDEX"`: the staged blob (`:<file>`).
  - Any other `rev`: `<rev>:<file>`, validated by `checked_ref`, so a leading `-`
    is refused.
  - Only the image extensions in `image_mime` are accepted; anything else is an
    error.
  - Bytes over 20 MiB are refused with an error naming the size. The size is read
    before the blob is loaded (`fs::metadata` for the worktree, `cat-file -s` for
    revisions).
  - Revision bytes come from `cat-file blob`, which applies no textconv or
    smudge filters.

### IPC (`src/lib/ipc/index.ts`)
- `diffCommit(path, sha, file?, ignoreWs?)`, `diffStash(path, index, ignoreWs?)`,
  `diffWorkdir(path, file?, ignoreWs?)`, `diffIndex(path, file?, ignoreWs?)`.
- `fileBytesBase64(path, rev: string | null, file)`. `null` means the working tree.

### Frontend
- `DiffViewer.svelte` props: `diffs`, `revs?: ImageRevs | null`, `loading?`,
  `mode?` (`unstaged` | `staged` | `readonly`, default `readonly`) and `onPatch?`.
  In `unstaged` and `staged` the hunk and line actions show. See
  [hunk-staging.md](hunk-staging.md).
  It renders the toolbar, the file list and the empty state. Without `revs`,
  image files show "Binary file".
- `diffPrefs` store (`src/lib/stores/diffPrefs.ts`): `{ layout: "unified" | "split",
  ignoreWs: boolean }`, persisted under the localStorage key `gitbee.diffPrefs`.
  Every diff surface reads the same value; the toolbar writes it.
- Image revisions, chosen by the caller (`src/lib/diff/revs.ts`):

  | Mode                | old             | new        |
  |---------------------|-----------------|------------|
  | Unstaged            | `INDEX`         | worktree   |
  | Staged              | `HEAD`          | `INDEX`    |
  | Commit `<sha>`      | `<sha>^`        | `<sha>`    |
  | Stash `N`           | `stash@{N}^`    | `stash@{N}`|

  A side whose path is `""` in `FileDiff` (added or deleted file) shows "(none)".
- Word diff: `pairChangedLines` pairs the i-th removed line with the i-th added
  line of each removal run that is directly followed by an addition run, up to
  the shorter run. `wordDiffRanges` returns changed character ranges by token LCS.
- Split view: `toSplitRows(hunk)` returns rows. Context fills both sides. A paired
  removal and addition share a row. An unpaired line leaves the other side empty.
- Highlighting: `langForPath(path)` gives a language name or null.
  `highlightCode(line, lang)` gives safe HTML, one line at a time.
  Token colors come from theme variables (`--remote`, `--sha`, `--accent`,
  `--modified`, `--tag`, `--fg-muted`), so light and dark themes both work.

## Invariants
- Highlighting never injects unescaped file content. Every file-derived string
  reaching `{@html}` passes through `escapeHtml` or through highlight.js, which
  escapes its own output. The `dv-wd` wrapper is fixed markup.
- Word diff runs only on paired lines. Context lines, unpaired lines and
  lines of pairs longer than `MAX_WORD_DIFF_CHARS` (500) never get word ranges.
- `-w` is requested only through `ignoreWs`. The view shows a "whitespace hidden"
  badge while it is on. Hunk staging must request the exact diff (no `-w`).
- Image bytes go through `<img src="data:…">`, never as inline SVG markup, so an
  SVG cannot run scripts.
- The 20 MiB image limit is checked before the blob is read into memory.
- Every revision string sent to git passes `checked_ref`.
- Blocked or throwing localStorage falls back to in-memory defaults; no error is shown.
- The `omitted_lines` notice and the binary handling are unchanged.
- The toolbar stays visible when a diff is empty, so whitespace hiding can always be
  turned off.

## Accepted limitations
- Highlighting is per line. Block comments and multi-line template strings can
  color the continuation lines wrongly.
- `toml` is highlighted with the `ini` grammar. `svelte` and `vue` are
  highlighted as XML.
- Word diff matches only 1:1 paired lines. A moved line is never paired.
- With `-w`, line numbers still come from git's output for the hunks it emits.
- Rename detection is per file, so a renamed image shows its old and new paths on
  the matching sides.

## Out of scope
- Semantic or AST diff.
- Expanding context beyond the hunks git emits (`-U3`).
- Hunk and line staging is in [hunk-staging.md](hunk-staging.md). It uses the exact
  (non `-w`) diff.

## Rejected alternatives
- **shiki**: WASM and large grammars, and slow when called per line.
- **Monaco diff editor**: heavy, and it fights the virtualized panels.
- **Whole-file highlighting, then mapping back to hunks**: needs the full file
  content for every diff, which the diff commands do not load.
- **Separate commands for ignore-whitespace**: four commands would duplicate code.
  An optional flag keeps one code path.
- **Custom Tauri protocol for images**: a new protocol handler for one preview. The
  20 MiB base64 cap is simpler and the cost is bounded.
- **`git show <rev>:<file>` for image bytes**: textconv filters could alter the bytes.
- **Client-side whitespace comparison**: git's `-w` decides which hunks change,
  so the viewer uses it.

## Implementation map
- Backend: `src-tauri/src/commands/diff.rs`, `src-tauri/src/commands/files.rs`.
- Frontend: `src/lib/components/DiffViewer.svelte` and
  `src/lib/components/diff/` (`DiffToolbar`, `UnifiedHunk`, `SplitHunk`,
  `ImageDiff`, `diff.css`). Pure logic in `src/lib/diff/`
  (`highlight`, `wordDiff`, `linePairs`, `lineHtml`, `splitRows`, `image`, `revs`,
  `paths`). Preferences in `src/lib/stores/diffPrefs.ts`.
- Callers: `DiffPanel.svelte`, `CommitDetailsPanel.svelte`, `StashDetailsPanel.svelte`.

## Tests
- `bun test src/lib`: `diff/*.test.ts` and `stores/diffPrefs.test.ts`.
- `cargo test`: `commands/diff.rs` (`push_ignore_ws`, file path separator) and
  `commands/files.rs` (`image_mime`, `blob_spec`, `check_size`).
