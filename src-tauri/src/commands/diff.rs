use crate::error::AppResult;
use crate::git::checked_ref;
use crate::git::diff::{parse_unified, FileDiff};
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

fn cwd(path: &str) -> PathBuf { PathBuf::from(path) }

/// With `file`, only that path is diffed: the center diff panel passes it,
/// the commit details panel does not. A renamed file then shows as added,
/// because rename detection only sees that path. Accepted, see
/// docs/specs/graph-loading.md.
#[tauri::command]
pub async fn diff_commit(
    path: String,
    sha: String,
    file: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<Vec<FileDiff>> {
    let mut args: Vec<String> = vec![
        "show".into(),
        "--format=".into(),
        "--no-color".into(),
        "-U3".into(),
        checked_ref(&sha)?.into(),
    ];
    if let Some(f) = file {
        args.push("--".into());
        args.push(f);
    }
    let text = state.git.run_text_lossy(&cwd(&path), args).await?;
    Ok(parse_unified(&text))
}

/// Stash entries are merge commits (HEAD + index + untracked) so `git
/// show` produces a combined diff that's almost always empty. The
/// correct command is `git stash show -p stash@{N}` which compares the
/// stash against its base. Returns the same shape as `diff_commit`.
#[tauri::command]
pub async fn diff_stash(
    path: String,
    index: u32,
    state: State<'_, AppState>,
) -> AppResult<Vec<FileDiff>> {
    let stash_ref = format!("stash@{{{index}}}");
    let text = state
        .git
        .run_text_lossy(
            &cwd(&path),
            ["stash", "show", "-p", "--no-color", "-U3", &stash_ref],
        )
        .await?;
    Ok(parse_unified(&text))
}

#[tauri::command]
pub async fn diff_workdir(
    path: String,
    file: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<Vec<FileDiff>> {
    let mut args: Vec<String> = vec!["diff".into(), "--no-color".into(), "-U3".into()];
    if let Some(f) = file {
        args.push("--".into());
        args.push(f);
    }
    let text = state.git.run_text(&cwd(&path), args).await?;
    Ok(parse_unified(&text))
}

#[tauri::command]
pub async fn diff_index(
    path: String,
    file: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<Vec<FileDiff>> {
    let mut args: Vec<String> = vec![
        "diff".into(),
        "--cached".into(),
        "--no-color".into(),
        "-U3".into(),
    ];
    if let Some(f) = file {
        args.push("--".into());
        args.push(f);
    }
    let text = state.git.run_text(&cwd(&path), args).await?;
    Ok(parse_unified(&text))
}
