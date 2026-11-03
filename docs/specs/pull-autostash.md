# Pull auto-stash (2026-11)

Neighbors: [git-progress.md](git-progress.md) (the progress runner `remote_pull`
uses), [repo-refresh.md](repo-refresh.md) (`runAction` and the busy wait).

## Purpose
A pull with local changes in files the pull touches failed with git's
"Your local changes … would be overwritten by merge". Generated files that
change on every build, like `linux/flutter/generated_plugins.cmake`, hit this
all the time. GitKraken stashes on its own without asking, and users expect
the same here. So Pull now stashes local changes, pulls, and re-applies them,
with no prompt.

## Public contract

### Tauri command `remote_pull` (`src-tauri/src/commands/remotes.rs`)
| Input | Type | Meaning |
|---|---|---|
| `path` | string | Repo path |
| `rebase` | bool \| null | `--rebase` when true |

Runs `git pull --progress --autostash [--rebase]`.

Returns `PullOutcome { stash_kept: bool }`:
- `false`: no local changes, or they were re-applied cleanly.
- `true`: re-applying them conflicted. Git still exits 0, leaves the
  conflicted files with markers (status `UU`) and keeps the changes as
  `stash@{0}` (message `autostash`). The user can resolve the files, or reset
  them and apply the stash later.

Errors are unchanged: git's stderr, e.g. a network failure or merge conflict.
When a merge stops on conflicts, git holds the stash in `MERGE_AUTOSTASH` and
re-applies it once the merge is committed or aborted. GitBee does nothing extra.

### Detecting a kept stash
`refs/stash` is read (`rev-parse -q --verify`) before and after the pull.
Git's autostash uses `stash create`, which does not move `refs/stash`; only a
failed re-apply stores the entry there. So a different tip after the pull
means the stash was kept. Checked on git 2.53 against a scratch repo: a clean
re-apply leaves `refs/stash` absent, and a conflicting one sets it to the
"Created autostash" sha.

### Frontend (`src/lib/stores/pullNotice.ts`)
`pullNotice(outcome, branch, moved)` picks the toast for a finished pull.
The top bar, the branch menu and the palette use it:
- stash kept → info "Pulled, but stash kept" (wins over the two below)
- HEAD did not move → info "Already Up-to-Date"
- otherwise → success "Pulled Successfully"

The palette stays silent on success, as before, and shows only the stash-kept toast.

## Invariants
- A successful pull never loses local changes. They are in the working
  tree or in `stash@{0}`.
- No prompt before stashing.
- Checkout keeps its own ask-first auto-stash (`graphscroll.ts`). This
  spec only covers pull.

## Out of scope
- **A setting to turn auto-stash off** (GitKraken users ask for Off /
  Tracked-only / All). Add it only if someone needs plain `git pull` back.
- **Branch fast-forward** (`branch_fast_forward`). It never touches the
  working tree, so there is nothing to stash.
- **Opening the conflict view on a kept stash.** The toast points to
  `stash@{0}`; applying it goes through the normal stash actions.

## Rejected alternatives
- **Ask first, like checkout.** Rejected after comparing with GitKraken.
  Pull with local changes is the common case, and a dialog every time adds
  a click that only ever has one answer.
- **GitBee's own `stash push -u` → pull → `stash pop`.** It duplicates what
  `--autostash` already does. It also gets the merge-conflict case wrong:
  popping while a merge is in progress fails. Git defers the re-apply.
- **Parsing git's "Applying autostash resulted in conflicts" stderr.** The
  progress runner drops non-progress lines on success, and the text is
  translated in localized gits. The `refs/stash` check works in any locale.
- **`--autostash` with `-u` (untracked files).** Git's autostash covers
  tracked changes only. Untracked files block a pull only when the pull adds a
  file at the same path, which is rare and the error says so.
