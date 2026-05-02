use crate::error::AppResult;
use crate::git::status::{parse_status_v2, StatusEntry};
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

fn cwd(path: &str) -> PathBuf { PathBuf::from(path) }

#[tauri::command]
pub async fn status_load(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<StatusEntry>> {
    let bytes = state
        .git
        .run(&cwd(&path), ["status", "--porcelain=v2", "-z", "--untracked-files=all"])
        .await?;
    parse_status_v2(&bytes)
}

#[tauri::command]
pub async fn stage_file(
    path: String,
    file: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["add", "--", &file]).await?;
    Ok(())
}

#[tauri::command]
pub async fn unstage_file(
    path: String,
    file: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["reset", "HEAD", "--", &file]).await?;
    Ok(())
}

#[tauri::command]
pub async fn stage_all(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["add", "-A"]).await?;
    Ok(())
}

#[tauri::command]
pub async fn unstage_all(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["reset", "HEAD"]).await?;
    Ok(())
}

#[tauri::command]
pub async fn discard_file(
    path: String,
    file: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["checkout", "--", &file]).await?;
    Ok(())
}

/// Reset everything in the working tree to HEAD: revert tracked file edits
/// (staged or not) and remove untracked files / directories. Equivalent to
/// `git reset --hard HEAD` followed by `git clean -fd`. Caller is expected
/// to have already confirmed with the user — this is destructive.
#[tauri::command]
pub async fn discard_all_changes(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["reset", "--hard", "HEAD"]).await?;
    state.git.run(&cwd(&path), ["clean", "-fd"]).await?;
    Ok(())
}
