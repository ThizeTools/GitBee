use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

fn cwd(path: &str) -> PathBuf { PathBuf::from(path) }

#[derive(Debug, Serialize)]
pub struct OperationState {
    pub merging: bool,
    pub rebasing: bool,
    pub cherry_picking: bool,
    pub reverting: bool,
}

#[tauri::command]
pub async fn op_state(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<OperationState> {
    let cwd_buf = cwd(&path);
    let git_dir_text = state
        .git
        .run_text(&cwd_buf, ["rev-parse", "--git-dir"])
        .await?;
    let git_dir = cwd_buf.join(git_dir_text.trim());
    Ok(OperationState {
        merging: git_dir.join("MERGE_HEAD").exists(),
        rebasing: git_dir.join("rebase-apply").exists() || git_dir.join("rebase-merge").exists(),
        cherry_picking: git_dir.join("CHERRY_PICK_HEAD").exists(),
        reverting: git_dir.join("REVERT_HEAD").exists(),
    })
}

#[tauri::command]
pub async fn op_abort(
    path: String,
    kind: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let sub = match kind.as_str() {
        "merge" => "merge",
        "rebase" => "rebase",
        "cherry-pick" => "cherry-pick",
        "revert" => "revert",
        _ => return Err(crate::error::AppError::Other(format!("unknown op {kind}"))),
    };
    state.git.run(&cwd(&path), [sub, "--abort"]).await?;
    Ok(())
}

#[tauri::command]
pub async fn op_continue(
    path: String,
    kind: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let sub = match kind.as_str() {
        "merge" => "merge",
        "rebase" => "rebase",
        "cherry-pick" => "cherry-pick",
        "revert" => "revert",
        _ => return Err(crate::error::AppError::Other(format!("unknown op {kind}"))),
    };
    state.git.run(&cwd(&path), [sub, "--continue"]).await?;
    Ok(())
}

#[tauri::command]
pub async fn mark_resolved(
    path: String,
    file: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["add", "--", &file]).await?;
    Ok(())
}
