//! Applies a patch that the frontend built from picked hunks or lines. Spec:
//! docs/specs/hunk-staging.md.

use crate::error::AppResult;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

fn cwd(path: &str) -> PathBuf { PathBuf::from(path) }

/// Pure: arguments for `git apply`. `--recount` takes the hunk counts from the
/// body, so a header that is slightly off still applies. `--whitespace=nowarn`
/// keeps git from printing warnings about whitespace in the user's own lines.
/// `-` reads the patch from stdin. Without `--cached` the worktree is changed.
fn apply_args(cached: bool, reverse: bool) -> Vec<&'static str> {
    let mut args = vec!["apply", "--recount", "--whitespace=nowarn"];
    if cached {
        args.push("--cached");
    }
    if reverse {
        args.push("--reverse");
    }
    args.push("-");
    args
}

/// Applies `patch` to the index (`cached`) or the worktree, in reverse when
/// `reverse` is set. A patch that does not match fails with git's stderr, and
/// git applies nothing in that case.
#[tauri::command]
pub async fn apply_patch_text(
    path: String,
    patch: String,
    cached: bool,
    reverse: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state
        .git
        .run_with_stdin(&cwd(&path), apply_args(cached, reverse), patch.as_bytes())
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forward_worktree_apply_reads_stdin_without_flags() {
        assert_eq!(apply_args(false, false), vec!["apply", "--recount", "--whitespace=nowarn", "-"]);
    }

    #[test]
    fn stage_is_cached_and_forward() {
        assert_eq!(
            apply_args(true, false),
            vec!["apply", "--recount", "--whitespace=nowarn", "--cached", "-"]
        );
    }

    #[test]
    fn unstage_is_cached_and_reverse() {
        assert_eq!(
            apply_args(true, true),
            vec!["apply", "--recount", "--whitespace=nowarn", "--cached", "--reverse", "-"]
        );
    }

    #[test]
    fn discard_is_worktree_and_reverse() {
        assert_eq!(
            apply_args(false, true),
            vec!["apply", "--recount", "--whitespace=nowarn", "--reverse", "-"]
        );
    }
}
