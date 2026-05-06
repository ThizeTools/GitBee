# Create repo on GitHub (2026-05)

Extend the New-tab **Create** action so a fresh repo can be born on
GitHub, not only on disk. Today `browseCreate` runs `git init` in a
chosen folder and stops there — the user then has to leave the app,
create the repo on github.com, copy the URL, run
`git remote add origin …`, and `git push -u`. This feature folds all
of that into one dialog.

Also covers the symmetric case the user hit in practice: an existing
local repo without an `origin`, where `push` fails with
`fatal: 'origin' does not appear to be a git repository`. Same dialog,
"Publish" entry point, same backend path after the remote exists.

## Purpose

One feature, two entry points, one shared backend:

1. **Create → "On GitHub"** in `NewTabPage.svelte`. Opens
   `CreateRepoModal.svelte` with a "Local only" tab (current behavior)
   and a "GitHub" tab. The GitHub tab takes name, optional description,
   visibility (private/public), owner (personal account or any org the
   user can create in), and destination folder. On submit:
   `POST /user/repos` (or `POST /orgs/{org}/repos`), `git init`, initial
   commit if folder empty, `git remote add origin`, `git push -u origin
   <default_branch>`.
2. **Repo toolbar → "Publish to GitHub"** when the open repo has no
   `origin` remote. Reuses the GitHub tab of the same modal, pre-fills
   `name` from the folder basename, skips the destination-folder field
   (the repo is already on disk), and only does the create + remote-add
   + push steps.

Both paths require the user be signed in via the existing GitHub auth
(spec: `github-integration.md`). Not signed in → modal shows the
`GitHubLoginPanel` first, switches to the form on success.

## Public contract

### Tauri commands (added in `src-tauri/src/commands/github.rs`)

```rust
github_list_create_owners() -> Result<Vec<GhOwner>, AppError>
github_create_repo(req: CreateRepoReq) -> Result<GhRepoCreated, AppError>
github_publish_local(repo_path: String, req: CreateRepoReq) -> Result<GhRepoCreated, AppError>
```

Types:

```rust
pub struct GhOwner {
    pub login: String,
    pub avatar_url: String,
    pub kind: OwnerKind, // User | Organization
}

pub struct CreateRepoReq {
    pub owner: String,            // login of user or org
    pub name: String,             // repo name, validated client + server
    pub description: Option<String>,
    pub private: bool,
    pub auto_init: bool,          // true only for "Create on GitHub" with empty dest folder
    pub default_branch: String,   // e.g. "main"; passed through to git init -b
    pub dest_folder: Option<String>, // absent for publish-existing
}

pub struct GhRepoCreated {
    pub clone_url: String,
    pub ssh_url: String,
    pub html_url: String,
    pub default_branch: String,
    pub local_path: String,       // final on-disk path after init/clone
}
```

### Errors

Reuses `AppError::GitHub(String)` with sentinel substrings the frontend
parses to render targeted messages (matching the existing pattern in
`api.rs`):

- `NAME_TAKEN`: `POST /user/repos` returned 422 with
  `"name already exists on this account"`.
- `NAME_INVALID`: 422 with `"name can only contain ASCII letters, …"`
  or our client-side regex check failed.
- `INSUFFICIENT_SCOPES`: token lacks `repo` scope (or `admin:org` for
  org create). Frontend prompts re-auth via the existing
  `GitHubLoginPanel`, which already requests `repo read:user read:org`.
- `REMOTE_EXISTS`: `git remote add origin` failed because `origin` is
  already configured. Used only in publish-existing path; the modal
  surfaces the existing URL and offers to overwrite via
  `git remote set-url`.
- `PUSH_REJECTED`: initial push failed because the remote already has
  commits (rare with `auto_init=false`, but possible if the user
  pre-created the GitHub repo). Modal offers `git pull --rebase`
  followed by retry.

Every variant carries the offending value in the message: repo name,
remote URL, owner login, etc. (matches the project rule "Exception
messages must include the offending value and expected shape".)

## Auth scopes

Existing OAuth flow already requests `repo read:user read:org`. `repo`
covers create on personal account; `admin:org` is **not** added —
GitHub's `POST /orgs/{org}/repos` only requires the user have repo-create
permission on that org, which the existing `repo` scope satisfies for
members. Owners list comes from
`GET /user/orgs` filtered by
`GET /orgs/{org}/memberships/{username}`.role = `admin` OR
`/orgs/{org}` `members_can_create_repositories=true`. Orgs the user
can't create in are filtered out before the dropdown renders, so the
user never sees a 403 from a successful-looking action.

PAT path: same scope check via `GET /user` and
`GET /orgs/{org}/memberships/{user}` at modal-open time. PAT lacking
`repo` → modal shows "your token is missing `repo` scope" with a link
to GitHub's token settings.

## Backend flow

`github_create_repo` (NewTab → "Create on GitHub"):

1. Validate `req.name` against
   `^[A-Za-z0-9._-]{1,100}$` and reject leading dot/dash. Return
   `NAME_INVALID` early.
2. Validate `req.dest_folder` exists (or create it).
3. POST to GitHub. Body:
   `{ name, description, private, auto_init, default_branch }`.
   Endpoint depends on owner kind (`/user/repos` vs `/orgs/{owner}/repos`).
4. On 201, parse response → `GhRepoCreated` (without `local_path` yet).
5. Local init/clone:
   - If `auto_init=true` (empty folder, README requested): clone the
     repo into `dest_folder/name` using `authed_clone_url`.
     Same token-stripping cleanup as `github_clone`.
   - Else: `git init -b {default_branch}` in `dest_folder/name`,
     `git remote add origin {clone_url}`, optional initial empty
     commit only if folder has files, push.
6. Push uses the same `-c credential.helper=` + token-in-URL trick,
   then rewrites the remote to the clean URL. Token never lands in
   `.git/config`.

`github_publish_local` (existing repo, no origin):

1. Verify `repo_path` is a git work tree.
2. Verify no `origin` remote exists. If one exists, return
   `REMOTE_EXISTS` with the current URL — frontend asks user to confirm
   overwrite.
3. POST to GitHub with `auto_init=false` (the repo already has
   content).
4. `git remote add origin {clone_url}` (or `set-url` if overwriting).
5. `git push -u origin {default_branch}`.
6. Same token-strip cleanup.

Both flows share a private helper `push_initial(repo_path, branch,
clone_url, token)` so the credential-handling logic exists in exactly
one place.

## Frontend

### `CreateRepoModal.svelte`

- Two top tabs: **Local only** (current `browseCreate` behavior moved
  here verbatim) and **GitHub**.
- GitHub tab fields:
  - Owner: dropdown showing avatar + login. Default = signed-in user.
    Populated from `github_list_create_owners`.
  - Name: text input, regex-validated on blur, debounced
    name-availability check via `GET /repos/{owner}/{name}` (404 = OK,
    200 = taken). Inline ✓ / ✗.
  - Description: optional, single-line.
  - Visibility: radio Private (default) / Public.
  - "Initialize with README": checkbox, only available when destination
    folder is empty. Toggling it sets `auto_init`.
  - Destination folder: same picker as the existing flow.
- Submit button shows progress: "Creating on GitHub…" → "Initializing
  local repo…" → "Pushing initial commit…". On success, modal closes
  and `openRepo(local_path)` is called, replacing the current behavior
  of opening a freshly-`git init`-ed folder.
- On error, the message renders as a banner inside the modal (does
  *not* close), with a "Copy details" button that copies the full
  `AppError` to clipboard. Network errors keep the form filled so the
  user can retry without re-typing.

### `NewTabPage.svelte` change

`Create` button switches from "open folder picker, init in place" to
"open `CreateRepoModal`". Local-only tab is the default so the
existing one-click muscle memory still works; only one extra click.

### Repo toolbar entry point

In `src/lib/components/RepoToolbar.svelte` (or wherever push lives),
when the current repo has no `origin`, the **Push** button is replaced
by a **Publish to GitHub** button that opens `CreateRepoModal` with
`mode="publish-existing"`. Avoids the cryptic
`fatal: 'origin' does not appear to be a git repository` the user
reported.

## Invariants

- The GitHub API call and the local git work happen sequentially. If
  the API call succeeds but the local push fails, the modal surfaces
  the GitHub URL and an error; the empty (or auto-init'd) repo on
  GitHub is left in place — no auto-deletion. Reasoning: deleting a
  repo on GitHub via API is a destructive action that needs a separate
  user confirmation, and the recoverable path is for the user to
  retry the local steps manually with the URL we show them.
- Token never lands on disk in `.git/config`. Same stripping pattern
  as `github_clone`: clone/push with token-in-URL, then
  `git remote set-url origin <clean>`.
- Owner dropdown is always pre-filtered to orgs the user can create
  in — the modal never lets the user submit a request that will 403.
- `github_publish_local` refuses to run if `origin` exists, unless the
  caller passes an explicit overwrite flag (added to `CreateRepoReq`
  only if needed in v2; v1 returns `REMOTE_EXISTS` and the frontend
  asks the user, then re-calls with the overwrite path — see Out of
  scope).
- The same `CLIENT_ID` (Ov23li9Byp22UMrMNVdb) covers this flow. No
  new GitHub identifier is added.

## Out of scope

- Repo *deletion* on GitHub. Even though we'd like to roll back a
  half-failed create, the destructive nature warrants its own UI flow
  with confirmation, not a silent backend rollback.
- License/.gitignore/template selection. GitHub's `POST /user/repos`
  supports `license_template`, `gitignore_template`, `is_template` —
  defer to v2. v1 covers the 95% case; users who want a license can
  add one in their first commit.
- `git push --force` for the `REMOTE_EXISTS` overwrite case. v1 only
  rewrites the remote URL; the user pushes themselves.
- Other providers (GitLab, Bitbucket, Gitea). The architecture leaves
  the door open (the `github` module is one of potentially many) but
  v1 is github.com only, mirroring the existing integration's scope.
- Transfer / rename existing GitHub repos.
- Branch protection rules, default branch beyond what the user types.

## Rejected alternatives

- **Use `gh` CLI under the hood.** `gh repo create` would be a
  one-liner. Rejected because (a) it adds a runtime dependency the
  user has to install separately, breaking the "double-click and go"
  install story, (b) it would duplicate auth — the user would have to
  `gh auth login` *and* sign in inside the app, and (c) we already
  have a working REST/GraphQL client and stored token, so the marginal
  cost of `POST /user/repos` is one function.
- **Always `auto_init=true` on the GitHub side, then clone locally.**
  Simpler (no `git init` + push dance), but breaks the symmetric
  "Publish existing repo with content" flow, and surprises users who
  picked an empty folder expecting an empty repo. Keeping both modes
  gives the right behavior in both cases.
- **Offer GitHub creation only at New-tab; let "no origin" repos fail
  with the raw git error.** Rejected — the user explicitly hit the
  raw error and asked for a fix. The publish-existing flow is the
  whole point.
- **Background-rollback the GitHub repo on local failure.** Tempting
  for cleanliness, but a destructive call without explicit user
  consent is a footgun, and the user might *want* the empty GitHub
  repo (e.g., to push from a different machine). Surface the URL and
  let the user decide.
- **Inline the create form on NewTabPage instead of a modal.** Same
  reason CloneModal exists (NewTabPage comment, line 9-11): inline
  forms distort the action grid. Modal keeps the page layout stable.

## Files added

```
src-tauri/src/github/create.rs        (POST /user/repos + /orgs/.../repos, push helper)
src/lib/components/CreateRepoModal.svelte
src/lib/components/PublishGitHubButton.svelte  (toolbar entry point)
```

Files modified:

- `src-tauri/src/commands/github.rs` (3 new commands)
- `src-tauri/src/github/mod.rs` (re-export `create`)
- `src-tauri/src/github/api.rs` (add `check_name_available`,
  `list_create_owners` helpers)
- `src-tauri/src/lib.rs` (register new commands)
- `src/lib/ipc/github.ts` (3 new wrappers)
- `src/lib/components/NewTabPage.svelte` (Create button → modal)
- `src/lib/components/RepoToolbar.svelte` (no-origin → Publish button)

## Tests

- `create.rs`: name regex matrix (valid, leading dot, leading dash,
  too long, unicode); 422 → `NAME_TAKEN`; 422 with different message
  → `NAME_INVALID`; 401 → `INSUFFICIENT_SCOPES`.
- `api.rs`: `list_create_owners` filters out orgs where the user is a
  non-admin member with `members_can_create_repositories=false`.
- Integration: a Svelte test for `CreateRepoModal` covering tab
  switch, name-availability debounce, error banner rendering on
  injected `NAME_TAKEN`.
- E2E (manual checklist in PR): empty folder + auto_init=true,
  empty folder + auto_init=false (generates initial empty commit?),
  folder with content + create-on-github, existing repo with no
  origin → publish.

## Phasing

One PR. The feature is small enough (one modal, three commands, one
helper module) that splitting it adds review overhead without
isolating risk. The auth core, repo picker, and avatars from
`github-integration.md` already shipped, so this rides on top of
proven plumbing.
