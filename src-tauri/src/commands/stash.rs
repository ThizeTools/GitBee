use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

fn cwd(path: &str) -> PathBuf { PathBuf::from(path) }

#[derive(Debug, Serialize)]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
    pub sha: String,
}

#[tauri::command]
pub async fn stash_list(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<StashEntry>> {
    let text = state
        .git
        .run_text(&cwd(&path), ["stash", "list", "--format=%H%x09%gd%x09%gs"])
        .await?;
    let mut out = Vec::new();
    for (idx, line) in text.lines().enumerate() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() < 3 { continue; }
        out.push(StashEntry {
            index: idx,
            message: parts[2].to_string(),
            sha: parts[0].to_string(),
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn stash_create(
    path: String,
    message: Option<String>,
    include_untracked: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut args: Vec<String> = vec!["stash".into(), "push".into()];
    if include_untracked.unwrap_or(false) { args.push("-u".into()); }
    if let Some(m) = message { args.push("-m".into()); args.push(m); }
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

#[tauri::command]
pub async fn stash_apply(
    path: String,
    index: usize,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let r = format!("stash@{{{index}}}");
    state.git.run(&cwd(&path), ["stash", "apply", &r]).await?;
    Ok(())
}

#[tauri::command]
pub async fn stash_pop(
    path: String,
    index: usize,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let r = format!("stash@{{{index}}}");
    state.git.run(&cwd(&path), ["stash", "pop", &r]).await?;
    Ok(())
}

#[tauri::command]
pub async fn stash_drop(
    path: String,
    index: usize,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let r = format!("stash@{{{index}}}");
    state.git.run(&cwd(&path), ["stash", "drop", &r]).await?;
    Ok(())
}
