//! Tauri commands for the GitHub integration. Thin layer — all real
//! work lives in `crate::github::*`.

use crate::error::{AppError, AppResult};
use crate::github::{api, avatars, oauth, storage, types::*};
use crate::state::AppState;
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

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
    state: State<'_, AppState>,
) -> AppResult<String> {
    use std::path::PathBuf;
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
    state.git.run(
        &dest_pb,
        [
            "-c", "credential.helper=",
            "-c", "credential.useHttpPath=true",
            "clone", &auth_url, target.to_string_lossy().as_ref(),
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
