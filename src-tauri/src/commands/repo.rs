use crate::cache::store::RecentRepo;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenedRepo {
    pub id: i64,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecentRepoDto {
    pub id: i64,
    pub path: String,
    pub last_opened: i64,
}

impl From<RecentRepo> for RecentRepoDto {
    fn from(r: RecentRepo) -> Self {
        Self { id: r.id, path: r.path, last_opened: r.last_opened }
    }
}

#[tauri::command]
pub async fn repo_open(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<OpenedRepo> {
    let pb = PathBuf::from(&path);
    if !pb.is_dir() {
        return Err(AppError::InvalidRepoPath(path));
    }
    if !state.git.is_repository(&pb).await {
        return Err(AppError::InvalidRepoPath(format!("{path} is not a git repository")));
    }
    let ts = now_secs();
    let id = state.cache.upsert_repo(&path, ts)?;
    Ok(OpenedRepo { id, path })
}

/// Remove a repo from the recents list. The on-disk repo isn't touched —
/// only the entry in our local cache.
#[tauri::command]
pub async fn repo_forget(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.cache.forget_repo(&path)
}

#[tauri::command]
pub async fn repo_recent(
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Vec<RecentRepoDto>> {
    let rows = state.cache.list_recent(limit.unwrap_or(20))?;
    Ok(rows.into_iter().map(Into::into).collect())
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
