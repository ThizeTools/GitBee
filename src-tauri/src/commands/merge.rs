use crate::error::{AppError, AppResult};
use crate::git::GitRunner;
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
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
    stage_path(&state.git, &cwd(&path), &file).await
}

/// Maps the UI side name to git's flag. `ours`/`theirs` are git's own words and
/// do NOT mean "my commit" during a rebase: there "ours" is the branch the
/// rebase replays onto. The UI labels follow the op (src/lib/conflict/labels.ts).
fn side_flag(side: &str) -> AppResult<&'static str> {
    match side {
        "ours" => Ok("--ours"),
        "theirs" => Ok("--theirs"),
        _ => Err(AppError::Other(format!(
            "unknown conflict side {side:?}, expected \"ours\" or \"theirs\""
        ))),
    }
}

/// `--` ends option parsing so a file whose name starts with `-` is never
/// read as a flag.
fn take_side_args<'a>(flag: &'a str, file: &'a str) -> [&'a str; 4] {
    ["checkout", flag, "--", file]
}

fn stage_args(file: &str) -> [&str; 3] {
    ["add", "--", file]
}

async fn stage_path(git: &GitRunner, repo: &Path, file: &str) -> AppResult<()> {
    git.run(repo, stage_args(file)).await?;
    Ok(())
}

/// Rewrites a conflicted file from one side (`checkout --ours|--theirs`), then
/// stages it. This is the whole-file choice; the per-block editor saves through
/// file_write and then mark_resolved.
#[tauri::command]
pub async fn conflict_take_side(
    path: String,
    file: String,
    side: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let flag = side_flag(&side)?;
    let repo = cwd(&path);
    state.git.run(&repo, take_side_args(flag, &file)).await?;
    stage_path(&state.git, &repo, &file).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn side_flag_maps_ours_and_theirs_to_git_flags() {
        assert_eq!(side_flag("ours").unwrap(), "--ours");
        assert_eq!(side_flag("theirs").unwrap(), "--theirs");
    }

    #[test]
    fn side_flag_rejects_other_names_and_echoes_the_value() {
        let err = side_flag("both").unwrap_err().to_string();
        assert!(err.contains("\"both\""), "unexpected message: {err}");
    }

    #[test]
    fn take_side_args_pass_the_file_after_double_dash() {
        assert_eq!(take_side_args("--ours", "-odd.txt"), ["checkout", "--ours", "--", "-odd.txt"]);
    }

    #[test]
    fn stage_args_pass_the_file_after_double_dash() {
        assert_eq!(stage_args("src/a.rs"), ["add", "--", "src/a.rs"]);
    }
}
