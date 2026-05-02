use crate::error::AppResult;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

fn cwd(path: &str) -> PathBuf { PathBuf::from(path) }

#[tauri::command]
pub async fn tag_create(
    path: String,
    name: String,
    sha: Option<String>,
    message: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut args: Vec<String> = vec!["tag".into()];
    if let Some(m) = message { args.push("-a".into()); args.push("-m".into()); args.push(m); }
    args.push(name);
    if let Some(s) = sha { args.push(s); }
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

#[tauri::command]
pub async fn tag_delete(
    path: String,
    name: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["tag", "-d", &name]).await?;
    Ok(())
}

#[tauri::command]
pub async fn tag_push(
    path: String,
    remote: String,
    name: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["push", &remote, &name]).await?;
    Ok(())
}
