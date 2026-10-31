# Clone options and progress (2026-10)

Neighbors: [git-progress.md](git-progress.md) (the `git-progress` event the
dialog reads), [github-integration.md](github-integration.md) (the GitHub
clone path, which takes no options yet).

## Purpose
A full clone of a large repo downloads every commit of every branch. The clone
dialog can ask for a shallow clone (`--depth N`) or for one branch
(`--branch B --single-branch`). Both are off by default, so a plain clone is
still a full clone. The dialog also shows the clone's progress, which it did
not before.

## Public contract

### Backend: `repo_clone` (`src-tauri/src/commands/repo_extra.rs`)
Arguments: `url`, `dest`, `depth: Option<u32>`, `branch: Option<String>`,
`single_branch: bool`. Returns the clone's folder, `dest/<name>`, as before.

- `depth`: `Some(n)` with `n >= 1` adds `--depth n`. `Some(0)` is refused.
  `None` is a full clone.
- `branch`: a non-empty name adds `--branch <name>`. The name goes through
  `checked_ref`, so a leading `-` is refused. An empty name adds nothing.
- `single_branch`: `true` adds `--single-branch`.
- `url`: a leading `-` is refused (`checked_remote_url`, shared with `remote_add`).
- Built args: `clone --progress [--depth N] [--branch B] [--single-branch] -- <url> <target>`.
  The `--` ends option parsing before the URL.
- Every check runs before the destination folder is created, so a refused
  request leaves nothing on disk. Each error names the offending value.
- Progress goes to `git-progress`, keyed by the target folder, as before.

### Frontend
- `src/lib/clone/cloneOptions.ts` (pure): `checkCloneForm(form)` returns
  `{ options, error }`. `options` are sent only when `error` is null.
  `parseDepth(text)` accepts whole numbers of at least 1.
- `ipc.repoClone(url, dest, opts)` with `opts = { depth, branch, singleBranch }`.
- `CloneModal.svelte`, URL source only:
  - "Shallow clone" checkbox. Checked, it shows a Depth field (default 1).
  - "Single branch" checkbox. Checked, it shows an optional branch name.
  - An error from `checkCloneForm` shows under the options, and Clone is disabled.
  - While cloning, the footer shows the clone's label and bar (git-progress.md).
- The GitHub source sends no options: `github_clone` takes none.

## Invariants
- Defaults give a plain clone: `depth: null`, `branch: null`, `singleBranch: false`.
- A value starting with `-` never reaches git as an option: a URL or a branch.
- A depth below 1 is refused in the dialog and in the backend.
- A refused clone creates no folder.

## Out of scope
- Options for the GitHub clone (`github_clone`). It goes through the token
  path in `commands/github.rs`, which this change does not touch.
- Cancelling a clone (see git-progress.md).
- Partial clones (`--filter`) and submodule options.
- Turning a shallow clone into a full one (`git fetch --unshallow`) from the app.

## Rejected alternatives
- **One option string passed to git.** Splitting it on spaces would let a value
  become several arguments. Typed fields keep each value as one argv entry.
- **Shallow on by default.** A shallow clone hides history: `log`, `blame` and
  the graph stop at the depth without a warning. Off is git's default.
- **Checking only in the dialog.** Any caller of the command reaches the
  backend, so the backend checks the same rules.
