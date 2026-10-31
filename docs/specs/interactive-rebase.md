# Interactive rebase

## Purpose

Rewrite the commits between a chosen commit and HEAD in one dialog: reorder,
reword, squash, fixup and drop them, the way GitKraken does. Before this, the
app could amend only HEAD (commit edit) and reset. Older commits could not be
reworded, folded or removed without a terminal.

Related: `undo-history.md` (the undo entry this records), `conflict-resolution.md`
(what happens when the rebase stops on a conflict), `repo-refresh.md` (refresh
after the action).

## Entry

- Commit row menu, "Interactive rebase from here…". It shows only when the commit
  is a loaded strict ancestor of HEAD (`canStartRebaseFrom` in `lib/rebase/range.ts`).
  HEAD itself and commits off HEAD's line get no entry.
- The list is `base..HEAD` over the loaded graph: the commits above the chosen one,
  base excluded. A base that is not loaded yields no list.
- The branch menu has no entry. Rebasing a branch onto another is `branch_rebase`.

## Editor

`components/rebase/RebaseEditor.svelte` (modal) with `RebaseRow.svelte` per commit.

- Rows are newest first, like the graph. Each row: drag handle, action select,
  short sha, subject, author.
- Keys (on the focused row): Up / Down move focus; Alt+Up / Alt+Down move the row
  (focus follows); `p` pick, `r` reword, `s` squash, `f` fixup, `d` drop. Ctrl+Enter
  starts, Escape cancels. The row reads keys only while it has focus, so the
  message box and the select keep theirs.
- Drag: HTML5 drag from the handle onto another row.
- Message box: shown for reword rows, and for pick rows that a squash or fixup
  folds into (the group's message). The text is loaded with `commit_show` when
  the box first appears. A reword cannot start until its message is loaded.
- Footer: `N commits → M` (M = rows not dropped and not folded) and one problem
  line. Start is disabled while there is a problem.

## Public contract

### Backend (`src-tauri/src/commands/rebase_interactive.rs`)

| Command | Arguments | Result |
|---|---|---|
| `rebase_interactive` | `path`, `base`, `items: RebaseItem[]` (oldest first) | `RebaseOutcome` |

`RebaseItem` is `{ action: "pick" \| "reword" \| "squash" \| "fixup" \| "drop", sha, message: string \| null }`.
`sha` must be 40 or 64 hex digits. `message` is read for pick and reword only.

`RebaseOutcome` is `{ status: "done" \| "stopped", message, before, after }`.
`before` is HEAD before the run. `after` is HEAD after a finished run, and null
when it stopped.

Refusals, all before any file is written or git runs:

| Case | Error text starts with |
|---|---|
| Empty list, every row dropped, reword with no message, blank message, duplicate or non-hex sha | the value, and the expected shape |
| Oldest kept row is squash or fixup | `the oldest kept commit <sha> cannot be squash or fixup` |
| A rebase already in progress | `a rebase is already in progress` |
| Tracked changes in the worktree | `Commit or stash your changes first` |
| A merge commit in `base..HEAD` | `the range ... contains merge commit` |
| The commits of `base..HEAD` differ from the list | `the commits in ... changed since the list was opened` |

A temp path with `"`, `$`, a backtick or a newline is refused with `cannot quote`.

### Backend helpers

- `commands/rebase_todo.rs`: pure rules. `validate_items`, `build_todo`,
  `amend_after_rows`, `message_writes`, `listed_shas_match`, `sh_path`,
  `sequence_editor_command`.
- `git/runner.rs`: `run_with_env(cwd, args, envs)` (`run` calls it with none),
  `NO_EDITOR_ENV` (`GIT_EDITOR=true`), `executable()`.
- `commands/merge.rs`: `op_continue` passes `NO_EDITOR_ENV` for `rebase` (`continue_envs`).

### Frontend

- `lib/rebase/types.ts`: `RebaseAction`, `RebaseEntry`, `RebaseItem`, `RebaseOutcome`.
- `lib/rebase/model.ts`: pure. `toItems` (reverses to oldest first), `messageToSend`,
  `firstProblem`, `summary`, `editableFlags`, `moveRow`, `updateRow`, `keyAction`.
- `lib/rebase/range.ts`: pure. `commitsToRebase`, `canStartRebaseFrom`,
  `hasMergeCommit`, `hasTrackedChanges`, `entriesFromCommits`.
- `lib/rebase/open.ts`: `openInteractiveRebase(baseSha)`, the menu entry point.
- `ipc.rebaseInteractive(path, base, items)` in `lib/ipc/index.ts`.
- `stores/undoEntries.ts`: `interactiveRebaseUndo(repo, before, after)`, built on `resetUndo`.

## Mechanism

`git rebase -i <base>` runs with two environment variables:

- `GIT_SEQUENCE_EDITOR` = `cp "<run>/todo.txt"`. Git runs it with its own todo
  path appended, so `cp` replaces git's todo with ours.
- `GIT_EDITOR` = `true`, so a squash's combined message is accepted as it is.

The todo has one line per row, oldest first: `pick`, `squash`, `fixup` or
`drop` with the full sha. A row whose message is new (a reword, or an edited
group head) is followed by an amend:

    exec "<git>" commit --amend --no-edit --allow-empty -F "<run>/message-<index>.txt"

The amend goes after the last row of the group (the head and the squash or
fixup rows that follow it). The run folder is `<temp>/gitbee-rebase-<pid>-<nanos>`
and holds `todo.txt` and the message files. Paths go through `sh_path`:
forward slashes, and the refusals above.

## Invariants

1. A rebase call never opens an editor: `GIT_EDITOR=true` on every `rebase -i`
   and on `op_continue` for a rebase, the sequence editor is replaced, and the
   amend uses `--no-edit -F`.
2. Refused with tracked changes in the worktree. Untracked files do not count,
   as in git. `reset --hard`, the undo, leaves them alone too.
3. Refused with a merge commit in `base..HEAD`.
4. The list must match `base..HEAD` exactly, by sha, when the run starts. The
   graph can be stale, so the backend asks git again.
5. The oldest kept commit is never squash or fixup. Every squash or fixup has an
   older kept commit to join.
6. Only full hex shas and the run's file paths reach the todo. The message text
   goes only to files, so it cannot inject a todo line.
7. An undo entry is pushed only after `status: "done"`. Undo is a hard reset to
   `before`, redo a hard reset to `after`. Both come from the backend's reading
   of HEAD, not from the graph store.
8. On `done` the run folder is removed. On `stopped` it stays, because the amend
   lines of the rest of the rebase still read the message files. No undo entry.
9. Stopped means git failed and the rebase state (`rebase-merge` or
   `rebase-apply`) is on disk. Any other failure removes the run folder.
10. A rebase already in progress is refused before anything else.

## Why these choices

- Todo through `GIT_SEQUENCE_EDITOR` and `cp`: git keeps its own parser and
  rebase state, and no stdin is needed. `cp` ships with Git for Windows' sh.
- Reword as an amend from a file, not the `reword` action: `reword` opens the
  editor for each commit. `exec ... -F` reads the text from a file.
- The amend goes after the group's last row: a squash combines the messages of
  its group, so an amend placed earlier would be overwritten.
- The dirty check looks at tracked files only, matching git. Refusing on
  untracked files would block users who keep build output in the worktree.
- `exec` runs git by its full path. `resolve_git` lets the app use a git that is
  not on PATH, and the exec line runs in a shell that would not find it.
- `before` and `after` come from the backend: the graph store can be a refresh
  behind HEAD.
- Message boxes also appear for squash heads, because the request was to edit
  the message of a group. An untouched head sends no message, so git's combined
  message stays.
- The editor mounts on `document.body` (`lib/rebase/open.ts`), not through the
  root modal switch in `stores/modals.ts`. Those files and `+page.svelte` were
  outside this change. Moving it into the switch is a small follow-up.

## Out of scope

- `--rebase-merges`. A merge in the range is refused.
- The `edit` action (stop to amend, then continue) and `break`.
- Autosquash (`fixup!` commits are not reordered automatically).
- Commits not loaded in the graph. The base must be loaded.
- Changing authors or dates.
- The branch menu entry "Interactive rebase onto…".
- Keeping the editor's state across a restart or a closed modal.

## Known limits

- A stopped run's folder stays in the OS temp directory until the OS cleans it.
  `op_abort` does not know about it, and the rest of a continued rebase still reads it.
- `merge`, `cherry-pick` and `revert` `--continue` are unchanged. They can still
  open an editor in the hidden process. That is a separate decision.
- A message is trimmed at its end when loaded (`commit_show` output has a trailing newline).
- The mount and keyboard paths were checked by type check, build and reading.
  The app was not driven in a window for this change.

## Rejected alternatives

1. Driving `git rebase -i` with `GIT_SEQUENCE_EDITOR` set to GitBee's own exe.
   That needs a CLI mode in the app binary, so the GUI executable would also
   have to act as git's todo editor, and it must start with that argument on
   every call. `cp` needs only the sh that git already ships.
2. Cherry-picking the commits one by one onto the base. That re-implements
   rebase, and it loses git's conflict and continue state and the todo that
   `--continue` reads.
3. The `reword` action with an editor script per commit. Each reword opens an
   editor, and the script has to choose a message per commit.
4. Writing new messages into the todo. Quoting a message in a shell line is
   fragile, and a message can contain anything. A file is safer.

## Tests

- `commands/rebase_todo.rs`: the pure rules, todo text, amend placement, sha and
  path checks.
- `commands/rebase_interactive.rs`: real git in scratch repos under the temp dir.
  Reword keeps the tree, squash folds, an edited squash head keeps only its edit,
  drop removes, a reordered list stops on a conflict and keeps the rebase state,
  a dirty worktree and a merge in range are refused, and a list that no longer
  matches the range is refused.
- `git/runner.rs`: `run_with_env` passes the variable to git.
- `commands/merge.rs`: `continue_envs` for rebase and the other operations.
- `lib/rebase/model.test.ts`, `lib/rebase/range.test.ts`: the editor's rules.
