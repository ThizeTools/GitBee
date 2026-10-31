# GitHub pull requests (2026-10)

Neighbors: [github-integration.md](github-integration.md) (auth, the token store,
the REST and GraphQL helpers this feature reuses, and the gist share that sits
beside it), [graph-loading.md](graph-loading.md) (the graph that "Show in graph"
scrolls), [app-dialogs.md](app-dialogs.md) (every confirm and choice here uses
those dialogs).

## Purpose

Review and merge a PR without leaving GitBee for the common path: see what is
open, read it, check its checks and reviews, check out its branch, approve or
merge it, and open a new PR from the branch you are on.

The compare-URL menu items ("Start a pull request") stay. They open GitHub in a
browser and cover what this view does not (diffs, inline comments).

## Public contract

### Tauri commands

Defined in `src-tauri/src/commands/github_pulls.rs`. All GitHub calls use the
signed-in token and go through `github::pulls` (HTTP behind `api::GithubApi`).

| Command | Arguments | Returns | GitHub call |
|---|---|---|---|
| `github_list_pulls` | `owner, repo, pr_state: "open" \| "closed"` | `PullRow[]` | `GET /repos/{o}/{r}/pulls?state=…&sort=updated&direction=desc&per_page=50` |
| `github_pull_detail` | `owner, repo, number` | `PullDetail` | `GET …/pulls/{n}`, GraphQL `pullRequest` (reviews), `GET …/commits/{sha}/check-runs?per_page=100` |
| `github_merge_pull` | `owner, repo, number, method: merge \| squash \| rebase` | `sha: string` | `PUT …/pulls/{n}/merge` |
| `github_review_pull` | `owner, repo, number, event: approve \| request_changes \| comment, body` | `()` | `POST …/pulls/{n}/reviews` |
| `github_create_pull` | `owner, repo, req: NewPull` | `PullRow` | `POST …/pulls` |
| `github_branch_on_remote` | `owner, repo, branch` | `bool` | `GET …/branches/{b}` (404 means false) |
| `pr_checkout` | `path, number, head_ref, same_repo` | `()` | git only |

`PullRow`: `number, title, state, merged, draft, author, author_avatar,
head_ref, head_sha, base_ref, same_repo, updated_at (unix s), html_url`.

`PullDetail` is `PullRow` plus `body, labels[{name,color}], additions, deletions,
changed_files, mergeable, mergeable_state, review{decision, reviewers[{login,
state}], requested[]}, checks{passed, failed, pending, skipped, runs[{name,
status, conclusion, html_url}]}`. The Rust struct flattens the row fields.

`NewPull`: `title, head, base, body (optional), draft (optional)`.

Shapes live in `src-tauri/src/github/pull_types.rs`; the TS mirror is
`src/lib/github/pullTypes.ts`.

### Errors

Every failure is `AppError::GitHub` with the call, the status and GitHub's own
`message`, for example `PUT /repos/o/r/pulls/3/merge returned 405: Pull Request
is not mergeable`. A 401 is "token unauthorized (401)". A token without a scope
gives `INSUFFICIENT_SCOPES` (GraphQL) or `GIST_SCOPE_MISSING` (gists); the
command layer clears the stored token on those (`settle_scoped`), and the UI
drops to the sign-in state with "Sign in again…".

### Validation before any network call

- `owner` and `repo` may only contain letters, digits, `-`, `_`, `.`, and may
  not be `.` or `..`. They go into URL paths.
- A commit sha is 4 to 40 hex digits.
- A branch name follows git's ref rules for what matters here: no leading `-`
  (option injection), no `:` (refspec separator), no `..`, `@{`, whitespace,
  control characters, or `~^?*[\`.
- A `COMMENT` or `REQUEST_CHANGES` review needs non-blank text. `APPROVE` may
  be bare.
- A new PR needs a non-blank title and two different branches.

The same rules are repeated in the UI (`src/lib/github/pulls.ts`) so the user
sees the reason before pressing a button. The backend does not rely on the UI.

## Where it lives in the UI

- **Entry point.** A "PRs" button in the top bar, shown when the user is signed
  in and `origin` is a github.com remote (`originGitHubRepo` in
  `src/lib/github/url.ts`). It sets the center mode `{ kind: "pulls" }` through
  `showPullRequests()`.
- **Layout.** `components/pr/PullRequestsView.svelte` is the center pane. Left:
  the list (`PullRequestList.svelte`). Right: the detail (`PullRequestDetail.svelte`,
  with `PullChecks.svelte`). Header: Open / Closed tabs, Refresh, New pull request.
- **List.** One row per PR: `#number`, title, a status word (Draft, Open,
  Merged, Closed), author avatar and login, `head → base`, a "fork" tag for
  cross-repo PRs, and the relative update time. Review and checks are not in
  the row.
- **Detail.** Loaded when a row is selected. Shows the head and base, the
  review decision, reviewers and pending requests, the mergeability, changed
  files with additions and deletions, labels, checks (counts plus each run,
  linked), and the body.
- **Dialogs.** `ReviewDialog.svelte` (text box, Comment / Request changes /
  Approve). `NewPullRequestDialog.svelte` (see below).

### List behavior

- Tabs: **Open** (state=open) and **Closed** (state=closed). Each shows the 50
  most recently updated PRs. Closed PRs are not paged.
- Loads when the view opens, when the tab changes, when the repo's origin
  changes, and on Refresh. There is no background polling.
- Switching repo or tab clears the selection. A reply for an older request is
  dropped, so the list always matches the current tab.

### Detail behavior

- The body is shown as plain text with line breaks (`white-space: pre-wrap`),
  never as HTML.
- Label colours pass through `labelCssColor`, which accepts six hex digits and
  falls back to the muted foreground for anything else.

## Actions

| Action | Enabled when | Confirms | Effect |
|---|---|---|---|
| Checkout | always | no | Same-repo PR: fetch `origin/<head>`, check out the local branch (create tracking when missing, else fast-forward it). Fork PR: fetch `refs/pull/<n>/head` into local `pr/<n>` and check it out. Working tree is not stashed; git's own refusal reaches the toast. |
| Show in graph | head commit is in the loaded history | no | Opens the graph and scrolls to the head sha. Otherwise an info toast. |
| Open on GitHub | always | no | Opens `html_url` in the browser. |
| Copy link | always | no | Copies `html_url`. |
| Review… | PR is open | the dialog itself | Comment, Request changes or Approve. Refreshes the detail on success. |
| Merge… | PR is open | yes, twice | First a choice of merge commit, squash or rebase, then a confirm (red). The API merges on GitHub; local branches are not touched. Refreshes on success. |

**Merge always confirms.** The merge writes to the base branch on GitHub, so a
second step is required even after the strategy is picked. GitHub's refusal
(conflicts, required checks, branch protection) is shown with its own message.

## New pull request

Opened by "New pull request…" (disabled without an origin or sign-in).

- **Head** defaults to the checked-out branch. Options are local branches.
- **Base** defaults to the repo's default branch (from the loaded repo list;
  `main` when the list is not loaded). Options are remote branches.
- **Title** defaults to the subject of the head commit. **Description** is plain
  text. **Create as draft** is unchecked by default.
- The head is checked on GitHub (`github_branch_on_remote`). If it is not there,
  the dialog says so and offers **Push first** (`remote_push origin <head>`).
  Create stays disabled until the head exists on origin.
- On success the new PR opens in the detail pane and the list reloads.

The "Start a pull request" compare-URL items in the ref menus are unchanged.

## Invariants

- **PR bodies and comments are never rendered as HTML.** They go through text
  nodes and `white-space: pre-wrap`. Label colours are validated as hex first.
- **Merge always confirms**, and it is the only action here that changes a
  remote branch on GitHub. A review is a comment on GitHub, not a state change
  to a branch: Approve is one click and needs no text, and the two verdicts
  that need text refuse an empty box before any request is sent. GitBee does
  not offer to dismiss or edit a review.
- **Checkout never moves an existing local branch backwards or past local
  commits.** A same-repo checkout fast-forwards only (`merge --ff-only`); a
  diverged branch fails with git's message.
- **No token in logs.** Requests are logged by the action label (for example
  "List open pull requests"), never by URL with credentials.
- **Owner, repo, sha and branch are validated before they reach a URL or a git
  argument.** See "Validation before any network call".
- **No polling.** GitHub's rate limit is shared with the rest of the app; the
  list refreshes on view open, tab change, and Refresh.
- **The PRs button and the view depend on the origin remote only.** A repo
  whose origin is GitLab, Bitbucket or a self-hosted server never shows the
  feature.

## Out of scope

- Inline line comments, review threads, and reply or resolve on threads.
- A PR diff view inside GitBee. "Open on GitHub" covers it.
- GitHub Enterprise and other hosts. Only github.com origins are recognized.
- Paging beyond 50 PRs per tab, and search or filters on the list.
- Editing a PR's title, body, labels, reviewers or assignees.
- Closing a PR without merging.
- Pull requests in other remotes (upstream, fork-of-fork).

## Rejected alternatives

- **Embed github.com in a webview.** Needs its own sign-in, a CSP exception
  (the app sets none today), and gives no integration with the graph or the
  checkout. The browser button already covers the rest.
- **Poll PRs in the background.** Burns rate limit on repos nobody is watching
  and changes the list under the user's cursor. Refresh on open and on demand
  is enough for a review loop.
- **Render the PR body as Markdown.** Requires a sanitizer on every body and
  still lets images and links load. Plain text with line breaks is safe and
  readable for review; the browser button shows the rendered version.
- **Fetch review and checks for every row.** One request per row multiplied by
  50 rows, on every refresh. The detail pane loads them for the selected PR
  only.
- **Use the GitHub CLI (`gh pr`).** It would be a second auth source and a new
  external dependency. The token GitBee already holds is enough.

## Tests

- `src-tauri/src/github/pull_parse.rs`: JSON parsing (list row, fork and
  deleted-fork detection, review states per reviewer, check-run buckets and
  counts), validators (repo names, sha, branch names, pull state, review body
  rule, new-PR rules), and the shape errors.
- `src-tauri/src/github/pulls.rs`: each call against `FakeGithubApi`, a named
  replay double in `github/fake_api.rs`. Covers the list query string, detail
  joining three calls, merge method in the body, GitHub's refusal message, the
  review event, create, and the branch 404.
- `src-tauri/src/commands/github_pulls.rs`: checkout argument builders, and
  three git tests against a bare origin in the temp directory (same-repo create,
  same-repo reuse, fork fetch into `pr/<n>`).
- `src/lib/github/pulls.test.ts`: labels, tones, the row model with a pinned
  clock, review and new-PR validation, merge choices, scope-error wording, label
  colours. `src/lib/github/url.test.ts`: origin resolution.

## Files

```
src-tauri/src/github/pulls.rs          (calls)
src-tauri/src/github/pull_parse.rs     (pure parsing and validation)
src-tauri/src/github/pull_types.rs     (shapes)
src-tauri/src/github/fake_api.rs       (test double, cfg(test))
src-tauri/src/commands/github_pulls.rs (commands and checkout)
src/lib/github/pullTypes.ts
src/lib/github/pulls.ts                (pure formatting and validation)
src/lib/github/githubErrors.ts
src/lib/components/pr/PullRequestsView.svelte
src/lib/components/pr/PullRequestList.svelte
src/lib/components/pr/PullRequestDetail.svelte
src/lib/components/pr/PullChecks.svelte
src/lib/components/pr/ReviewDialog.svelte
src/lib/components/pr/NewPullRequestDialog.svelte
src/lib/components/pr/pullActions.ts
```

Files modified: `src/lib/components/TopBar.svelte` (PRs button),
`src/lib/components/CenterPanel.svelte`, `src/lib/stores/center.ts`
(`pulls` mode), `src/lib/ipc/index.ts`, `src-tauri/src/lib.rs`,
`src-tauri/src/commands/mod.rs`, `src-tauri/src/github/mod.rs`.
