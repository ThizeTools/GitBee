# Branch drag and drop

Neighbors: [undo-history.md](undo-history.md) (checkout undo, and why merges
and rebases are not in it), [repo-refresh.md](repo-refresh.md) (what runs after
an action), [app-dialogs.md](app-dialogs.md) (toasts for the outcome).

## Purpose

Combining two branches took several steps: check one out, find the other in the
menu, pick merge or rebase. GitKraken-style drag and drop starts that from the
graph or the sidebar. Drag a branch and drop it on another branch; a context
menu lists what can be done with the pair, and the user picks one.

## Drag source and drop targets

- **Source**: local and remote branch badges in the graph, and local and remote
  branch rows in the sidebar. Tags, stashes and the detached HEAD pill are not
  sources. A combined badge (local `main` with `origin/main`) drags as the local
  branch. `<remote>/HEAD` is never a source or a target.
- **Drag image**: a pill showing the branch name, removed when the drag ends.
- **Target**: a graph row that carries a branch badge, the badge itself, and a
  sidebar branch row. A row drop lands on the row's branch: HEAD first, then
  the first local branch, then the first remote one. A badge drop lands on that
  badge's branch.
- **Highlight**: the hovered target gets class `drop-target`. Only one target
  is highlighted at a time, and only when the pair has a menu.
- **No-op drops**: dropping a branch on itself, a remote branch on a remote
  branch, or a row with no branch opens nothing.

The drag state lives in `refDragSource` (`{ name, kind }` while dragging) and
`dropHoverKey` (`src/lib/stores/refDrag.ts`).

## Contract

`dragOptions(src, target, headBranch, graph)` returns the options in this
order. `S` is the source, `T` the target, `HEAD` the checked-out local branch.
"Ancestor" means the target tip is a strict ancestor of the source tip within
the loaded graph (`reachableFrom`); equal or unloaded tips count as not.

| Target | Source | Options (in menu order) | Git commands |
|---|---|---|---|
| `T` is HEAD | any | `Merge S into T` | `merge S` |
| | | `Rebase T onto S` | `rebase S` |
| | | `Fast-forward T to S` (only if T is an ancestor of S) | `merge --ff-only S` |
| local, not HEAD | `S` is HEAD | `Rebase S onto T` | `rebase T` |
| | | `Merge T into S` | `merge T` |
| local, not HEAD | local, not HEAD | `Checkout T and merge S` | checkout T, `merge S` |
| | | `Fast-forward T to S` (only if T is an ancestor of S) | `fetch . refs/heads/S:refs/heads/T` |
| | | `Checkout S and rebase onto T` | checkout S, `rebase T` |
| | remote, not HEAD | `Checkout T and merge S` | checkout T, `merge S` |
| remote `R/x` | `S` is HEAD | `Merge R/x into S` | `merge R/x` |
| | local, not HEAD | `Checkout S and merge R/x` | checkout S, `merge R/x` |
| | remote | none | |

Notes on the table:

- A remote target is never fast-forwarded and never checked out by a drop.
  A remote source is only merged, since it has no local branch to check out.
- A fast-forward of a non-HEAD branch moves its ref without a checkout, through
  `branch_fast_forward_local` (a refspec update, which git refuses when it is
  not a fast-forward, and refuses for the checked-out branch).
- "Checkout X" uses the shared checkout path (`checkoutAndJump`): it asks about a
  dirty tree and records its own undo entry. The merge or rebase after it runs
  only if HEAD ended on X.
- Every option runs through `runAction`, so the graph refreshes and busy state
  and the error log behave as for other actions. A failed merge or rebase shows
  an error toast, and the operation banner shows any conflicts.

## Invariants

- A drop never runs an action. It opens the menu, and an option runs only when
  the user clicks it.
- A drop opens no menu when the pair has no options. The drag-over is not
  accepted, so no drop highlight appears either.
- No option creates a commit by itself. Fast-forwards use `--ff-only` or a
  refspec git refuses unless it is a fast-forward.
- No option moves or checks out a remote-tracking ref.
- The fast-forward check reads only loaded graph nodes. If either tip is not
  loaded, the option is hidden rather than guessed.
- Checkout-based options check that HEAD ended on the checkout target before
  they merge or rebase, so a declined dirty-tree prompt stops the sequence.

## Undo

Only the checkout step is recorded, through the existing checkout undo entry.
Merges, rebases and fast-forwards are not recorded in undo history in this
version. The undo history spec lists the recorded actions; those are unchanged.
A fast-forward can be reversed by hand from the reflog.

## Backend

`src-tauri/src/commands/branches.rs`:

- `branch_fast_forward_local(path, src, target)`: `git fetch . refs/heads/<src>:refs/heads/<target>`.
- `branch_merge_ff_only(path, from)`: `git merge --ff-only <from>`.

Both names pass `checked_ref`, so a leading `-` is rejected before git runs.
Argument builders are unit-tested (`fast_forward_local_args`, `merge_ff_only_args`).

## Out of scope

- Dragging commits (cherry-pick), and dragging tags.
- Dragging a branch onto a remote to push it.
- Undo for merges, rebases and fast-forwards.
- A keyboard way to start the same menu.
- Fast-forwarding a non-HEAD branch to HEAD when HEAD is the source. Dragging
  HEAD onto another branch offers rebase and merge only, per the table.

## Rejected alternatives

- **Run a default action on drop.** A drop that merges or rebases on its own
  is one mis-drop away from an unwanted history change. GitKraken asks too. One
  extra click is cheaper than an undo that cannot cover merges.
- **A separate modal with the options.** The menu is faster to reach, and it
  matches the existing context menus for branches, commits and tags.
- **Rebase onto a remote target.** The decided table limits remote targets to
  merges. A rebase onto a remote-tracking ref would rewrite a local branch onto
  a ref that may be stale. Left for a later decision.

## Files

- `src/lib/menus/dragOptions.ts`: pure option builder, `DropOptionCache`, `rowDropTarget`.
- `src/lib/menus/dragMenus.ts`: opens the menu and runs the chosen option.
- `src/lib/stores/refDrag.ts`: drag state, drag image, drop handlers.
- `src/lib/components/RefBadges.svelte`, `graph/GraphRow.svelte`, `Sidebar.svelte`:
  wiring (drag source, drop target, highlight).
- `src/lib/ipc/index.ts`: `branchMergeFfOnly`, `branchFastForwardLocal`.
