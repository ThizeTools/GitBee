# Repo refresh, watcher and checkout (2026-10)

Neighbors: [graph-visual-2026-04.md](graph-visual-2026-04.md),
[ui-overhaul-2026-04.md](ui-overhaul-2026-04.md),
[graph-loading.md](graph-loading.md) (what a full refresh costs).

## Purpose
Keep the UI in sync with the repository without getting in the user's
way. Three reported problems drove this spec:

1. "It keeps loading git all the time": the left pane was covered by the
   busy veil and refreshes ran in a near-continuous loop.
2. "Clicking another branch does not switch to it": double-clicks landed
   on the veil, and double-clicking a graph row did nothing.
3. "File is in use by GitBee" when moving/renaming/deleting things in
   the repo from Explorer or another tool.

## Root causes (as found in v0.4.0)
- `git status` ran without `GIT_OPTIONAL_LOCKS=0`. It rewrites
  `.git/index` to refresh stat data, which the recursive watcher saw
  as a real change, which triggered another status: a self-feeding loop.
  The optional `index.lock` it takes also made the user's own git
  commands in other tools fail with "index.lock exists".
- The watcher watched the whole working tree, including ignored build
  output (`target/`, `node_modules/`, `.svelte-kit/`). A running build
  or dev server produced a refresh (10 git processes) every 400 ms.
- The 400 ms debounce was leading-edge: it fired on the first event of a
  burst and dropped the rest, so a long burst re-fired for its whole
  duration and the final state of the burst could be missed.
- `refreshActive` had no in-flight guard: watcher, autofetch, focus and
  actions ran overlapping refreshes.
- Auto-fetch on window focus and tab activation refreshed non-silently,
  so the veil covered the sidebar right when the user came back to the
  window and tried to click a branch.
- The watcher keeps an OS directory handle on the repo root for as long
  as it runs, including while GitBee sits in the tray.

## Public contract

### Backend: `repo-changed` event (`src-tauri/src/watcher.rs`)
- Input: `watcher_start(path)` / `watcher_stop()` (unchanged).
- Output: event `repo-changed { path, scope }`, emitted at most once per
  burst. `scope` is `"full"` when a meaningful `.git` path other than
  `index` changed or the path cap overflowed; `"status"` when only
  `.git/index` and/or non-ignored working-tree paths changed. Editing,
  staging and unstaging files are by far the most common bursts and
  need only `git status`, not the 10-process full refresh.
- A burst ends after `QUIET` (300 ms) without events, or `MAX_WAIT`
  (2 s) after its first event, whichever comes first (trailing edge).
- A burst emits only if at least one of:
  - a path inside `.git` that is not noise (`*.lock`, `*.tmp`,
    `FETCH_HEAD`, `ORIG_HEAD`, …) and not under `objects/`, `logs/`
    or `hooks/` (those always change together with `refs/`/`index`);
  - a working-tree path that `git check-ignore -z --stdin` does not
    report as ignored (one git process per burst; tracked files are
    never reported ignored, so edits to them always count);
  - more than `MAX_TRACKED_PATHS` working-tree paths (skip the check,
    refresh once).
- Any `check-ignore` failure counts as "not ignored" (refresh). Erring
  toward a refresh is cheap; a missed refresh shows stale state.

### Backend: git runner (`src-tauri/src/git/runner.rs`)
Every git process gets `GIT_OPTIONAL_LOCKS=0`. Only optional locks are
affected (the stat refresh of `git status`); commands that must write
the index still lock it.

Every git process also gets `GIT_TERMINAL_PROMPT=0` and
`-c http.lowSpeedLimit=1 -c http.lowSpeedTime=60`. Without a terminal
git could wait forever on a username prompt, and a stalled HTTP
transfer never ended, so a background fetch hung and kept the auto-fetch
`inFlight` guard set for the rest of the session. Callers that pass
their own `-c http.lowSpeed*` (initial push of a new repo) override
these, because later `-c` values win.

### Frontend: `refreshActive(opts)` (`src/lib/stores/repoRefresh.ts`)
- At most one refresh runs at a time. Calls during a run coalesce into
  one follow-up run, which starts after the current one. The follow-up
  is silent only if every coalesced caller asked for silent.
- A caller awaiting `refreshActive()` after an action always sees data
  loaded after its call (never the result of an older in-flight run).
- Only fields whose content changed are written to the tab, so an idle
  refresh does not re-render the graph or sidebar.
- Non-silent only for: first load of a tab, explicit "Refresh repo",
  and user actions (`withBusy`, `runAction`, checkout).
- Background refreshes (watcher, auto-fetch, focus, tab re-activation)
  are silent.
- `opts.scope`: `"status"` loads only `git status`; `"full"` (default)
  loads everything and passes the current graph `fingerprint` so an
  unchanged graph skips `git log` (see graph-loading.md). Coalesced
  callers merge to `"full"` if any of them asked for it.
- Every completed refresh bumps `worktreeTick`, even when nothing in the
  status list changed. The working-tree diff panel reloads on it: an
  already-modified file edited again keeps an identical status entry, so
  keying on `status` showed a stale diff.
- Auto-fetch skips a tick while `busy` is set, so a background
  `fetch` never races a user's pull/push/commit for refs or locks.

### Frontend: busy veil (`busyVisible`)
Rising edge delayed by 250 ms, falling edge by 350 ms. Fast operations
never show the veil; it still blocks stacking long actions.

### Frontend: watcher pause on blur (`src/lib/stores/windowFocus.ts`)
- Window `blur` → `watcher_stop` (releases the directory handle).
- Window `focus` → `watcher_start` + one silent refresh.

### Checkout gestures
| Where | Single click | Double click |
|---|---|---|
| Sidebar local branch | jump graph | checkout |
| Sidebar remote branch | jump graph | checkout (create tracking branch if missing) |
| Graph ref pill | select row | checkout that branch |
| Graph row | select row | checkout the branch at that commit |

Graph row double-click picks a local branch at the commit other than the
current one; else a remote branch (not `*/HEAD`), creating a local
tracking branch. A commit with no branch, or only the current branch,
is a no-op. The second click of a double-click never toggles the
selection off.

Remote checkout creates the local branch only when no local branch of
that name exists (decided from the graph refs, not from a failed
checkout). Errors surface as "Checkout failed" toasts with git's stderr.

## Invariants
- No refresh is triggered by GitBee's own read-only git commands.
- At most one `refreshActive` load is in flight per app.
- Background refreshes never show the veil.
- While the window is unfocused GitBee holds no watcher handle.

## Out of scope
- Replacing the watcher with polling.
- Incremental graph loading (a full refresh with moved refs still runs
  `git log -n <limit>`; see graph-loading.md for paging).
- Timeouts on local git commands (a slow `log` on a huge repo is not a
  hang). Network stalls are bounded by the low-speed limit above.
- Single-click checkout.

## Rejected alternatives
- **Single-click checkout in the sidebar.** One stray click would
  switch branches (and prompt to stash). GitKraken uses double-click;
  the real bug was the veil eating the clicks.
- **Hard-coded ignore list (`node_modules`, `target`, …).** Misses
  project-specific outputs and wrongly drops tracked files living in
  such folders. `check-ignore` uses the repo's own rules.
- **Keep watching while unfocused, delay pause by N seconds.** Users hit
  the lock right after alt-tabbing to Explorer; any delay keeps the bug.
  Cost accepted: an unfocused GitBee updates when focused again.
- **Leading-edge debounce with a longer window.** Still fires mid-burst
  and can miss the final state.
- **`--no-optional-locks` per command.** Easy to forget on new
  commands; the env var on the runner covers all of them.
- **Finer scopes (refs-only, stash-only, remotes-only).** Each extra
  scope is another code path to keep in sync; with the graph
  fingerprint a "full" refresh whose graph did not change already skips
  the expensive part. Two scopes cover the common bursts.
