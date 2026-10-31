# GitHub integration (2026-05)

Bring GitBee to feature parity with GitKraken on the two GitHub touchpoints
that show up daily: cloning a repo from your GitHub account and seeing the
real face of whoever wrote each commit.

## Purpose

Two user-visible features, sharing one piece of plumbing (an authenticated
GitHub HTTP client + on-disk cache).

1. **Clone from GitHub.** In the New-tab clone action, alongside the URL
   input, a "GitHub" tab lists every repo the signed-in user has access
   to, grouped by owner/organization, with a search filter. Selecting one
   and a destination folder runs a token-authenticated clone.
2. **Real avatars on every commit.** The graph row, the commit details
   panel, and any place that currently shows initials inside a colored
   circle resolve `author_email` to a profile photo (GitHub when possible,
   Gravatar otherwise) and render the actual image. Initials remain only
   as a load/error fallback.

## Public contract

### Tauri commands (added in `src-tauri/src/commands/github.rs`)

```rust
github_status() -> Option<{ login: String, avatar_url: String }>
github_save_pat(token: String) -> Result<UserInfo, GhError>
github_oauth_start() -> Result<{ port: u16, state: String }, GhError>
github_oauth_await(state: String) -> Result<UserInfo, GhError>
github_logout() -> ()
github_list_repos() -> Result<Vec<GhRepo>, GhError>
avatar_for_email(email: String) -> Result<String, AvatarError>  // local file path
```

`GhRepo`:
```rust
{
  owner: String, owner_avatar: String, name: String,
  clone_url: String, ssh_url: String, private: bool,
  description: Option<String>, default_branch: String,
  pushed_at: i64,
}
```

`UserInfo`: `{ login, name, email, avatar_url }`.

### Errors

`GhError` variants: `Unauthorized`, `RateLimited { retry_after }`,
`Network(String)`, `BadResponse(String)`, `PortInUse(u16)`,
`OAuthCancelled`, `OAuthTimeout`. Every error message includes the
offending value (URL, port, status code).

## Authentication

Both flows live behind one screen, `GitHubLoginPanel.svelte`, with two
tabs: **Sign in with GitHub** (default) and **Personal Access Token**.

### Loopback OAuth (default)

Mirrors GitHub Desktop and GitKraken. Client ID is hard-coded in
`src-tauri/src/github/oauth.rs`:

```rust
pub const CLIENT_ID: &str = "Ov23li9Byp22UMrMNVdb";
```

It is public; no client secret is used (PKCE replaces it).

Flow:
1. Frontend calls `github_oauth_start`.
2. Backend binds `127.0.0.1:54321` (TCP). If busy, tries 54322, 54323,
   54324 in order. If all four busy → `PortInUse`. The exact same set of
   ports must be registered as callback URLs on the OAuth app.
3. Backend generates a random `state` (32 bytes) and a PKCE
   `code_verifier` + S256 `code_challenge`. Stores both in memory keyed
   by state.
4. Backend opens default browser to
   `https://github.com/login/oauth/authorize?client_id=...&redirect_uri=http://127.0.0.1:<port>/callback&state=<state>&code_challenge=<challenge>&code_challenge_method=S256&scope=repo%20read:user`.
5. Frontend immediately calls `github_oauth_await(state)` (long poll).
6. Browser hits `/callback?code=<code>&state=<state>`. Backend's tiny HTTP
   server verifies `state`, exchanges `code` + `code_verifier` at
   `POST /login/oauth/access_token`, gets the user token, fetches `/user`,
   stores token, returns `UserInfo` to the awaiting caller, and sends a
   minimal "You can close this tab" HTML page back to the browser.

Hard timeout: 5 minutes after `oauth_start`. After that the listener
shuts down and `oauth_await` returns `OAuthTimeout`.

### Personal Access Token (alternative)

`github_save_pat(token)` calls `GET /user` with the token to validate.
On 200, persists the token. On 401, returns `Unauthorized`.

### Token storage

The token lives in the OS credential store, through the `keyring` crate
(Windows Credential Manager / macOS Keychain / libsecret). Service
`GitBee`, account `github-token`. The keyring call sits behind the
project trait `SecretStore` (`src-tauri/src/github/secret_store.rs`); the
rules below live in `src-tauri/src/github/storage.rs`. The service name
was `gitbee` in an earlier draft; nothing was ever stored under either
name, because the keyring was not wired up before this change.

Why: the previous storage was XOR with a fixed key compiled into the
binary, then base64, in the SQLite `settings` table. That stops a casual
look at `cache.db` and nothing more. Anyone with the app can recover the
key and therefore the token. XOR is obfuscation, not protection. The OS
store is encrypted per user and unlocks with the user's login session.

Rules:
- **Read.** The OS store first. If it holds nothing and the legacy SQLite
  row exists, the row is decoded, written to the OS store, and the row is
  deleted. A failed OS write keeps the row, so the next read retries.
- **Unavailable store** (read, write or delete error, such as no Secret
  Service on Linux). Reads use the SQLite row so login keeps working, and
  every failure is logged as a structured warning (`store="os-keyring"`).
  This fallback is weaker than the OS store. The warning is the only
  signal that it is in use.
- **Write.** The OS store is written and the SQLite row is deleted. If the
  OS write fails, any older copy in the OS store is removed, so it cannot
  win over the new value, and the token goes to the SQLite row.
- **Logout.** The SQLite row is deleted and its error is returned. The OS
  store entry is deleted and an error there is logged, not returned. When
  the store is unavailable, the SQLite row is the only copy, so logout
  must still succeed.
- Never plaintext.

Rejected alternatives:
- **Keep XOR and document it.** The key ships in the binary, so the
  token is recoverable by anyone who has the app.
- **Encrypt the SQLite blob with a key stored beside it** (in the same
  database or in an app-data file). Same problem: the key sits next to
  the ciphertext, so anyone who can read the app's files can decrypt it.
- **Derive the key from machine or user identifiers.** Those are readable
  by the same user, so the key is not a secret.

## Repo picker (clone tab)

`GitHubRepoPicker.svelte` renders the result of `github_list_repos`:

- Grouped by `owner` (login of org or user). User's own repos first,
  then orgs alphabetically.
- Each group is collapsible. Group header shows owner avatar + name +
  count.
- Each row: owner avatar (small), repo name, lock icon if private,
  description truncated to one line, "updated <relative>" right-aligned.
- Sticky search box at top filters across all groups by repo name
  (case-insensitive substring) — matching groups stay expanded, others
  collapse automatically while filter is non-empty.
- Selecting a row stores the chosen repo; the existing destination
  folder picker stays where it is. Clone button runs
  `repoClone(clone_url, dest)` — token is injected by the backend on
  the fly via `https://x-access-token:<token>@github.com/owner/name.git`,
  so no token leaks into git config or shell history.

API call uses GraphQL for one round-trip:
```graphql
viewer {
  login
  avatarUrl
  repositories(first: 100, affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], orderBy: {field: PUSHED_AT, direction: DESC}) {
    nodes { nameWithOwner name owner { login avatarUrl } isPrivate description sshUrl url defaultBranchRef { name } pushedAt }
    pageInfo { hasNextPage endCursor }
  }
}
```

Paginates until `hasNextPage` is false. Hard cap 1000 repos to avoid
runaway accounts.

Result is cached in the Svelte store for the session; refresh button
on the picker forces re-fetch.

## Avatars

### Resolution (in `src-tauri/src/github/avatars.rs`)

Given an email, pick a URL in this priority:

1. `(\d+)\+([\w-]+)@users\.noreply\.github\.com` →
   `https://avatars.githubusercontent.com/u/${id}?s=64`
2. `([\w-]+)@users\.noreply\.github\.com` (legacy form) →
   `https://github.com/${username}.png?size=64`
3. Otherwise:
   `https://www.gravatar.com/avatar/${sha256(email_lowercased_trimmed)}?s=64&d=identicon`

The choice happens once per email, result memoized in process.

### Caching

Disk cache at `<app_data>/gitbee/avatars/<sha1(email)>.png`.

- `avatar_for_email(email)` returns the local path if cached, otherwise
  spawns a background fetch, returns the path it *will be at*, and emits
  a `avatar:resolved` Tauri event when the file lands.
- Frontend `<Avatar>` component shows initials fallback while the file
  doesn't exist, swaps in `<img src=convertFileSrc(path)>` on resolve.
- 304/ETag respected on refresh; manual "Clear avatar cache" lives in
  Settings (out of scope for v1, just leave the dir layout open to it).
- TTL: infinite. Avatars almost never change; user can nuke the dir.

### Where avatars appear

- `GraphCanvas.svelte`: 16×16 circular `<Avatar>` to the left of the
  commit subject in the message column. Padding adjusted; subject
  ellipsis math accounts for it.
- `CommitDetailsPanel.svelte`: replaces the existing colored-initials
  circle. Same size as today (32px). Initials remain visible until
  image loads.
- File blame, stash list, branch list: out of scope, hooks left for v2.

## Gist sharing

Commit context menu: **Share as Gist…** (replaces the "Share commit as Cloud
Patch" stub, which never shipped). Code: `src/lib/github/gistShare.ts`
(flow), `src-tauri/src/github/gists.rs` (payload and errors),
`commands::github::gist_create_patch` (git side).

Flow:
1. Not signed in: info toast "Sign in to GitHub first". Stop.
2. Choice dialog. **Secret gist** is the first and default choice; **Public
   gist** is the second. Secret gists are listed nowhere, but anyone with the
   link can open them.
3. `gist_create_patch(path, sha, public)`:
   - `git format-patch -1 --stdout <sha>` gives the patch text. The same output
     as "Create patch from commit".
   - `git log -1 --format=%s <sha>` gives the subject, which becomes the gist
     description.
   - The file name is `<sha7>-<slug>.patch`. The slug is the subject in
     lower-case ASCII words joined by `-`, cut at 50 characters, and `commit`
     when nothing is left.
   - `POST /gists` with one file. The reply's `html_url` is returned.
4. The URL is copied to the clipboard and a success toast shows it. Toasts take
   no actions, so there is no "Open" button; the user pastes the link.

Scope: the device flow requests `gist` (`SCOPES` in `github/oauth.rs`). A token
issued before that lacks the scope. The POST then returns 401, 403 or 404,
which becomes `GIST_SCOPE_MISSING: sign in again to grant gist access (GitHub
answered <status>: <message>)`. The command layer clears the stored token (as
it does for `INSUFFICIENT_SCOPES`), and the toast says "Sign in again to grant
gist access". GitHub's message stays in the error, so a rate limit is not
mistaken for a scope problem.

Invariants:
- Git runs first. The token is used only after the patch and subject exist, so
  a git failure never reaches GitHub.
- The SHA is checked with `checked_ref` (no leading `-`).
- Only one file per gist. The description is the commit subject, which the
  user chose to share.

Rejected alternatives:
- **Keep the Cloud Patch name.** "Cloud Patch" is not a GitHub feature. The
  name describes what the user gets: a gist.
- **Store the patch in a repo or as a PR comment.** Needs write access to a
  repo and leaves a trace in its history. A gist needs only the `gist` scope.
- **Upload with `gh gist create`.** Second auth source and an external binary.
  The token GitBee already holds is enough.

Tests: `gists.rs` covers the slug rules, the file name, the payload (one file,
visibility flag), and the three error paths (404 scope, 403 rate limit kept
visible, a reply without `html_url`). `commands/github.rs` covers the clone URL
rule.

## Clone URLs

`github_clone` refuses a URL that starts with `-` before git runs
(`checked_clone_url`, same rule as `remote_add`). git would read such a value as
an option, for example `--upload-pack=...`.

## Invariants

- `CLIENT_ID` is the only build-time GitHub identifier. Removing the
  Cargo dep on `keyring` must not break the app — falls back to SQLite
  with a warning, never crashes.
- The OAuth listener never accepts requests after returning the token
  or after the 5-minute timeout. It binds to `127.0.0.1` only, never
  `0.0.0.0`.
- A token is never logged. `GhError::Network` strips query params before
  reporting URLs.
- Avatar fetch failure is silent — the UI keeps the initials fallback,
  never throws to the user.
- Clone via GitHub picker must work identically to clone via URL once
  the repo+dest are chosen — same `repoClone` command, same status
  handling, same logs.

## Out of scope

- Push/pull authentication using the saved token (next iteration; today
  git falls back to the OS credential helper, which works for users who
  already configured one).
- Two-factor / SSO enforcement edge cases: rely on GitHub's normal OAuth
  flow which already prompts.
- Forking and issues. Pull requests: see [github-pull-requests.md](github-pull-requests.md).
  Gists: see "Gist sharing" below.
- GitHub Enterprise / self-hosted GitLab / Bitbucket. The architecture
  leaves room for additional providers (the `github` module is one of
  potentially many) but only `github.com` ships.
- Avatar in file blame / stash list / branch list.
- Refresh token rotation (GitHub Apps issue 8h tokens with refresh; v2
  will add silent refresh — for v1, expired token shows a re-auth
  toast).

## Rejected alternatives

- **Device Flow only.** Simpler to implement, but UX is "type this code
  in your browser." GitKraken doesn't do that and the user explicitly
  asked for the GitKraken experience.
- **No embedded Client ID, user registers their own.** Considered
  earlier in brainstorming. Cratered as soon as we agreed to mirror
  GitKraken — every desktop client embeds its own.
- **Plaintext token in SQLite.** Rejected: keyring is one crate and a
  single API call away, and `--no-verify`-style "I'll deal with it
  later" tradeoffs in security age badly.
- **GitHub avatar via per-commit API call.** Listing 200 commits would
  cost 200 requests. Email-based heuristic + Gravatar covers ~95% of
  real-world commits with zero auth needed.
- **Inline avatar drawn on the canvas.** Considered for graph rows.
  Rejected: rasterizing remote images into the canvas means manual cache
  management, no `loading=lazy`, no native scaling. HTML `<img>` in the
  DOM row alongside the canvas is simpler and faster.

## Files added

```
src-tauri/Cargo.toml                  (+reqwest, keyring, sha1, base64, tiny_http)
src-tauri/src/github/mod.rs
src-tauri/src/github/oauth.rs         (loopback flow + PKCE)
src-tauri/src/github/api.rs           (GraphQL + REST helpers)
src-tauri/src/github/avatars.rs       (email→URL + disk cache)
src-tauri/src/github/types.rs
src-tauri/src/github/storage.rs       (token policy: migration, fallback)
src-tauri/src/github/secret_store.rs  (SecretStore trait + keyring backend)
src-tauri/src/commands/github.rs
src/lib/ipc/github.ts
src/lib/stores/github.ts              (auth state + repo cache)
src/lib/components/Avatar.svelte
src/lib/components/GitHubLoginPanel.svelte
src/lib/components/GitHubRepoPicker.svelte
```

Files modified:
- `src/lib/components/NewTabPage.svelte` (URL/GitHub tab inside Clone)
- `src/lib/components/GraphCanvas.svelte` (avatar in cell-msg)
- `src/lib/components/CommitDetailsPanel.svelte` (real avatar)
- `src-tauri/src/lib.rs` (register new commands)

## Tests

- `oauth.rs`: PKCE challenge generation matches RFC 7636 example vectors;
  state mismatch is rejected; timeout cancels the listener.
- `avatars.rs`: regex matrix for the three email forms; Gravatar URL
  matches the well-known SHA-256 of `cboustead@gmail.com` from
  Gravatar's own examples.
- `api.rs`: GraphQL pagination loop terminates on `hasNextPage=false`;
  `Unauthorized` maps from HTTP 401.
- Integration: a Svelte component test for `Avatar` showing initials,
  then swapping to `<img>` after the resolve event.

## Phasing

Implementation lands in three reviewable PRs:

1. **Auth core.** Cargo deps, `github/{oauth,storage,api}.rs`,
   `github_status` / `github_save_pat` / OAuth commands,
   `GitHubLoginPanel`. End state: user can sign in but nothing visible
   changes elsewhere.
2. **Repo picker.** `github_list_repos`, `GitHubRepoPicker`, NewTabPage
   wiring. End state: clone from GitHub works.
3. **Avatars.** `avatars.rs`, `avatar_for_email`, `Avatar.svelte`,
   GraphCanvas + CommitDetailsPanel integration. End state: real photos
   in the graph.
