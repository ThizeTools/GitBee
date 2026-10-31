# Undo and redo

## Purpose

Undo and redo for the repo actions GitBee performs, for the session. Before
this, Undo only soft-reset the last commit, and Redo recommitted only its
subject line. Discard file, discard all, reset --hard, drop stash, and
deleting a branch or tag had no way back.

Related: `repo-refresh.md` (what runs after an action), `app-dialogs.md`
(confirm dialogs and toasts).

## Entries

Each row is one recorded action. The undo and redo columns say what the
entry does; the entry is recorded only after the action succeeded.

| Action (where it starts) | Undo | Redo |
|---|---|---|
| Commit (`CommitBox`) | soft reset to the HEAD the commit sat on | commit again, same message (amend stays amend) |
| Checkout of a branch or commit (`graphscroll.ts`: menus, double-click, detail panel, top bar) | checkout the HEAD it replaced (branch name, or sha when detached) | checkout the target again |
| Create branch (branch menu, palette, top bar "New branch") | `git branch -d` the branch | create it again at the same sha |
| Delete local branch (branch menu) | create it at the tip sha it had | `git branch -d` again |
| Create tag (commit and branch menus, commit details) | delete the tag | create it again with the same sha and message |
| Delete local tag (tag menu) | create a lightweight tag at its commit | delete it again |
| Reset soft or mixed | reset the same mode to the old HEAD | reset to the target |
| Reset hard | apply the backup of the changes, after resetting to the old HEAD | back up the changes again, reset to the target |
| Discard changes in one file | write the file's backed-up bytes back (or delete it if it was absent) | back it up again, discard again |
| Discard a hunk or picked lines (diff viewer, `hunk-staging.md`) | write the file's backed-up bytes back | back it up again, apply the same discard patch |
| Discard all changes (staging panel) | apply the discard-all backup commit | discard all again, keep the new backup |
| Drop stash (graph row, sidebar, stash panel) | put the stash commit back on the stash list | find its index by sha, drop it |

Not recorded: push, fetch, pull and fast-forward (remote side effects), merge,
rebase, cherry-pick, revert, stash create, pop and apply, rename, patch
apply, worktrees, and changes made outside GitBee.

## Public contract

### Backend (`src-tauri/src/commands/undo.rs`)

| Command | Input | Output | Notes |
|---|---|---|---|
| `backup_file` | `path`, `file` | `string \| null` | Blob sha of the worktree file (raw bytes, `--no-filters`). `null` when the file is absent. |
| `restore_file` | `path`, `file`, `blob: string \| null` | none | `null` deletes the file if present. Creates parent folders. |
| `discard_all_with_backup` | `path` | `string \| null` | `null` when there was nothing to discard. Same effect as `reset --hard` plus `clean -fd`. |
| `apply_backup` | `path`, `sha` | none | `git stash apply --index <sha>`. Leaves the stash list alone. |
| `stash_store` | `path`, `sha`, `message` | none | `git stash store -m <message> <sha>`. |

Errors use `AppError`. A sha or ref starting with `-` is rejected by
`checked_ref`. A git output that is not an object id fails with `Parse`,
which names the value and the expected 40 or 64 hex digits.

### Frontend

- `stores/history.ts`: `pushUndo(entry)`, `undoLast()`, `redoLast()`, and
  the readable stores `canUndo`, `canRedo`, `nextUndoLabel`, `nextRedoLabel`.
  Undo and redo are bound to Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y in `+page.svelte`.
- `stores/historyStack.ts`: the pure stacks (`HistoryStacks`), `undoNewest`,
  `redoNewest`, and the `UndoEntry` type `{ label, undo, redo? }`.
- `stores/undoEntries.ts`: one factory per row of the table above.
  `resetHardKeepingChanges` is shared by the reset menu and the hard-reset redo.
- `menus/stashActions.ts`: `dropStashAt(repo, index)`. Confirms, drops, and
  records. The three drop paths call it.
- `stores/refLookup.ts`: pure lookups (`findRefSha`, `pickRemoteForBranch`,
  `findStashIndex`, `checkoutTargetOf`, `fastForwardFailureMessage`).

## Invariants

1. An entry is pushed only after its action succeeded. A failed action
   leaves no entry, and its error shows in the usual place.
2. Each entry captures what it needs before the action runs: the HEAD sha,
   the previous checkout target, the backup sha, the stash sha and message.
   Undo never reads HEAD@{1} or the current stash index.
3. An entry acts on the repo path it was recorded with, not on the active
   tab. The refresh after a step runs for the active tab.
4. Recording a new action clears the redo stack.
5. The undo stack holds at most 50 entries. The oldest is dropped.
6. A step (undo or redo) that fails is dropped: it is not redoable and not
   pushed back. The repo may be half changed, so the user sees git's error in
   a toast and decides what to do.
7. Only one undo or redo runs at a time. A second call while one runs is ignored.
8. Discard all and reset --hard keep the working-tree changes in a backup
   commit that is removed from the stash list but stays in the object store.
   Undo can bring them back; the user's own stash entries are not touched.
   If the reset fails after the backup, the changes are restored at once.
9. The backup helper drops the top stash only when `git stash push` created
   a new commit (`backup_created`). Otherwise the user's own top stash would
   be dropped.
10. Cancelling a prompt aborts the action. `null` (cancel) aborts. An empty
    string keeps its own meaning: a lightweight tag, or no stash message.
    This covers the tag prompts (commit menu, commit details), the stash
    prompts (palette "Stash all changes", "Stash file" in `stashOneFile`), and
    the branch and tag name prompts.
11. Pull on a branch that is not checked out fast-forwards it from the remote
    that has `<remote>/<branch>`, preferring origin: `git fetch <remote>
    <branch>:<branch>`. It does not check out the branch. HEAD pulls as before.

## Why these choices

- Discard all uses a stash-backed backup rather than the simpler "blob per
  file". A blob per file misses untracked directories and index state, and
  stash keeps both. The backup is dropped from the stash list at once,
  because the user manages that list and a visible "GitBee backup" entry
  would be clutter.
- Commit undo resets to the captured sha rather than HEAD@{1}, which is the
  reflog position before the last move. Once other undoable moves are on the
  stack, HEAD@{1} points at the wrong commit.
- Hard reset keeps the old behaviour of `reset --hard` and adds the backup as
  a separate step, so the undo of a reset does not depend on a reflog.

## Out of scope

- Persistence across restarts. The stacks live in memory.
- Undo of anything that touches a remote (push, fetch, pull, remote branch
  delete, tag push).
- Reconciling the stacks with changes made outside GitBee (terminal, other
  tools). A stale entry fails safely: git refuses the step and the toast shows why.

## Known limits

- Annotated tag: the undo of a delete recreates a lightweight tag, so the
  annotation message is not kept. Keeping it needs the tag object sha, which
  the graph does not carry.
- Branch create undo uses `git branch -d`. It refuses when the branch has
  commits that HEAD does not contain. The entry is then dropped, and the toast
  shows git's message. Nothing is lost.
- Discard all and reset --hard create stash commits, so they need a git
  identity, the same as a commit does.
- A checkout that made changes move (auto-stash) may fail to undo when the
  tree is dirty. Git refuses, so nothing is lost.
- Backup blobs and stash commits are unreachable and are pruned by `git gc`
  after the default two weeks. An undo after that fails with git's error.
- The history is global, not per tab. Entries from several tabs interleave;
  each one still acts on its own repo.
- Checkout to a remote branch with no local copy (`checkoutRemoteAndJump`)
  records only the checkout. The local branch it created stays.
- The first commit on an unborn branch records no entry: there is no HEAD to
  return to.

## Rejected alternatives

1. A generic undo driven by the reflog, as GitKraken does. The reflog does
   not cover worktree discards or the names of deleted branches, and reading
   it needs parsing heuristics.
2. Visible "GitBee backup" stashes. They clutter the stash list the user manages.
3. A blob per file for discard all. It misses untracked directories and the
   index.
4. Undo of a commit through HEAD@{1}. See "Why these choices".

## Tests

- `stores/history.test.ts`: order, the 50-entry cap, redo cleared on push,
  a failed undo or redo dropped, one-way entries.
- `stores/refLookup.test.ts`: ref lookup, remote choice (origin first, whole
  branch name), stash index by sha, checkout target, the fast-forward message.
- `commands/undo.rs` tests: argument builders, `parse_object_id`,
  `backup_created`, `remove_file_if_present`.
- Commands that need a real repo are not unit tested. Their git behaviour was
  checked by hand in a scratch repo.
