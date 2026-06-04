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
