use crate::error::AppResult;
use crate::git::checked_ref;
use crate::git::diff::{parse_unified, FileDiff};
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

fn cwd(path: &str) -> PathBuf { PathBuf::from(path) }

/// `-w` (ignore all whitespace) only when the caller asks for it. The flag
/// changes which hunks git emits, not just how they render, so hunk staging
/// must keep requesting the exact diff (see docs/specs/diff-viewer.md).
fn push_ignore_ws(args: &mut Vec<String>, ignore_ws: Option<bool>) {
    if ignore_ws == Some(true) {
        args.push("-w".into());
    }
}

/// Appends `-- <file>` when a single path is requested. Without it git diffs
/// the whole tree; the center panel always passes a file.
fn push_file_path(args: &mut Vec<String>, file: Option<String>) {
    if let Some(f) = file {
        args.push("--".into());
        args.push(f);
    }
}

/// With `file`, only that path is diffed. The center diff panel and the
/// commit details panel (one expanded file at a time) both pass it. A renamed
/// file then shows as added, because rename detection only sees that path.
/// Accepted, see docs/specs/graph-loading.md.
#[tauri::command]
pub async fn diff_commit(
    path: String,
    sha: String,
    file: Option<String>,
    ignore_ws: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<Vec<FileDiff>> {
    let args = commit_diff_args(&sha, file, ignore_ws)?;
    let text = state.git.run_text_lossy(&cwd(&path), args).await?;
    Ok(parse_unified(&text))
}

/// `git show` args for a commit or one file of it. `--diff-merges=first-parent`
/// diffs a merge against its first parent, the same base `commit_files` lists
/// against. Without it `git show` prints the combined diff, which is usually
/// empty for a merge, so an expanded file would read "No changes".
fn commit_diff_args(sha: &str, file: Option<String>, ignore_ws: Option<bool>) -> AppResult<Vec<String>> {
    let mut args: Vec<String> = vec![
        "show".into(),
        "--format=".into(),
        "--no-color".into(),
        "-U3".into(),
        "--diff-merges=first-parent".into(),
    ];
    push_ignore_ws(&mut args, ignore_ws);
    args.push(checked_ref(sha)?.into());
    push_file_path(&mut args, file);
    Ok(args)
}

/// Stash entries are merge commits (HEAD + index + untracked) so `git
/// show` produces a combined diff that's almost always empty. The
/// correct command is `git stash show -p stash@{N}` which compares the
/// stash against its base. Returns the same shape as `diff_commit`.
#[tauri::command]
pub async fn diff_stash(
    path: String,
    index: u32,
    ignore_ws: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<Vec<FileDiff>> {
    let stash_ref = format!("stash@{{{index}}}");
    let mut args: Vec<String> = vec![
        "stash".into(),
        "show".into(),
        "-p".into(),
        "--no-color".into(),
        "-U3".into(),
    ];
    push_ignore_ws(&mut args, ignore_ws);
    args.push(stash_ref);
    let text = state.git.run_text_lossy(&cwd(&path), args).await?;
    Ok(parse_unified(&text))
}

#[tauri::command]
pub async fn diff_workdir(
    path: String,
    file: Option<String>,
    ignore_ws: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<Vec<FileDiff>> {
    let mut args: Vec<String> = vec!["diff".into(), "--no-color".into(), "-U3".into()];
    push_ignore_ws(&mut args, ignore_ws);
    push_file_path(&mut args, file);
    let text = state.git.run_text(&cwd(&path), args).await?;
    Ok(parse_unified(&text))
}

#[tauri::command]
pub async fn diff_index(
    path: String,
    file: Option<String>,
    ignore_ws: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<Vec<FileDiff>> {
    let mut args: Vec<String> = vec![
        "diff".into(),
        "--cached".into(),
        "--no-color".into(),
        "-U3".into(),
    ];
    push_ignore_ws(&mut args, ignore_ws);
    push_file_path(&mut args, file);
    let text = state.git.run_text(&cwd(&path), args).await?;
    Ok(parse_unified(&text))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args_of(ignore_ws: Option<bool>) -> Vec<String> {
        let mut args = vec!["diff".to_string()];
        push_ignore_ws(&mut args, ignore_ws);
        args
    }

    #[test]
    fn ignore_ws_adds_dash_w_only_when_true() {
        assert_eq!(args_of(Some(true)), vec!["diff", "-w"]);
        assert_eq!(args_of(Some(false)), vec!["diff"]);
        assert_eq!(args_of(None), vec!["diff"]);
    }

    #[test]
    fn file_path_is_separated_by_double_dash() {
        let mut args = vec!["diff".to_string()];
        push_file_path(&mut args, Some("src/a b.rs".into()));
        assert_eq!(args, vec!["diff", "--", "src/a b.rs"]);
    }

    #[test]
    fn missing_file_path_adds_nothing() {
        let mut args = vec!["diff".to_string()];
        push_file_path(&mut args, None);
        assert_eq!(args, vec!["diff"]);
    }

    #[test]
    fn commit_diff_uses_first_parent_for_merges() {
        let args = commit_diff_args("abc", None, None).unwrap();
        assert!(args.contains(&"--diff-merges=first-parent".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("abc"));
    }

    #[test]
    fn commit_diff_puts_file_after_sha_and_ws_flag_before_sha() {
        let args = commit_diff_args("abc", Some("src/a b.rs".into()), Some(true)).unwrap();
        assert!(args.contains(&"-w".to_string()));
        assert_eq!(&args[args.len() - 3..], &["abc", "--", "src/a b.rs"]);
    }

    #[test]
    fn commit_diff_refuses_an_option_like_sha() {
        assert!(commit_diff_args("--output=x", None, None).is_err());
    }
}
