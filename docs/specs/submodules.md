# Submodules pane

Neighbors: [repo-refresh.md](repo-refresh.md) (when the list is reloaded),
[git-progress.md](git-progress.md) (why update runs without progress events),
[app-dialogs.md](app-dialogs.md) (prompt and alert used by Add and the
uninitialized refusal), [ref-drag-and-drop.md](ref-drag-and-drop.md) (the other
sidebar sections).

## Purpose

A repo with submodules hides them in `git status` and the graph. The user cannot
see which submodules are not checked out, which sit on another commit than the
parent records, or which have local changes, without a terminal. This pane lists
them in the sidebar with their state, and gives the common actions (update,
sync, add) plus a way to open a submodule as its own repo tab.

## Public contract

### Backend commands (`src-tauri/src/commands/submodules.rs`)

| Command | Arguments | Result | Git run |
|---|---|---|---|
| `submodule_list` | `path` | `Submodule[]` | `config -f .gitmodules`, `submodule status --recursive`, `status --porcelain=v2` (pathspec-limited) |
| `submodule_update` | `path`, `sub_path?`, `init`, `recursive` | `()` | `submodule update [--init] [--recursive] [-- <sub_path>]` |
| `submodule_sync` | `path` | `()` | `submodule sync --recursive` |
| `submodule_add` | `path`, `url`, `sub_path` | `()` | `submodule add -- <url> <sub_path>` |

`Submodule` (serialized as is):

```
name: string            section name from .gitmodules (may contain dots)
path: string            checkout path, relative to the repo, '/' separators
url: string             "" when .gitmodules has no url
branch: string | null   submodule.<name>.branch, when set
sha: string | null      commit the parent records (index); null when not in the index
state: "uninitialized" | "clean" | "modified" | "out_of_sync" | "conflict"
```

The sidebar calls the update command with `sub_path` named `subPath` on the JS
side (Tauri maps snake_case arguments to camelCase). The argument is a
submodule path, because git takes paths, not names.

### States

`git submodule status` prints one prefix character per submodule. The state
follows that prefix, with one exception: dirty content.

| Rank | Condition | State |
|---|---|---|
| 1 | prefix `U` | `conflict` |
| 2 | prefix `-`, or the path has no status line | `uninitialized` |
| 3 | `status --porcelain=v2` marks the submodule's `m` or `u` flag | `modified` |
| 4 | prefix `+` | `out_of_sync` |
| 5 | otherwise | `clean` |

The first matching rule wins. `classify` in `git/submodules.rs` is the single
place this table lives.

### Errors

- Input validation runs before git. A URL that is empty, starts with `-`, or has
  a control character is refused. A path that is empty, absolute, contains `:`,
  a control character, a leading `-`, or an empty, `.` or `..` segment is refused.
  The message names the offending value and the expected shape.
- A git failure is returned as the usual `GitFailed` error and shown in the error bar
  through `withBusy`.
- `git config` exiting with status 1 (no `submodule.*` key matches) is an empty
  list, not an error.

### Frontend

- `RepoTab.submodules: Submodule[]` (`stores/repoState.ts`). Empty when the repo
  has no submodules.
- `activeSubmodules` (`stores/submodules.ts`): derived from the active tab.
- The sidebar section "Submodules" with its count appears only when the list is
  non-empty. Its header has a "⋯" menu: "Update all (init, recursive)" and
  "Add submodule…".
- Row double-click opens the submodule as a repo tab at `joinRepoPath(repo, path)`.
  An uninitialized submodule is refused with an alert: "Initialize first".
- Row menu: Update, Update (init), Sync URLs, Open in new tab, Open folder
  (`file_show_in_folder`), Copy path.
- "Add submodule…" prompts for the URL, then for the folder, which defaults to
  the URL's last segment. It is offered in the section header menu and in the
  command palette (Action category, repo-bound, id `action:submodule-add`). The
  palette entry is the way to add the first submodule, since the section is
  hidden while a repo has none.

## Invariants

- **No git process when `.gitmodules` is absent.** `submodule_list` checks for the
  file first and returns `[]`. Ordinary repos pay one `is_file` call.
- **Status-only refreshes never read submodules.** The list is fetched in the
  full snapshot (`repoRefresh.ts` `fetchFullSnapshot`) only. A status-only refresh
  runs on every save, and the submodule read costs one process per call plus
  work proportional to the submodule count.
- **Dirty-state check is limited to submodule paths.** The status call passes the
  declared paths as a pathspec, so its cost does not grow with the size of the
  parent's working tree.
- **Paths never leave the repo.** `sub_path` is validated before it reaches git,
  so `..` and absolute paths cannot point a command outside the repo.
- **Options cannot be smuggled as values.** `submodule add` puts `--` before the
  URL and path.
- **Opening a submodule creates a normal tab.** It goes through `openRepo`, so
  hide, solo and the watcher behave exactly as for any repo.

## Out of scope

- **Committing inside a submodule from the parent tab.** Open the submodule as a
  tab and commit there. The parent tab only shows the "Subproject commit" line.
- **Submodule diffs beyond that line.** The diff viewer is not changed.
- **A nested tree view.** Nested submodules are read by `--recursive` but shown
  only at the top level in the parent's list.
- **Progress for update and add.** These run through the plain runner. Adding
  a `GitOp` variant for submodule commands would touch the shared progress
  event contract; it is left for later.

## Rejected alternatives

- **libgit2 submodule API.** The rest of the app runs git through the CLI
  (`GitRunner`), so the submodule code follows that rule. libgit2 would be a
  second implementation of status and of the update path, with its own quirks.
- **Polling submodule status on status-only refreshes.** The status refresh runs
  on every file save. Adding the submodule read there would charge every save
  for a list that changes only on checkout, update or add. The full refresh
  already runs on those events (HEAD, refs and index changes), so the list
  stays current without the extra cost.
- **A separate store keyed by tab id.** Keeping the list on `RepoTab` lets the
  existing `withChangedFields` comparison skip unchanged lists, and it is cleared
  with the tab. A parallel map would need its own cleanup on tab close.
- **An empty Submodules section that shows only "Add submodule…".** Most repos
  have no submodules, so the section would take sidebar space in every one of
  them to serve one first-add action. The palette entry reaches the same flow
  without changing the sidebar.

## Tests

- `src-tauri/src/git/submodules.rs`: `.gitmodules` parsing (dotted names, order,
  missing path, other keys), status-line prefixes and describe suffix, dirty-flag
  parsing for types 1 and 2 with rename records, the state table, the join.
- `src-tauri/src/commands/submodules.rs`: path and URL validation, argument
  builders (update, add, status pathspec).
- `src/lib/stores/submodules.test.ts`: short sha, separator-aware path join, the
  uninitialized refusal rule, default folder name.
- `src/lib/components/sidebar/filter.test.ts`: the shared filter rule.
- `src/lib/palette/providers/providers.test.ts`: the palette row exists only with
  a repo open.
