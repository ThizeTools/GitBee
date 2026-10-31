# Git LFS awareness

Neighbors: [command-palette.md](command-palette.md) (the "LFS" rows of the
finder), [diff-viewer.md](diff-viewer.md) (where the pointer card is drawn),
[hunk-staging.md](hunk-staging.md) (pointer diffs are never staged line by
line).

## Purpose

1. A repo that stores large files in Git LFS shows those files as pointer
   text. The staging and commit lists give no hint that a file is an LFS file,
   and the diff shows three opaque lines (`version`, `oid`, `size`).
2. The app should say which files are LFS, show the object's size and oid in
   place of the pointer lines, and offer the common LFS commands (pull, fetch,
   track, untrack, install hooks) where the user already works.
3. The app does not manage LFS. It only makes the state visible and runs the
   commands the user would otherwise type.

## Public contract

### Commands (src-tauri/src/commands/lfs.rs)

| Command | Input | Output | Git call |
|---|---|---|---|
| `lfs_status` | `path` | `LfsInfo { installed, version, used, patterns }` | `git lfs version` (once per app session), then a read of `.gitattributes` |
| `lfs_files` | `path`, `paths[]` | the paths that are LFS files | one `git check-attr -z --stdin filter` |
| `lfs_pull` | `path` | none | `git lfs pull` |
| `lfs_fetch` | `path` | none | `git lfs fetch` |
| `lfs_track` | `path`, `pattern` | none | `git lfs track <pattern>` |
| `lfs_untrack` | `path`, `pattern` | none | `git lfs untrack <pattern>` |
| `lfs_install` | `path` | none | `git lfs install --local` |

- `installed` is true when `git lfs version` succeeds. The version string is
  parsed from its `git-lfs/<version>` prefix.
- `used` is true when the repo root `.gitattributes` has a line whose
  attributes include the exact token `filter=lfs`. `patterns` lists those
  lines' first tokens. Comments, blank lines and `-filter` or `!filter` do not
  count.
- `lfs_files` answers `[]` without a git process when `used` would be false.
  Otherwise it runs one `check-attr` with every path on stdin, NUL-separated,
  so a long list cannot overflow the Windows command line.
- Actions (`lfs_pull`, `lfs_fetch`, `lfs_track`, `lfs_untrack`, `lfs_install`)
  fail with `Git LFS is not installed` when `installed` is false. `lfs_track`
  and `lfs_untrack` also reject a pattern that is empty, starts with `-`, or
  spans lines (`validate_pattern`).

### Errors

Git LFS refusals carry the text as is, with no prefix (`AppError::Lfs`). The
other failures keep git's stderr, as `GitFailed` does.

### Frontend store (src/lib/stores/lfs.ts)

- `currentLfs`: the open repo's `LfsInfo`, or null while it loads.
- `currentLfsFlags`: for each path asked about in the open repo, `true` when
  it is an LFS file. A missing key means not answered yet.
- `requestLfsPaths(repo, paths)`: the staging and commit lists call it from an
  effect. Paths already answered are skipped. The rest wait 150 ms, then go out
  as one `lfs_files` call per repo.
- `refreshLfs(repo)`: reloads the status and asks again about every path asked
  before. Track, untrack and install call it.

The status for a repo loads when its tab becomes active, and stays cached
until `refreshLfs` runs.

### UI

- **Badge.** An `LFS` tag sits beside the file name in the staging list (path
  and tree views) and the commit file list (path and tree views). `FileTree`
  takes an optional `lfsFlags` map and draws the tag on each file row, so the
  staging tree reads the same flags as the path list.
- **Pointer card.** When every side of a file's diff is an LFS pointer, the
  viewer shows one card in place of the hunks: `LFS object · <size> · oid
  <short>`. A changed file reads `old → new` for size and oid. A diff that is
  partly a pointer, binary, or truncated shows the normal hunks. Sizes use
  binary units (1 KB = 1024 B).
- **Palette.** With git-lfs installed and a repo open, the finder and the
  `>` actions list offer five rows in the `LFS` category: `LFS: Pull`,
  `LFS: Fetch`, `LFS: Track pattern…` (a prompt, checked by the same rules as
  the backend), `LFS: Untrack pattern…` (a choice over the current patterns,
  or a notice when there are none), and `LFS: Install hooks in this repo`.
  Each row runs through `runAction`, so it logs and toasts like the menus.

## Invariants

- A repo that does not use LFS starts no LFS git process for its files. Its
  only LFS process is the process-wide version probe, once per app session.
  Its files are never sent to `check-attr`, and its file list costs nothing.
- The version probe runs in the temp directory, so a missing repo folder can
  never cache "not installed" for the session.
- Once the probe answers, it is cached for the app session. A git-lfs installed
  while the app runs is seen after a restart.
- Actions never run without git-lfs. Every action passes through one check.
- LFS rows read the open repo when they run, not when the palette opened.
- Pointer cards are display only. A pointer diff never offers line or hunk
  staging, so the staging path cannot write a pointer's text into the index as
  if it were ordinary content.

## Out of scope

- LFS locking (`git lfs lock`, `unlock`, the lock list).
- `git lfs migrate` and `git lfs prune`, and any UI for them.
- Downloading LFS objects for a single file. Pull and fetch act on the whole
  repo.
- Showing the object itself. The card shows size and oid only.
- Detecting LFS in subdirectory `.gitattributes`. `used` reads the repo root
  only, as the contract above says.

## Rejected alternatives

- **Reading pointer files from disk for every file.** A smudged checkout (the
  object was already pulled) replaces the pointer with the real content, so the
  file no longer looks like a pointer. Checking the `filter` attribute with
  `check-attr` is authoritative for both states, and it needs no file reads.
- **Bundling git-lfs.** It is a separate binary with its own release cycle.
  Git for Windows and the common Linux and macOS packages already ship it, so
  the app detects it and offers the actions only when it is there.
- **One git call per file.** The staging list can show hundreds of rows. One
  `check-attr --stdin` per batch keeps the cost flat.
- **Running `git lfs version` for every repo tab.** The answer does not depend
  on the repo, so one probe per session is enough.

## Files

- `src-tauri/src/git/lfs.rs` pure parsers (`.gitattributes`, `check-attr`
  output, version, pattern rules), the `LfsInfo` type, and `check_lfs_paths`.
- `src-tauri/src/commands/lfs.rs` the Tauri commands and the version cache.
- `src-tauri/src/git/runner.rs` `run_with_input`, which feeds stdin to git.
- `src/lib/lfs/` pure modules: `pointer.ts` (pointer parser, pair, labels),
  `size.ts`, `pattern.ts`, `pending.ts` (request batching).
- `src/lib/stores/lfs.ts` the cached status and flags, and the debounced
  requests.
- `src/lib/palette/providers/lfs.ts` the LFS palette rows.
- `src/lib/components/lfs/LfsBadge.svelte` and
  `src/lib/components/diff/LfsPointerCard.svelte`, plus `FileTree.svelte` for the
  tree-row badge.
