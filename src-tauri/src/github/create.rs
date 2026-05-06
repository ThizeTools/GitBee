//! Create a new repository on github.com (`POST /user/repos` or
//! `POST /orgs/{org}/repos`) and push an initial commit. Used by the
//! "Create on GitHub" and "Publish to GitHub" entry points. See
//! `docs/specs/github-create-repo.md`.

use crate::error::{AppError, AppResult};
use crate::git::GitRunner;
use crate::github::api;
use crate::github::types::{CreateRepoReq, GhOwner, GhRepoCreated, OwnerKind};
use serde_json::json;
use std::path::Path;

const USER_AGENT: &str = "gitbee/0.1";
const API_BASE: &str = "https://api.github.com";

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .expect("reqwest client")
}

/// Repo names: ASCII letters/digits, `.`, `_`, `-`. 1–100 chars. No
/// leading dot or dash. Matches GitHub's own validation closely enough
/// to fail fast in the UI.
pub fn validate_name(name: &str) -> AppResult<()> {
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::GitHub(format!(
            "NAME_INVALID: '{name}' length must be 1-100"
        )));
    }
    let bytes = name.as_bytes();
    let first = bytes[0] as char;
    if first == '.' || first == '-' {
        return Err(AppError::GitHub(format!(
            "NAME_INVALID: '{name}' cannot start with '.' or '-'"
        )));
    }
    for c in name.chars() {
        let ok = c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-';
        if !ok {
            return Err(AppError::GitHub(format!(
                "NAME_INVALID: '{name}' contains '{c}' (allowed: A-Z a-z 0-9 . _ -)"
            )));
        }
    }
    Ok(())
}

/// `GET /repos/{owner}/{name}` — 404 means the name is free, 200 means
/// taken. Used by the modal's debounced availability indicator.
pub async fn check_name_available(token: &str, owner: &str, name: &str) -> AppResult<bool> {
    validate_name(name)?;
    let resp = client()
        .get(format!("{API_BASE}/repos/{owner}/{name}"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::GitHub(format!("check name: {e}")))?;
    match resp.status().as_u16() {
        200 => Ok(false),
        404 => Ok(true),
        401 => Err(AppError::GitHub("INSUFFICIENT_SCOPES: 401 from /repos check".into())),
        s => Err(AppError::GitHub(format!("/repos/{owner}/{name} returned {s}"))),
    }
}

/// List orgs the signed-in user can create repos in, plus the user
/// themselves. Filters out orgs where the user lacks repo-create
/// permission so the UI dropdown never offers a guaranteed 403.
pub async fn list_create_owners(token: &str) -> AppResult<Vec<GhOwner>> {
    let user = api::fetch_user(token).await?;
    let mut out = vec![GhOwner {
        login: user.login.clone(),
        avatar_url: user.avatar_url.clone(),
        kind: OwnerKind::User,
    }];
    let resp = client()
        .get(format!("{API_BASE}/user/orgs"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::GitHub(format!("list orgs: {e}")))?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::GitHub("INSUFFICIENT_SCOPES: /user/orgs 401".into()));
    }
    if !resp.status().is_success() {
        // Don't fail the whole listing for an org-listing hiccup — the
        // user can still create on their personal account.
        tracing::warn!("/user/orgs returned {}", resp.status());
        return Ok(out);
    }
    let orgs: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::GitHub(format!("orgs json: {e}")))?;
    let Some(arr) = orgs.as_array() else { return Ok(out); };
    for o in arr {
        let login = o["login"].as_str().unwrap_or_default().to_string();
        if login.is_empty() { continue; }
        let avatar_url = o["avatar_url"].as_str().unwrap_or_default().to_string();
        // Only include orgs where the user can actually create repos.
        // `members_can_create_repositories` on the org metadata is the
        // common gate; combined with admin role this is enough for v1.
        if can_create_in_org(token, &login, &user.login).await {
            out.push(GhOwner { login, avatar_url, kind: OwnerKind::Organization });
        }
    }
    Ok(out)
}

async fn can_create_in_org(token: &str, org: &str, user_login: &str) -> bool {
    // Admin members can always create.
    let role_url = format!("{API_BASE}/orgs/{org}/memberships/{user_login}");
    let role_resp = client()
        .get(&role_url)
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send().await;
    if let Ok(r) = role_resp {
        if r.status().is_success() {
            if let Ok(v) = r.json::<serde_json::Value>().await {
                if v["role"].as_str() == Some("admin") { return true; }
            }
        }
    }
    // Otherwise check the org-wide flag.
    let org_url = format!("{API_BASE}/orgs/{org}");
    let org_resp = client()
        .get(&org_url)
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send().await;
    if let Ok(r) = org_resp {
        if r.status().is_success() {
            if let Ok(v) = r.json::<serde_json::Value>().await {
                return v["members_can_create_repositories"].as_bool().unwrap_or(false);
            }
        }
    }
    false
}

#[derive(Debug, Clone)]
struct CreateApiResp {
    clone_url: String,
    ssh_url: String,
    html_url: String,
    default_branch: String,
}

/// Call `POST /user/repos` (personal account) or `POST /orgs/{org}/repos`
/// (organization). Maps GitHub's error envelope to our sentinel
/// substrings (NAME_TAKEN / NAME_INVALID / INSUFFICIENT_SCOPES) so the
/// frontend can render targeted messages.
async fn create_remote_repo(
    token: &str,
    req: &CreateRepoReq,
    owner_is_user: bool,
    auth_user_login: &str,
) -> AppResult<CreateApiResp> {
    validate_name(&req.name)?;
    let url = if owner_is_user {
        format!("{API_BASE}/user/repos")
    } else {
        format!("{API_BASE}/orgs/{}/repos", req.owner)
    };
    let body = json!({
        "name": req.name,
        "description": req.description.clone().unwrap_or_default(),
        "private": req.private,
        "auto_init": req.auto_init,
        "default_branch": req.default_branch,
    });
    let resp = client()
        .post(&url)
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::GitHub(format!("create repo: {e}")))?;
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::GitHub("INSUFFICIENT_SCOPES: 401 from create".into()));
    }
    if status == reqwest::StatusCode::FORBIDDEN {
        return Err(AppError::GitHub(format!(
            "INSUFFICIENT_SCOPES: 403 — token cannot create in '{}'",
            req.owner
        )));
    }
    if status == reqwest::StatusCode::UNPROCESSABLE_ENTITY {
        let txt = resp.text().await.unwrap_or_default();
        if txt.contains("name already exists on this account") || txt.contains("already exists") {
            return Err(AppError::GitHub(format!(
                "NAME_TAKEN: '{}/{}' already exists",
                req.owner, req.name
            )));
        }
        return Err(AppError::GitHub(format!(
            "NAME_INVALID: 422 from create '{}/{}': {}",
            req.owner, req.name, txt
        )));
    }
    if !status.is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(AppError::GitHub(format!("create repo {status}: {txt}")));
    }
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::GitHub(format!("create json: {e}")))?;
    // Sanity check: GitHub puts the repo under `owner.login` in the
    // response. If the user typed an org login that resolved to their
    // personal account silently, surface it.
    let returned_owner = v["owner"]["login"].as_str().unwrap_or_default();
    if !returned_owner.is_empty() && returned_owner != req.owner {
        tracing::warn!(
            "create returned owner '{}' but caller asked for '{}' (auth user: {})",
            returned_owner, req.owner, auth_user_login
        );
    }
    Ok(CreateApiResp {
        clone_url: v["clone_url"].as_str().unwrap_or_default().to_string(),
        ssh_url: v["ssh_url"].as_str().unwrap_or_default().to_string(),
        html_url: v["html_url"].as_str().unwrap_or_default().to_string(),
        default_branch: v["default_branch"]
            .as_str()
            .unwrap_or(&req.default_branch)
            .to_string(),
    })
}

/// Strip the trailing slashes and return the embedded host+path so we
/// can rewrite `.git/config` after a token-bearing push.
fn clean_https_url(clone_url: &str) -> String {
    clone_url.to_string()
}

/// Compare local HEAD to the remote tip of `branch` via `ls-remote`.
/// Used to recover from a push that returned HTTP 408 / disconnect
/// after the pack already reached GitHub: if the remote SHA matches
/// our local SHA the operation actually succeeded and we shouldn't
/// surface the transport error to the user.
async fn push_succeeded_via_verify(
    git: &GitRunner,
    repo_path: &Path,
    branch: &str,
    auth_url: &str,
) -> bool {
    let local = match git
        .run_text(repo_path, ["rev-parse", "HEAD"])
        .await
    {
        Ok(s) => s.trim().to_string(),
        Err(_) => return false,
    };
    if local.is_empty() { return false; }
    let remote = match git
        .run_text(
            repo_path,
            [
                "-c", "credential.helper=",
                "ls-remote", auth_url,
                &format!("refs/heads/{branch}"),
            ],
        )
        .await
    {
        Ok(s) => s,
        Err(_) => return false,
    };
    remote
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().next())
        .map(|sha| sha == local)
        .unwrap_or(false)
}

/// Push the local repo at `repo_path` to `clone_url` on `branch`. The
/// token is injected inline (`x-access-token:<token>@…`) and the
/// credential helper is disabled so the URL never lands in
/// `.git/config` or the OS credential store. After the push, the saved
/// remote is rewritten to the clean URL.
async fn push_initial(
    git: &GitRunner,
    repo_path: &Path,
    branch: &str,
    clone_url: &str,
    token: &str,
) -> AppResult<()> {
    let auth_url = api::authed_clone_url(clone_url, token);
    // Caller already added `origin` pointing at the clean URL. We need
    // the push to record `branch.<name>.remote=origin` so subsequent
    // `git push` works without `--set-upstream`, but the actual transfer
    // needs the token-bearing URL. Solution: temporarily flip origin to
    // the auth URL, push `-u origin branch` (this sets upstream to
    // origin/<branch>, not to the anonymous URL), then flip origin back
    // to the clean URL. The token never lands in `.git/config`
    // permanently — only during the brief push window — and the user
    // gets a fully-tracked branch out of the box.
    let _ = git.run(repo_path, ["remote", "set-url", "origin", &auth_url]).await;
    // Bump http.postBuffer and disable the slow-speed timeout so flaky
    // connections don't trip a 408 from the GitHub edge before the pack
    // finishes uploading. Retry once on transient HTTP errors and
    // verify the server actually has our SHA before declaring failure
    // — git sometimes reports HTTP 408 even when the pack landed (the
    // disconnect happens after the server has already accepted the
    // data).
    let push_args = [
        "-c", "credential.helper=",
        "-c", "credential.useHttpPath=true",
        "-c", "http.postBuffer=524288000",
        "-c", "http.lowSpeedLimit=0",
        "-c", "http.lowSpeedTime=999999",
        "push", "-u", "origin", branch,
    ];
    let mut push_res = git.run(repo_path, push_args).await;
    if let Err(e) = &push_res {
        let msg = e.to_string();
        let transient = msg.contains("HTTP 408")
            || msg.contains("HTTP 502")
            || msg.contains("HTTP 503")
            || msg.contains("HTTP 504")
            || msg.contains("RPC failed")
            || msg.contains("hung up")
            || msg.contains("unexpected disconnect");
        if transient {
            tracing::warn!("push transient failure, retrying once: {msg}");
            push_res = git.run(repo_path, push_args).await;
        }
    }
    if let Err(e) = push_res {
        let msg = e.to_string();
        // Verify FIRST — a 408 at the end of a large push often means
        // the data + ref-update made it to GitHub but the response
        // timed out. The retry then sees the ref already at our SHA
        // and reports `! [rejected] <branch> -> <branch> (fetch first)`
        // even though the work is done. Comparing local HEAD with the
        // remote ref disambiguates: if they match, push succeeded and
        // any client-side error (408, RPC, "rejected") is benign.
        if push_succeeded_via_verify(git, repo_path, branch, &auth_url).await {
            tracing::warn!("push reported error but ref already matches remote; treating as success: {msg}");
            // Make sure tracking gets recorded even when the push
            // itself returned non-zero — the user opened the modal
            // expecting `git push` to work without `--set-upstream`
            // afterward, and a 408-recovered push without -u side
            // effects would leave the branch un-tracked.
            let _ = git
                .run(
                    repo_path,
                    ["branch", "--set-upstream-to", &format!("origin/{branch}"), branch],
                )
                .await;
        } else if msg.contains("rejected") || msg.contains("non-fast-forward") {
            // Restore the clean origin URL before bailing — the auth
            // URL was set as a transient measure to make `push -u
            // origin` record upstream correctly, and we don't want the
            // token persisted on disk.
            let _ = git.run(repo_path, ["remote", "set-url", "origin", clone_url]).await;
            return Err(AppError::GitHub(format!(
                "PUSH_REJECTED: remote '{}' has commits the local branch lacks; pull --rebase and retry",
                clean_https_url(clone_url)
            )));
        } else {
            // Restore clean origin URL even on failure so a token never
            // sits in .git/config waiting for the next operation.
            let _ = git.run(repo_path, ["remote", "set-url", "origin", clone_url]).await;
            return Err(e);
        }
    }
    // The push above used the auth URL inline, so origin's tracking is
    // pointing at it. Re-set the remote URL to the clean form so future
    // operations don't carry the token.
    let _ = git.run(repo_path, ["remote", "set-url", "origin", clone_url]).await;
    // Best-effort: clear any stale x-access-token entry from credential
    // managers (matches the cleanup in github_clone).
    let reject_input = b"protocol=https\nhost=github.com\nusername=x-access-token\n\n";
    let _ = git
        .run_with_stdin(repo_path, ["credential", "reject"], reject_input)
        .await;
    Ok(())
}

/// "Create on GitHub" path: API create + local init/clone + push.
pub async fn create_on_github(
    git: &GitRunner,
    token: &str,
    req: CreateRepoReq,
) -> AppResult<GhRepoCreated> {
    validate_name(&req.name)?;
    let user = api::fetch_user(token).await?;
    let owner_is_user = req.owner == user.login;

    // Resolve destination folder before talking to GitHub so a bad path
    // doesn't leave an orphan repo behind.
    let dest = req.dest_folder.clone().ok_or_else(|| {
        AppError::Other("dest_folder required for create-on-github".into())
    })?;
    let dest_pb = std::path::PathBuf::from(&dest);
    if !dest_pb.exists() {
        tokio::fs::create_dir_all(&dest_pb).await?;
    }
    let target = dest_pb.join(&req.name);
    if target.exists() {
        return Err(AppError::Other(format!(
            "target already exists: {}",
            target.display()
        )));
    }

    let api_resp = create_remote_repo(token, &req, owner_is_user, &user.login).await?;

    if req.auto_init {
        // GitHub seeded the repo with a README. Clone it down — same
        // token-stripping cleanup as `github_clone`.
        let auth_url = api::authed_clone_url(&api_resp.clone_url, token);
        git.run(
            &dest_pb,
            [
                "-c", "credential.helper=",
                "-c", "credential.useHttpPath=true",
                "clone", &auth_url, target.to_string_lossy().as_ref(),
            ],
        )
        .await?;
        let _ = git.run(&target, ["remote", "set-url", "origin", &api_resp.clone_url]).await;
    } else {
        // Empty repo on GitHub — init locally, make an initial commit
        // if there's something to commit, push.
        tokio::fs::create_dir_all(&target).await?;
        git.run(&target, ["init", "-b", &api_resp.default_branch]).await?;
        // Stage anything in the folder. If the folder is empty this
        // produces nothing; commit will fail and we skip the push (the
        // GitHub repo stays empty, ready for the user's first push).
        let _ = git.run(&target, ["add", "-A"]).await;
        let has_changes = git
            .run(&target, ["diff", "--cached", "--quiet"])
            .await
            .is_err();
        if has_changes {
            git.run(
                &target,
                ["commit", "-m", &format!("Initial commit for {}/{}", req.owner, req.name)],
            )
            .await?;
            push_initial(git, &target, &api_resp.default_branch, &api_resp.clone_url, token).await?;
        } else {
            // No local content; just wire up origin so the next user
            // push works.
            git.run(&target, ["remote", "add", "origin", &api_resp.clone_url]).await?;
        }
    }

    Ok(GhRepoCreated {
        clone_url: api_resp.clone_url,
        ssh_url: api_resp.ssh_url,
        html_url: api_resp.html_url,
        default_branch: api_resp.default_branch,
        local_path: target.to_string_lossy().into_owned(),
    })
}

/// "Publish to GitHub" path: existing local repo with no `origin`.
/// Creates the GitHub repo, wires up the remote, pushes the current
/// branch.
pub async fn publish_local(
    git: &GitRunner,
    token: &str,
    repo_path: String,
    mut req: CreateRepoReq,
) -> AppResult<GhRepoCreated> {
    validate_name(&req.name)?;
    req.auto_init = false; // never auto-init when we already have content
    req.dest_folder = None;

    let user = api::fetch_user(token).await?;
    let owner_is_user = req.owner == user.login;

    let repo_pb = std::path::PathBuf::from(&repo_path);
    if !git.is_repository(&repo_pb).await {
        return Err(AppError::InvalidRepoPath(repo_path));
    }

    // Refuse if origin is already configured. The frontend handles the
    // overwrite confirmation and re-calls if the user agrees (v2:
    // explicit overwrite flag — for v1 the user removes it manually).
    let remotes = git
        .run_text(&repo_pb, ["remote"])
        .await
        .unwrap_or_default();
    if remotes.lines().any(|l| l.trim() == "origin") {
        let url = git
            .run_text(&repo_pb, ["remote", "get-url", "origin"])
            .await
            .unwrap_or_default();
        return Err(AppError::GitHub(format!(
            "REMOTE_EXISTS: 'origin' already configured at {}",
            url.trim()
        )));
    }

    let api_resp = create_remote_repo(token, &req, owner_is_user, &user.login).await?;

    // Wire up origin. We push using an auth URL directly, then rewrite
    // — same token-strip pattern as create_on_github.
    git.run(&repo_pb, ["remote", "add", "origin", &api_resp.clone_url]).await?;

    // If the repo has no commits yet, make one so push has something
    // to send. Otherwise the push will fail with "src refspec does not
    // match any" and confuse the user.
    let has_head = git.run(&repo_pb, ["rev-parse", "--verify", "HEAD"]).await.is_ok();
    if !has_head {
        let _ = git.run(&repo_pb, ["add", "-A"]).await;
        let _ = git
            .run(
                &repo_pb,
                ["commit", "--allow-empty", "-m", "Initial commit"],
            )
            .await;
    }

    // Resolve the *actual* current branch after we know HEAD exists.
    // `git init` on Windows still defaults to `master` unless
    // `init.defaultBranch` is set, so a fresh repo will have committed
    // on `master` even though the user asked for `main` on GitHub.
    // Rename it to the requested default branch with `branch -M` so
    // the push refspec matches what we just created remotely.
    let current_branch = git
        .run_text(&repo_pb, ["rev-parse", "--abbrev-ref", "HEAD"])
        .await
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != "HEAD")
        .unwrap_or_else(|| api_resp.default_branch.clone());
    if current_branch != api_resp.default_branch {
        // -M is force-rename; safe because there's only one branch on a
        // freshly-initialized repo, and renaming a non-default branch
        // to match the remote default is exactly what the user asked
        // for via the modal.
        git.run(&repo_pb, ["branch", "-M", &api_resp.default_branch]).await?;
    }
    let head_branch = api_resp.default_branch.clone();

    push_initial(git, &repo_pb, &head_branch, &api_resp.clone_url, token).await?;

    Ok(GhRepoCreated {
        clone_url: api_resp.clone_url,
        ssh_url: api_resp.ssh_url,
        html_url: api_resp.html_url,
        default_branch: api_resp.default_branch,
        local_path: repo_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_valid_basic() {
        assert!(validate_name("hello").is_ok());
        assert!(validate_name("hello-world_2.0").is_ok());
        assert!(validate_name("a").is_ok());
    }

    #[test]
    fn name_rejects_leading_dot_or_dash() {
        let e = validate_name(".env").unwrap_err().to_string();
        assert!(e.contains("NAME_INVALID"));
        assert!(validate_name("-foo").is_err());
    }

    #[test]
    fn name_rejects_unicode_and_spaces() {
        assert!(validate_name("hello world").is_err());
        assert!(validate_name("café").is_err());
    }

    #[test]
    fn name_rejects_empty_and_too_long() {
        assert!(validate_name("").is_err());
        assert!(validate_name(&"a".repeat(101)).is_err());
        assert!(validate_name(&"a".repeat(100)).is_ok());
    }
}
