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
pub async fn stage_files(
    path: String,
    files: Vec<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if files.is_empty() { return Ok(()); }
    let mut args: Vec<&str> = vec!["add", "--"];
    for f in &files { args.push(f.as_str()); }
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

#[tauri::command]
pub async fn unstage_files(
    path: String,
    files: Vec<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if files.is_empty() { return Ok(()); }
    let mut args: Vec<&str> = vec!["reset", "HEAD", "--"];
    for f in &files { args.push(f.as_str()); }
    state.git.run(&cwd(&path), args).await?;
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
