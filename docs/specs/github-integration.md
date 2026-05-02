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

Use the `keyring` crate (Windows Credential Manager / macOS Keychain /
libsecret). Service name `gitbee`, account name `github-token`. If the
keyring is unavailable (rare on Linux without secret service), fall back
to an obfuscated row in the existing SQLite cache database with a clear
log warning. Never plaintext.

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
- Creating repos, forking, issues, PRs, gists.
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
src-tauri/Cargo.toml                  (+reqwest, keyring, sha1, sha2, base64, urlencoding, tiny_http)
src-tauri/src/github/mod.rs
src-tauri/src/github/oauth.rs         (loopback flow + PKCE)
src-tauri/src/github/api.rs           (GraphQL + REST helpers)
src-tauri/src/github/avatars.rs       (email→URL + disk cache)
src-tauri/src/github/types.rs
src-tauri/src/github/storage.rs       (keyring + sqlite fallback)
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
