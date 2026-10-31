//! Backups that let the frontend Undo destructive actions: a single file as
//! a git blob, and the whole worktree as a stash-like commit. Spec:
//! docs/specs/undo-history.md.

use crate::error::{AppError, AppResult};
use crate::git::checked_ref;
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::State;

/// Message on the stash commit made by a discard-all backup. The commit is
/// dropped from the stash list right after creation, so the message is only
/// visible in the object store.
const BACKUP_MESSAGE: &str = "GitBee backup";

fn cwd(path: &str) -> PathBuf { PathBuf::from(path) }

/// Pure: arguments for `git hash-object`. `--no-filters` stores the bytes on
/// disk as they are, so restoring writes back exactly what was there (no
/// CRLF or clean-filter rewrite). `--` stops a file named `-x` being read as
/// an option.
fn hash_object_args(file: &str) -> Vec<String> {
    vec!["hash-object".into(), "-w".into(), "--no-filters".into(), "--".into(), file.into()]
}

/// Pure: arguments for the stash push that backs up the whole worktree,
/// including untracked files.
fn stash_push_args() -> Vec<String> {
    vec![
        "stash".into(),
        "push".into(),
        "--include-untracked".into(),
        "-m".into(),
        BACKUP_MESSAGE.into(),
    ]
}

/// Pure: arguments that put a dropped stash commit back on the stash list.
fn stash_store_args(sha: &str, message: &str) -> Vec<String> {
    vec!["stash".into(), "store".into(), "-m".into(), message.into(), sha.into()]
}

/// Pure: arguments that re-apply a backup commit. `--index` restores the
/// staged state too, not only the working tree.
fn apply_backup_args(sha: &str) -> Vec<String> {
    vec!["stash".into(), "apply".into(), "--index".into(), sha.into()]
}

/// Pure: the worktree location of a repo-relative file.
fn worktree_file(root: &str, file: &str) -> PathBuf {
    Path::new(root).join(file)
}

/// Pure: reads the object id git printed. Accepts SHA-1 (40 hex digits) and
/// SHA-256 (64 hex digits) repositories.
fn parse_object_id(stdout: &str) -> AppResult<String> {
    let id = stdout.trim();
    let well_formed = matches!(id.len(), 40 | 64) && id.bytes().all(|b| b.is_ascii_hexdigit());
    if well_formed {
        return Ok(id.to_string());
    }
    Err(AppError::Parse(format!(
        "expected a 40 or 64 hex digit object id, got {id:?}"
    )))
}

/// Pure: whether `git stash push` created a new stash commit. Git exits 0
/// with "No local changes to save" in that case, and refs/stash still points
/// at the user's previous stash, which must not be dropped.
fn backup_created(before: Option<&str>, after: &str) -> bool {
    before != Some(after)
}

fn remove_file_if_present(target: &Path) -> AppResult<()> {
    if target.is_file() {
        std::fs::remove_file(target)?;
    }
    Ok(())
}

/// Writes the blob's bytes over `target`, creating missing parent folders.
async fn write_blob(state: &AppState, root: &str, target: &Path, sha: &str) -> AppResult<()> {
    let bytes = state.git.run(&cwd(root), ["cat-file", "blob", sha]).await?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(target, bytes)?;
    Ok(())
}

async fn stash_top(state: &AppState, dir: &Path) -> AppResult<String> {
    let out = state.git.run_text(dir, ["rev-parse", "--verify", "refs/stash"]).await?;
    parse_object_id(&out)
}

/// Stores a worktree file's current bytes as a git blob. Returns None when
/// the file is absent, so restoring it means deleting it again.
#[tauri::command]
pub async fn backup_file(
    path: String,
    file: String,
    state: State<'_, AppState>,
) -> AppResult<Option<String>> {
    if !worktree_file(&path, &file).is_file() {
        return Ok(None);
    }
    let out = state.git.run_text(&cwd(&path), hash_object_args(&file)).await?;
    Ok(Some(parse_object_id(&out)?))
}

/// Puts a file back to a blob from `backup_file`, or deletes it when the
/// backup recorded no file.
#[tauri::command]
pub async fn restore_file(
    path: String,
    file: String,
    blob: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let target = worktree_file(&path, &file);
    match blob {
        Some(sha) => write_blob(&state, &path, &target, checked_ref(&sha)?).await,
        None => remove_file_if_present(&target),
    }
}

/// Discards all staged, unstaged and untracked changes, like `reset --hard`
/// plus `clean -fd`, but first keeps them in a stash commit that is dropped
/// from the stash list. The commit stays in the object store (until gc), so
/// `apply_backup` can bring the changes back without a visible stash entry.
/// Returns None when there was nothing to discard.
#[tauri::command]
pub async fn discard_all_with_backup(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<Option<String>> {
    let dir = cwd(&path);
    let status = state.git.run_text(&dir, ["status", "--porcelain"]).await?;
    if status.trim().is_empty() {
        return Ok(None);
    }
    let before = stash_top(&state, &dir).await.ok();
    state.git.run(&dir, stash_push_args()).await?;
    let Some(top) = stash_top(&state, &dir).await.ok() else {
        return Ok(None);
    };
    if !backup_created(before.as_deref(), &top) {
        return Ok(None);
    }
    state.git.run(&dir, ["stash", "drop", "-q", "stash@{0}"]).await?;
    Ok(Some(top))
}

/// Re-applies a backup commit from `discard_all_with_backup`, leaving the
/// stash list untouched.
#[tauri::command]
pub async fn apply_backup(
    path: String,
    sha: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let args = apply_backup_args(checked_ref(&sha)?);
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

/// Adds a dropped stash commit back to the top of the stash list.
#[tauri::command]
pub async fn stash_store(
    path: String,
    sha: String,
    message: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let args = stash_store_args(checked_ref(&sha)?, &message);
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHA: &str = "5ea2ed416fbd4a4cbe227b75fe255dd7fa6bd4d6";

    #[test]
    fn hash_object_args_store_raw_bytes_and_end_options_before_the_file() {
        assert_eq!(
            hash_object_args("-odd.txt"),
            ["hash-object", "-w", "--no-filters", "--", "-odd.txt"]
        );
    }

    #[test]
    fn stash_push_args_include_untracked_and_the_backup_message() {
        assert_eq!(
            stash_push_args(),
            ["stash", "push", "--include-untracked", "-m", "GitBee backup"]
        );
    }

    #[test]
    fn stash_store_args_put_the_message_before_the_commit() {
        assert_eq!(
            stash_store_args(SHA, "On main: wip"),
            ["stash", "store", "-m", "On main: wip", SHA]
        );
    }

    #[test]
    fn apply_backup_args_restore_the_index_too() {
        assert_eq!(apply_backup_args(SHA), ["stash", "apply", "--index", SHA]);
    }

    #[test]
    fn worktree_file_joins_root_and_relative_path() {
        assert_eq!(
            worktree_file("repo", "src/a.rs"),
            Path::new("repo").join("src/a.rs")
        );
    }

    #[test]
    fn parse_object_id_trims_git_output() {
        assert_eq!(parse_object_id(&format!("{SHA}\n")).unwrap(), SHA);
    }

    #[test]
    fn parse_object_id_accepts_sha256_length() {
        let sha256 = "a".repeat(64);
        assert_eq!(parse_object_id(&sha256).unwrap(), sha256);
    }

    #[test]
    fn parse_object_id_rejects_empty_output_with_expected_shape() {
        let err = parse_object_id("").unwrap_err().to_string();
        assert!(err.contains("40 or 64 hex digit"), "{err}");
        assert!(err.contains("\"\""), "{err}");
    }

    #[test]
    fn parse_object_id_rejects_non_hex_and_shows_the_value() {
        let err = parse_object_id("not-a-sha").unwrap_err().to_string();
        assert!(err.contains("\"not-a-sha\""), "{err}");
    }

    #[test]
    fn backup_created_is_true_when_the_top_stash_is_new() {
        assert!(backup_created(None, SHA));
        assert!(backup_created(Some("other"), SHA));
    }

    #[test]
    fn backup_created_is_false_when_the_top_stash_is_unchanged() {
        assert!(!backup_created(Some(SHA), SHA));
    }

    #[test]
    fn remove_file_if_present_deletes_an_existing_file_and_ignores_a_missing_one() {
        let dir = std::env::temp_dir().join(format!("gitbee-undo-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("x.txt");
        std::fs::write(&file, b"bytes").unwrap();
        remove_file_if_present(&file).unwrap();
        assert!(!file.exists());
        remove_file_if_present(&file).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
