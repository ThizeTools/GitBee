//! Tauri commands for the GitHub integration. Thin layer — all real
//! work lives in `crate::github::*`.

use crate::commands::git_progress::{run_reporting, GitOp};
use crate::error::{AppError, AppResult};
use crate::git::checked_ref;
use crate::github::api::TokenApi;
use crate::github::gists;
use crate::github::{api, avatars, create, oauth, storage, types::*};
use crate::state::AppState;
use parking_lot::Mutex;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};

/// The signed-in token. Errors when nothing is stored, so every GitHub
/// command fails with the same "not signed in" text.
pub fn require_token(state: &AppState) -> AppResult<String> {
    storage::load_token(&state.cache)?
        .ok_or_else(|| AppError::GitHub("not signed in".into()))
}

/// Runs one GitHub call with the signed-in token and applies `settle_scoped`
/// to its result. The pull-request commands are all this shape.
pub async fn with_api<T, Fut>(
    state: &AppState,
    call: impl FnOnce(TokenApi) -> Fut,
) -> AppResult<T>
where
    Fut: std::future::Future<Output = AppResult<T>>,
{
    let token = require_token(state)?;
    settle_scoped(state, call(TokenApi { token }).await)
}

/// Passes a GitHub call's result through. A token that lacks a scope is
/// cleared, as `github_list_repos` does, so the next screen is the sign-in
/// panel. The error text tells the user what to do.
pub fn settle_scoped<T>(state: &AppState, result: AppResult<T>) -> AppResult<T> {
    if let Err(e) = &result {
        let msg = e.to_string();
        if msg.contains("INSUFFICIENT_SCOPES") || msg.contains(gists::GIST_SCOPE_MISSING) {
            let _ = storage::clear_token(&state.cache);
        }
    }
    result
}

/// Refuses a clone URL that git would read as an option, such as
/// `--upload-pack=...`. Same rule as `remote_add`. Spec:
/// docs/specs/github-integration.md.
fn checked_clone_url(value: &str) -> AppResult<&str> {
    if value.starts_with('-') {
        return Err(AppError::Other(format!(
            "invalid clone URL {value:?}: must not start with '-'"
        )));
    }
    Ok(value)
}

#[derive(Default)]
pub struct OAuthRegistry {
    inner: Arc<Mutex<Option<oauth::StartedFlow>>>,
}

#[derive(Debug, Serialize)]
pub struct AuthStatus {
    pub authenticated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

#[tauri::command]
pub async fn github_status(
    state: State<'_, AppState>,
) -> AppResult<AuthStatus> {
    let Some(token) = storage::load_token(&state.cache)? else {
        return Ok(AuthStatus { authenticated: false, login: None, avatar_url: None });
    };
    match api::fetch_user(&token).await {
        Ok(u) => Ok(AuthStatus {
            authenticated: true,
            login: Some(u.login),
            avatar_url: Some(u.avatar_url),
        }),
        Err(_) => {
            // Stored token no longer valid — clear it so the UI shows the
            // login screen instead of pretending we're signed in.
            let _ = storage::clear_token(&state.cache);
            Ok(AuthStatus { authenticated: false, login: None, avatar_url: None })
        }
    }
}

#[tauri::command]
pub async fn github_save_pat(
    token: String,
    state: State<'_, AppState>,
) -> AppResult<UserInfo> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err(AppError::GitHub("empty token".into()));
    }
    let user = api::fetch_user(&token).await?;
    storage::save_token(&state.cache, &token)?;
    Ok(user)
}

#[derive(Debug, Serialize)]
pub struct OAuthStarted {
    pub user_code: String,
    pub verification_uri: String,
    pub interval: u64,
}

#[tauri::command]
pub async fn github_oauth_start(
    registry: State<'_, OAuthRegistry>,
) -> AppResult<OAuthStarted> {
    let flow = oauth::start_flow().await?;
    let response = OAuthStarted {
        user_code: flow.user_code.clone(),
        verification_uri: flow.verification_uri.clone(),
        interval: flow.interval,
    };
    *registry.inner.lock() = Some(flow);
    Ok(response)
}

#[tauri::command]
pub async fn github_oauth_await(
    registry: State<'_, OAuthRegistry>,
    state: State<'_, AppState>,
) -> AppResult<UserInfo> {
    let flow = registry.inner.lock().take()
        .ok_or_else(|| AppError::GitHub("no OAuth flow in progress".into()))?;
    let token = oauth::await_token(flow).await?;
    let user = api::fetch_user(&token).await?;
    storage::save_token(&state.cache, &token)?;
    Ok(user)
}

#[tauri::command]
pub async fn github_oauth_cancel(
    registry: State<'_, OAuthRegistry>,
) -> AppResult<()> {
    // Dropping the listener inside StartedFlow closes the socket, which
    // makes await_token fail with `accept failed` — that's acceptable.
    let _ = registry.inner.lock().take();
    Ok(())
}

#[tauri::command]
pub async fn github_logout(state: State<'_, AppState>) -> AppResult<()> {
    storage::clear_token(&state.cache)
}

#[tauri::command]
pub async fn github_list_repos(state: State<'_, AppState>) -> AppResult<Vec<GhRepo>> {
    let token = storage::load_token(&state.cache)?
        .ok_or_else(|| AppError::GitHub("not signed in".into()))?;
    match api::list_repos(&token).await {
        Ok(v) => Ok(v),
        Err(e) => {
            // Token granted with an outdated scope set (eg. before we
            // added `read:org`). Clear it so the next call falls into
            // the login flow with the current scopes.
            let msg = e.to_string();
            if msg.contains("INSUFFICIENT_SCOPES") {
                let _ = storage::clear_token(&state.cache);
            }
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn github_clone(
    url: String,
    dest: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<String> {
    checked_clone_url(&url)?;
    let token = storage::load_token(&state.cache)?;
    let dest_pb = PathBuf::from(&dest);
    if !dest_pb.exists() {
        tokio::fs::create_dir_all(&dest_pb).await?;
    }
    let name = url
        .rsplit(['/', ':'])
        .next()
        .unwrap_or("repo")
        .trim_end_matches(".git")
        .to_string();
    let target = dest_pb.join(&name);
    if target.exists() {
        return Err(AppError::Other(format!("target already exists: {}", target.display())));
    }
    let auth_url = match token {
        Some(t) if url.starts_with("https://") => api::authed_clone_url(&url, &t),
        _ => url.clone(),
    };
    // Disable the credential helper for the clone process so the OS
    // credential store (Windows Credential Manager / macOS Keychain)
    // doesn't persist the inline `x-access-token:<token>@…` we used.
    // Otherwise GCM later asks the user to pick between their normal
    // GitHub account and this leftover x-access-token entry.
    let target_str = target.to_string_lossy().into_owned();
    run_reporting(
        &app,
        &state.git,
        &dest_pb,
        &target_str,
        GitOp::Clone,
        [
            "-c", "credential.helper=",
            "-c", "credential.useHttpPath=true",
            "clone", "--progress", &auth_url, &target_str,
        ],
    ).await?;
    // Strip token from the saved remote URL — git stores whatever URL
    // we passed, including credentials, so rewrite to the clean form.
    // Without this, every subsequent push/pull would reuse the embedded
    // token, defeating the credential-helper-disabled clone above.
    let _ = state.git.run(&target, ["remote", "set-url", "origin", &url]).await;
    // Best-effort cleanup of any residual `x-access-token` entry the
    // credential helper might already hold from previous clones run
    // before this fix shipped. `git credential reject` is idempotent —
    // if there's no matching entry, it returns 0 silently.
    let reject_input = format!(
        "protocol=https\nhost=github.com\nusername=x-access-token\n\n",
    );
    let _ = state.git
        .run_with_stdin(&target, ["credential", "reject"], reject_input.as_bytes())
        .await;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64).unwrap_or(0);
    let _ = state.cache.upsert_repo(target.to_string_lossy().as_ref(), ts);
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn avatar_for_email(
    email: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let path = avatars::ensure_cached(&state.cache, &email).await?;
    Ok(path.to_string_lossy().into_owned())
}

/// Last-used clone destination folder. Persisted across launches so the
/// user doesn't pick the same folder every time. Empty string if never set.
#[tauri::command]
pub async fn clone_last_dest(state: State<'_, AppState>) -> AppResult<String> {
    Ok(state.cache.settings_get("clone.last_dest")?.unwrap_or_default())
}

#[tauri::command]
pub async fn clone_save_dest(path: String, state: State<'_, AppState>) -> AppResult<()> {
    state.cache.settings_set("clone.last_dest", &path)
}

#[tauri::command]
pub async fn github_list_create_owners(
    state: State<'_, AppState>,
) -> AppResult<Vec<GhOwner>> {
    let token = storage::load_token(&state.cache)?
        .ok_or_else(|| AppError::GitHub("not signed in".into()))?;
    create::list_create_owners(&token).await
}

#[tauri::command]
pub async fn github_check_repo_name(
    owner: String,
    name: String,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    let token = storage::load_token(&state.cache)?
        .ok_or_else(|| AppError::GitHub("not signed in".into()))?;
    create::check_name_available(&token, &owner, &name).await
}

#[tauri::command]
pub async fn github_create_repo(
    req: CreateRepoReq,
    state: State<'_, AppState>,
) -> AppResult<GhRepoCreated> {
    let token = storage::load_token(&state.cache)?
        .ok_or_else(|| AppError::GitHub("not signed in".into()))?;
    let result = create::create_on_github(&state.git, &token, req).await?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let _ = state.cache.upsert_repo(&result.local_path, ts);
    Ok(result)
}

#[tauri::command]
pub async fn github_publish_local(
    repo_path: String,
    req: CreateRepoReq,
    state: State<'_, AppState>,
) -> AppResult<GhRepoCreated> {
    let token = storage::load_token(&state.cache)?
        .ok_or_else(|| AppError::GitHub("not signed in".into()))?;
    create::publish_local(&state.git, &token, repo_path, req).await
}

/// Shares one commit as a gist. Builds the patch with `git format-patch`
/// (the same output as "Create patch"), posts it as one file, and returns the
/// gist URL. Spec: docs/specs/github-integration.md, "Gist sharing".
#[tauri::command]
pub async fn gist_create_patch(
    path: String,
    sha: String,
    public: bool,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let token = require_token(&state)?;
    let cwd = PathBuf::from(&path);
    let sha_ref = checked_ref(&sha)?;
    // The patch and subject come from git first, so a git failure never
    // reaches GitHub. Only then is the token used.
    let patch = state.git.run(&cwd, ["format-patch", "-1", "--stdout", sha_ref]).await?;
    let subject = state.git.run_text(&cwd, ["log", "-1", "--format=%s", sha_ref]).await?;
    let req = gists::patch_gist_request(sha_ref, &subject, public, &patch);
    let result = gists::create_gist(&TokenApi { token }, &req).await;
    settle_scoped(&state, result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checked_clone_url_rejects_a_leading_dash_and_names_the_value() {
        let err = checked_clone_url("--upload-pack=evil").unwrap_err();
        assert!(err.to_string().contains("--upload-pack=evil"));
    }

    #[test]
    fn checked_clone_url_accepts_https_and_scp_style_urls() {
        assert!(checked_clone_url("https://github.com/o/r.git").is_ok());
        assert!(checked_clone_url("git@github.com:o/r.git").is_ok());
    }
}
