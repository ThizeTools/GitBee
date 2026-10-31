use crate::error::AppResult;
use crate::git::checked_ref;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

fn cwd(path: &str) -> PathBuf { PathBuf::from(path) }

#[tauri::command]
pub async fn branch_create(
    path: String,
    name: String,
    start_point: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    checked_ref(&name)?;
    if let Some(sp) = start_point.as_deref() { checked_ref(sp)?; }
    let mut args: Vec<String> = vec!["branch".into(), name];
    if let Some(sp) = start_point { args.push(sp); }
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

#[tauri::command]
pub async fn branch_checkout(
    path: String,
    name: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["checkout", checked_ref(&name)?]).await?;
    Ok(())
}

#[tauri::command]
pub async fn branch_delete(
    path: String,
    name: String,
    force: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let flag = if force.unwrap_or(false) { "-D" } else { "-d" };
    state.git.run(&cwd(&path), ["branch", flag, checked_ref(&name)?]).await?;
    Ok(())
}

#[tauri::command]
pub async fn branch_rename(
    path: String,
    old: String,
    new: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["branch", "-m", checked_ref(&old)?, checked_ref(&new)?]).await?;
    Ok(())
}

#[tauri::command]
pub async fn branch_merge(
    path: String,
    from: String,
    no_ff: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut args: Vec<&str> = vec!["merge"];
    if no_ff.unwrap_or(false) { args.push("--no-ff"); }
    args.push(checked_ref(&from)?);
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

#[tauri::command]
pub async fn branch_rebase(
    path: String,
    onto: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["rebase", checked_ref(&onto)?]).await?;
    Ok(())
}

// Moves local branch `target` to `src` without checking it out (the drag-and-drop
// "fast-forward" option). The refspec is a plain update, so git itself refuses a
// non-fast-forward move and refuses the branch that is checked out.
#[tauri::command]
pub async fn branch_fast_forward_local(
    path: String,
    src: String,
    target: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let args = fast_forward_local_args(&src, &target)?;
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

// Fast-forwards the checked-out branch to `from`. `--ff-only` makes git refuse
// to create a merge commit, so this option can never add history by itself.
#[tauri::command]
pub async fn branch_merge_ff_only(
    path: String,
    from: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let args = merge_ff_only_args(&from)?;
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

// Fully qualified refs, so a branch named like a git option or a force flag
// cannot change what the refspec means.
fn fast_forward_local_args(src: &str, target: &str) -> AppResult<Vec<String>> {
    let refspec = format!(
        "refs/heads/{}:refs/heads/{}",
        checked_ref(src)?,
        checked_ref(target)?
    );
    Ok(vec!["fetch".into(), ".".into(), refspec])
}

fn merge_ff_only_args(from: &str) -> AppResult<Vec<String>> {
    Ok(vec!["merge".into(), "--ff-only".into(), checked_ref(from)?.into()])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fast_forward_local_args_name_both_branches_as_full_refs() {
        let args = fast_forward_local_args("feature", "main").unwrap();
        assert_eq!(args, ["fetch", ".", "refs/heads/feature:refs/heads/main"]);
    }

    #[test]
    fn fast_forward_local_args_keep_a_plus_name_out_of_the_force_position() {
        let args = fast_forward_local_args("+feature", "+main").unwrap();
        assert_eq!(args[2], "refs/heads/+feature:refs/heads/+main");
    }

    #[test]
    fn fast_forward_local_args_reject_an_option_like_source_or_target() {
        assert!(fast_forward_local_args("--force", "main").is_err());
        assert!(fast_forward_local_args("feature", "-d").is_err());
    }

    #[test]
    fn merge_ff_only_args_pass_ff_only_before_the_ref() {
        let args = merge_ff_only_args("origin/main").unwrap();
        assert_eq!(args, ["merge", "--ff-only", "origin/main"]);
    }

    #[test]
    fn merge_ff_only_args_reject_an_option_like_ref() {
        assert!(merge_ff_only_args("--no-ff").is_err());
    }
}

// Set or clear the upstream tracking branch for `branch`. Passing
// `remote=None` (or empty) unsets the upstream — useful when the user
// wants to detach from a deleted upstream. The remote-side branch name
// defaults to `branch` when `remote_branch` is not provided.
#[tauri::command]
pub async fn branch_set_upstream(
    path: String,
    branch: String,
    remote: Option<String>,
    remote_branch: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    checked_ref(&branch)?;
    match remote.as_deref() {
        None | Some("") => {
            state.git.run(&cwd(&path), ["branch", "--unset-upstream", &branch]).await?;
        }
        Some(r) => {
            let rb = remote_branch.as_deref().unwrap_or(&branch);
            checked_ref(r)?;
            checked_ref(rb)?;
            let target = format!("{r}/{rb}");
            state
                .git
                .run(&cwd(&path), ["branch", &format!("--set-upstream-to={target}"), &branch])
                .await?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn checkout_sha(
    path: String,
    sha: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["checkout", checked_ref(&sha)?]).await?;
    Ok(())
}
