# Git progress for fetch, pull, push and clone (2026-10)

Neighbors: [repo-refresh.md](repo-refresh.md) (the runner, auto-fetch
and the `runAction` wait), [github-integration.md](github-integration.md)
(clone through the token).

## Purpose
A big push or clone looked frozen: the only sign of work was the busy
veil, with no phase and no percentage. Git does print progress, but only
to stderr and only when asked, so GitBee now asks (`--progress`) and reads
it while the command runs. The status bar shows it for the current repo,
for example "Pushing… Writing objects 45%" with a thin bar.

## Public contract

### Tauri event `git-progress` (`src-tauri/src/commands/git_progress.rs`)
Payload, one per event:

| Field | Type | Meaning |
|---|---|---|
| `repo` | string | Repo path, as the caller passed it (the target dir for clone) |
| `op` | `"fetch" \| "pull" \| "push" \| "clone"` | Which command |
| `phase` | string \| null | Git's phase name, e.g. `"Writing objects"`; null on `done` |
| `percent` | 0–100 \| null | Null when git printed only a count |
| `done` | bool | `true` once per operation, after git exits |

- `done: true` is sent after every run, also when git fails or cannot
  start. The frontend never keeps a pill for an op that has ended.
- The event is best-effort. A failed emit is ignored; it never changes
  the command's result or error.
- Commands and return types are unchanged: `remote_fetch`,
  `remote_pull`, `remote_push`, `repo_clone` and `github_clone` still
  return what they returned. Their error is git's stderr, as before.

### Backend: `GitRunner::run_with_progress` (`src-tauri/src/git/runner.rs`)
- Same spawn as `run` (same env, same `-c` flags). Stdout is drained
  while stderr is read, so neither pipe can block git.
- Stderr is split on `\r` and `\n` (git redraws its line with `\r`). Each
  segment goes through `parse_progress`; segments that are not progress
  are dropped.
- Returns stdout on success. On failure it returns the same
  `AppError::GitFailed` that `run` returns, with the full stderr.

### Parsing (`src-tauri/src/git/progress.rs`)
Accepted shapes, after an optional `remote: ` prefix:
- `<Phase>: <N>% (<done>/<total>)<anything>` (phase with percent and counts)
- `<Phase>: <N>%` (percent only)
- `<Phase>: <N>, done.` or `<Phase>: <N>` (a count with no total)

A phase is letters and spaces, at most 40 characters. Percent is 0–100.
Everything else is `None`: URLs (`To https://…`), `error:` and
`warning:` lines, `Total …` summaries, ref updates.

### Throttle
At most one event per op per `PROGRESS_MIN_GAP` (100 ms), so at most ten
progress events a second, plus the one `done` event. A line dropped by the
throttle is replaced by the next one; git redraws often enough that the
bar stays current. The clock is a parameter, so tests need no sleeps.

### Frontend store (`src/lib/stores/gitProgress.ts`)
- `startGitProgress()` subscribes once to `git-progress`. Outside Tauri it
  resolves to a no-op.
- The store keeps `{ op, phase, percent, done }` per repo path. A new
  progress event replaces the entry. A `done` event applies only if its
  op is the one shown, so an auto-fetch finishing during a push does not
  hide the push.
- A finished entry is removed 1.5 s after its `done` event, so the bar
  reaches its end and the outcome label is readable.
- The status bar shows the entry for the current repo, or a clone in
  progress for any repo (the clone target is not open yet).

## Invariants
- Progress never changes a command's result, return value or error.
- At most ten progress events per second per op; exactly one `done` per
  run.
- Parsing never panics on arbitrary stderr; anything unrecognised is
  ignored.
- The frontend never shows a pill for a finished op after 1.5 s.

## Out of scope
- **Cancel button.** Needs the child process handle kept in app state and
  a kill path that cleans up git's lock files. Future work; the current
  runner has no handle to kill.
- **SSH passphrase and credential prompts.** Git reads those from the
  terminal, which GitBee does not provide (`GIT_TERMINAL_PROMPT=0`). They
  fail as errors today; prompting in-app is a separate feature.
- **Progress for `branch_fast_forward` and other fetches.** Only the
  four ops above, the ones the user starts and waits on.
- **Byte rates and ETA.** Git prints a rate, but the status bar shows only
  phase and percent.

## Rejected alternatives
- **Polling a progress file.** Git does not write one. Creating a file for
  it would mean a temp path per op, cleanup on crash, and a poll loop
  for something git already streams.
- **Parsing stdout.** Git writes progress to stderr only, and only with
  `--progress` or on a terminal. stdout carries the result (for example
  the pull summary), which is parsed elsewhere; mixing the two would make
  progress depend on the output format.
- **Frontend-side throttle.** The backend would still send every line
  over IPC, and each op would need its own copy of the rule. The
  throttle lives where the lines are produced.
- **One event per op id instead of per repo.** The UI shows one progress
  pill per repo, and a repo runs one user-visible op at a time. An op id
  would need the frontend to track ids across the start and finish of
  each command, which the current command signatures do not carry.
