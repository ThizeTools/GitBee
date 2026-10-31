use crate::error::AppResult;
use crate::git::checked_ref;
use crate::git::diff::{parse_unified, FileDiff};
use crate::git::file_log::literal_pathspec;
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

/// Appends `-- <paths>` for the file and, when the commit renamed it, the file's
/// old name. Both go in one pathspec list so rename detection sees the pair.
/// Each path gets `:(literal)`, so `[`, `*` and `?` in a name are not globs.
/// Without a file git diffs the whole tree; the center panel always passes one.
fn push_file_paths(
    args: &mut Vec<String>,
    file: Option<String>,
    old_file: Option<String>,
) -> AppResult<()> {
    let paths: Vec<String> = file.into_iter().chain(old_file).collect();
    if paths.is_empty() {
        return Ok(());
    }
    args.push("--".into());
    for path in &paths {
        args.push(literal_pathspec(path)?);
    }
    Ok(())
}

/// The single-path form used by the working tree and index diffs.
fn push_file_path(args: &mut Vec<String>, file: Option<String>) -> AppResult<()> {
    push_file_paths(args, file, None)
}

/// With `file`, only that path is diffed. The center diff panel and the commit
/// details panel (one expanded file at a time) both pass it. A renamed file
/// needs `old_file` too: without it git sees only the new path and shows the
/// rename as an added file. See docs/specs/commit-details.md.
#[tauri::command]
pub async fn diff_commit(
    path: String,
    sha: String,
    file: Option<String>,
    old_file: Option<String>,
    ignore_ws: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<Vec<FileDiff>> {
    let args = commit_diff_args(&sha, file, old_file, ignore_ws)?;
    let text = state.git.run_text_lossy(&cwd(&path), args).await?;
    Ok(parse_unified(&text))
}

/// `git show` args for a commit or one file of it. `--diff-merges=first-parent`
/// diffs a merge against its first parent, the same base `commit_files` lists
/// against. Without it `git show` prints the combined diff, which is usually
/// empty for a merge, so an expanded file would read "No changes".
/// `-M` is added only with `old_file`: a lone path has no partner to pair with.
fn commit_diff_args(
    sha: &str,
    file: Option<String>,
    old_file: Option<String>,
    ignore_ws: Option<bool>,
) -> AppResult<Vec<String>> {
    let mut args: Vec<String> = vec![
        "show".into(),
        "--format=".into(),
        "--no-color".into(),
        "-U3".into(),
        "--diff-merges=first-parent".into(),
    ];
    push_ignore_ws(&mut args, ignore_ws);
    if old_file.is_some() {
        args.push("-M".into());
    }
    args.push(checked_ref(sha)?.into());
    push_file_paths(&mut args, file, old_file)?;
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
    push_file_path(&mut args, file)?;
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
    push_file_path(&mut args, file)?;
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

    fn path_args(file: Option<&str>, old_file: Option<&str>) -> Vec<String> {
        let mut args = vec!["diff".to_string()];
        push_file_paths(
            &mut args,
            file.map(String::from),
            old_file.map(String::from),
        )
        .unwrap();
        args
    }

    #[test]
    fn ignore_ws_adds_dash_w_only_when_true() {
        assert_eq!(args_of(Some(true)), vec!["diff", "-w"]);
        assert_eq!(args_of(Some(false)), vec!["diff"]);
        assert_eq!(args_of(None), vec!["diff"]);
    }

    #[test]
    fn file_path_is_literal_and_separated_by_double_dash() {
        let mut args = vec!["diff".to_string()];
        push_file_path(&mut args, Some("src/a b.rs".into())).unwrap();
        assert_eq!(args, vec!["diff", "--", ":(literal)src/a b.rs"]);
    }

    #[test]
    fn glob_characters_in_a_file_name_are_not_globs() {
        let mut args = vec!["diff".to_string()];
        push_file_path(&mut args, Some("a[1]*?.txt".into())).unwrap();
        assert_eq!(args, vec!["diff", "--", ":(literal)a[1]*?.txt"]);
    }

    #[test]
    fn missing_file_path_adds_nothing() {
        let mut args = vec!["diff".to_string()];
        push_file_path(&mut args, None).unwrap();
        assert_eq!(args, vec!["diff"]);
    }

    #[test]
    fn empty_file_path_is_refused_not_passed_to_git() {
        let mut args = vec!["diff".to_string()];
        assert!(push_file_path(&mut args, Some(String::new())).is_err());
    }

    #[test]
    fn old_and_new_paths_are_both_listed_after_one_double_dash() {
        assert_eq!(
            path_args(Some("new.rs"), Some("old.rs")),
            vec!["diff", "--", ":(literal)new.rs", ":(literal)old.rs"],
        );
    }

    #[test]
    fn commit_diff_uses_first_parent_for_merges() {
        let args = commit_diff_args("abc", None, None, None).unwrap();
        assert!(args.contains(&"--diff-merges=first-parent".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("abc"));
    }

    #[test]
    fn commit_diff_puts_file_after_sha_and_ws_flag_before_sha() {
        let args = commit_diff_args("abc", Some("src/a b.rs".into()), None, Some(true)).unwrap();
        assert!(args.contains(&"-w".to_string()));
        assert_eq!(&args[args.len() - 3..], &["abc", "--", ":(literal)src/a b.rs"]);
    }

    #[test]
    fn commit_diff_with_old_file_turns_on_rename_detection_and_lists_both_paths() {
        let args = commit_diff_args("abc", Some("new.rs".into()), Some("old.rs".into()), None).unwrap();
        assert!(args.contains(&"-M".to_string()));
        assert_eq!(
            &args[args.len() - 4..],
            &["abc", "--", ":(literal)new.rs", ":(literal)old.rs"],
        );
    }

    #[test]
    fn commit_diff_without_old_file_does_not_ask_for_rename_detection() {
        let args = commit_diff_args("abc", Some("new.rs".into()), None, None).unwrap();
        assert!(!args.contains(&"-M".to_string()));
    }

    #[test]
    fn commit_diff_refuses_an_option_like_sha() {
        assert!(commit_diff_args("--output=x", None, None, None).is_err());
    }
}
