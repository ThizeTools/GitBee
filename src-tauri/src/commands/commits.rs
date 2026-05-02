use crate::error::AppResult;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

fn cwd(path: &str) -> PathBuf { PathBuf::from(path) }

#[tauri::command]
pub async fn commit_create(
    path: String,
    message: String,
    amend: Option<bool>,
    sign: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut args: Vec<String> = vec!["commit".into(), "-m".into(), message];
    if amend.unwrap_or(false) { args.push("--amend".into()); }
    if sign.unwrap_or(false) { args.push("-S".into()); }
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

#[tauri::command]
pub async fn commit_show(
    path: String,
    sha: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    state
        .git
        .run_text(
            &cwd(&path),
            ["show", "--no-color", "--format=fuller", &sha],
        )
        .await
}

#[tauri::command]
pub async fn commit_cherry_pick(
    path: String,
    sha: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["cherry-pick", &sha]).await?;
    Ok(())
}

#[tauri::command]
pub async fn commit_revert(
    path: String,
    sha: String,
    no_edit: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut args: Vec<String> = vec!["revert".into()];
    if no_edit.unwrap_or(true) { args.push("--no-edit".into()); }
    args.push(sha);
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

#[tauri::command]
pub async fn commit_reset(
    path: String,
    sha: String,
    mode: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let flag = match mode.as_str() {
        "soft" => "--soft",
        "hard" => "--hard",
        _ => "--mixed",
    };
    state.git.run(&cwd(&path), ["reset", flag, &sha]).await?;
    Ok(())
}
