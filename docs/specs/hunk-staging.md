# Hunk and line staging (2026-10)

Neighbors: [diff-viewer.md](diff-viewer.md) (the viewer and its `-w` rule),
[undo-history.md](undo-history.md) (discard is undoable),
[repo-refresh.md](repo-refresh.md) (what reloads after an action).

## Purpose

Stage, unstage or discard part of a file from the center diff, as GitKraken does:
a whole hunk, or only the +/- lines the user picked. Before this, the header
buttons acted on the whole file, so a file with one wanted change and one
unwanted change could not be committed in two parts from the UI.

## Public contract

### Backend (`src-tauri/src/commands/patch.rs`)

- `apply_patch_text(path, patch, cached, reverse)` runs
  `git apply --recount --whitespace=nowarn [--cached] [--reverse] -` with the
  patch on stdin. Errors come back as git's stderr (`AppError::GitFailed`).
  Nothing is applied when git refuses the patch.

### IPC (`src/lib/ipc/index.ts`)

- `applyPatchText(path, patch, cached, reverse)`.

### Frontend

| Action (mode)                   | Built from             | git flags                | Undo                         |
|---------------------------------|------------------------|--------------------------|------------------------------|
| Stage hunk / lines (unstaged)   | worktree diff          | `--cached`               | none                         |
| Unstage hunk / lines (staged)   | index diff             | `--cached --reverse`     | none                         |
| Discard hunk / lines (unstaged) | worktree diff          | `--reverse`              | `discardPatchUndo` (see below) |

- `src/lib/diff/patchBuilder.ts`: `buildPatch(file, selection, reverse?)`.
  `selection` is `{ kind: "hunk", hunkIndex }` or `{ kind: "lines", lines: LineRef[] }`.
  Returns the patch text, or null when no picked line is a change.
- `src/lib/diff/lineSelection.ts`: the pick state and its click rules.
- `src/lib/diff/patchAction.ts`: `runPatchAction(io, repo, file, selection, action)`.
  `io` is `ipc` in the app and a fake in tests. Discard reads the file's blob
  before it applies, and returns what the undo entry needs.
- `src/lib/stores/undoEntries.ts`: `discardPatchUndo(repo, file, blob, patch)`.
- `DiffViewer.svelte` props: `mode: "unstaged" | "staged" | "readonly"` (default
  `readonly`, used by commit and stash details) and `onPatch(file, selection, action)`.
  `DiffPanel` passes `unstaged` or `staged` in working-directory modes and runs the
  action through `withBusy`, which refreshes the status and reloads the diff.
- Hunk header buttons: "Stage hunk" and "Discard hunk" when unstaged, "Unstage hunk"
  when staged.
- Line picks: a click on a +/- line's gutter picks that line. Shift+click picks the
  changed lines from the anchor to the clicked line, inside one hunk. Ctrl+click
  toggles one line. Context lines cannot be picked. A floating bar shows
  "Stage N lines" / "Discard N lines" (or "Unstage N lines") and "Clear".
- Split layout: a picked row uses the old side for a removal and the new side for
  an addition. Both sides carry the same line index.

## Patch rules

The builder works from the diff's own hunks, so the picked lines are exact.

- A picked change keeps its sign. Context always stays.
- Forward patch (stage): an unpicked removal becomes context, since the line
  stays. An unpicked addition is dropped, since it is not staged.
- Reverse patch (unstage, discard): an unpicked addition becomes context, since
  the target already holds it. An unpicked removal is dropped.
- The old start keeps the file's numbering. The new start shifts by the net
  change of the hunks emitted before it. A side with no lines uses git's `,0`
  form. `--recount` makes git count from the body anyway, and git finds a hunk
  that is off by a few lines by searching around its position.
- A `\ No newline at end of file` marker stays with its line when that line stays,
  and is dropped with it otherwise.
- Both header sides keep the real path, even for an added or deleted file.

## Invariants

1. A patch never contains an unpicked change. Each unpicked line is context or is
   dropped, so applying a patch changes only the picked lines.
2. Discard is undoable. The file's blob is read before the apply. Undo writes it
   back (or deletes the file if it was absent). Redo backs up again and applies the
   same patch. An apply that fails records no entry.
3. Ignore whitespace (`-w`) turns off hunk and line actions. The hint "Turn off
   ignore whitespace to stage hunks" shows in the toolbar. The hunk diff the actions
   use is always the exact one.
4. A file whose diff was cut at `MAX_FILE_DIFF_LINES` offers no hunk or line actions,
   because its hunks may be partial.
5. Commit and stash diffs (`readonly`) offer no actions.
6. A selection that would put a change after a context line that lacks a final
   newline is refused with an error. Applying it would join two lines. The error
   names the file and suggests picking the whole hunk, which always works.
7. Picks are per file and clear when the diff reloads, so a pick never names a line
   that moved.

## Accepted limitations

- Unstaging every line of a new (added) file leaves an empty staged entry for it.
  `git reset` would remove the entry. Use the header "Unstage File" for that case.
  Verified in a scratch repository with git 2.53.
- A partial unstage of a new file keeps the file in the index with the remaining
  lines. Verified: unstaging `n1` of `n1, n2` leaves `n2`.
- Untracked files have no hunks in `git diff`, so they have no hunk actions. The
  header "Stage File" is the only way to stage them.
- Line endings: CRLF files apply correctly, because git keeps the target's line
  endings. The parser drops the trailing `\r` from the diff text, but `git apply`
  takes the endings from the file being patched. Verified in a scratch repository
  for a whole-hunk stage.

## Out of scope

- Hunk editing by hand, and splitting a hunk finer than the picked lines.
- Staging inside untracked files.
- Staging with `-w`: a whitespace-only diff does not describe the real file.

## Rejected alternatives

- **`git add -p` driven through stdin.** Its interactive prompts are localized, and
  parsing them is brittle. `git apply` takes the same patch text without prompts.
- **Building the new file content and writing it with
  `git update-index --cacheinfo`.** That reimplements the merge of index and worktree
  that `git apply` already does, and this app would be the only place it is wrong.
- **One forward builder with a plain `git apply --reverse`.** The forward rule
  turns an unpicked removal into context. Under `--reverse` the target does not hold
  that line, so the apply fails whenever a hunk mixes kinds (an unpicked
  removal beside a picked addition). The builder takes a `reverse` flag instead.
  Verified in a scratch repository.
- **`/dev/null` headers for added and deleted files.** Under `--reverse`, git reads
  a partial unstage as a whole-file deletion. The index entry was emptied (verified),
  so both sides keep the real path.

## Implementation map

- Backend: `src-tauri/src/commands/patch.rs`.
- Pure logic: `src/lib/diff/patchBuilder.ts`, `lineSelection.ts`, `patchAction.ts`.
- Components: `src/lib/components/DiffViewer.svelte`, `diff/HunkHeader.svelte`,
  `diff/LineSelectionBar.svelte`, `diff/UnifiedHunk.svelte`, `diff/SplitHunk.svelte`,
  `diff/DiffToolbar.svelte`, `diff/hunkView.ts`. Caller: `DiffPanel.svelte`.
- Undo: `src/lib/stores/undoEntries.ts` (`discardPatchUndo`).

## Tests

- `bun test src/lib/diff`: `patchBuilder.test.ts` (whole hunk, single added and
  removed lines, mixed blocks, multi-hunk offsets, no-newline markers, reverse
  rules, headers, null results), `lineSelection.test.ts` (click rules),
  `patchAction.test.ts` (flags per action, backup before discard, failed apply).
- `cargo test`: `commands/patch.rs` (`apply_args` for the four flag combinations).
- Checked in scratch repositories against git 2.53 (not in the test suite, since it
  needs real repos): whole-hunk stage, a single line in a mixed block, unstage with
  an offset from a staged hunk above, discard of a single line, the no-newline
  refusal, CRLF, and partial and full unstage of a new file.
