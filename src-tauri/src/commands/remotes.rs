use crate::commands::git_progress::{run_reporting, GitOp};
use crate::error::{AppError, AppResult};
use crate::git::checked_ref;
use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, State};

fn cwd(path: &str) -> PathBuf { PathBuf::from(path) }

#[derive(Debug, Serialize)]
pub struct Remote {
    pub name: String,
    pub url: String,
}

#[tauri::command]
pub async fn remote_list(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<Remote>> {
    let text = state.git.run_text(&cwd(&path), ["remote", "-v"]).await?;
    let mut seen: Vec<Remote> = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 { continue; }
        if seen.iter().any(|r| r.name == parts[0]) { continue; }
        seen.push(Remote { name: parts[0].to_string(), url: parts[1].to_string() });
    }
    Ok(seen)
}

// The name is a ref-like positional, so it goes through `checked_ref`. The URL
// gets its own check: git would read a URL such as `--upload-pack=…` as an
// option, and `checked_ref`'s message would wrongly call it a ref.
#[tauri::command]
pub async fn remote_add(
    path: String,
    name: String,
    url: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state
        .git
        .run(&cwd(&path), ["remote", "add", checked_ref(&name)?, checked_remote_url(&url)?])
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn remote_remove(
    path: String,
    name: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["remote", "remove", checked_ref(&name)?]).await?;
    Ok(())
}

#[tauri::command]
pub async fn remote_fetch(
    path: String,
    name: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let n = fetch_target(name)?;
    run_reporting(&app, &state.git, &cwd(&path), &path, GitOp::Fetch, ["fetch", "--prune", "--progress", &n]).await?;
    Ok(())
}

// `--all` is a git flag, not a remote name, so it is built here and never
// passed through `checked_ref` (which would reject it).
fn fetch_target(name: Option<String>) -> AppResult<String> {
    match name {
        None => Ok("--all".to_string()),
        Some(n) => Ok(checked_ref(&n)?.to_string()),
    }
}

#[tauri::command]
pub async fn remote_pull(
    path: String,
    rebase: Option<bool>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut args: Vec<&str> = vec!["pull", "--progress"];
    if rebase.unwrap_or(false) { args.push("--rebase"); }
    run_reporting(&app, &state.git, &cwd(&path), &path, GitOp::Pull, args).await?;
    Ok(())
}

#[tauri::command]
pub async fn remote_tags(
    path: String,
    name: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    // `ls-remote --tags` returns "<sha>\trefs/tags/<name>"; we strip the
    // peeled "^{}" entries (annotated tag dereferences) so the caller sees
    // only the user-visible tag names. `--` ends option parsing before the
    // remote, so a name starting with '-' cannot be read as a flag.
    let text = state.git
        .run_text(&cwd(&path), ["ls-remote", "--tags", "--refs", "--", checked_ref(&name)?])
        .await?;
    let mut out = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() != 2 { continue; }
        if let Some(rest) = parts[1].strip_prefix("refs/tags/") {
            if !rest.ends_with("^{}") { out.push(rest.to_string()); }
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn remote_push(
    path: String,
    remote: String,
    branch: Option<String>,
    force: Option<bool>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut args: Vec<String> = vec!["push".into(), "--progress".into()];
    if force.unwrap_or(false) { args.push("--force-with-lease".into()); }
    args.push(checked_ref(&remote)?.to_string());
    if let Some(b) = branch { args.push(checked_ref(&b)?.to_string()); }
    run_reporting(&app, &state.git, &cwd(&path), &path, GitOp::Push, args).await?;
    Ok(())
}

/// Fast-forwards a local branch to its remote counterpart without checking it
/// out. "Pull" on a non-HEAD branch used to pull HEAD instead (bug found
/// 2026-10), so the UI sends non-HEAD branches here. Git itself refuses a
/// non-fast-forward update and refuses to update the checked-out branch, which
/// is the behavior wanted. Example: `branchFastForward(path, "origin", "dev")`.
#[tauri::command]
pub async fn branch_fast_forward(
    path: String,
    remote: String,
    branch: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let refspec = fast_forward_refspec(checked_ref(&branch)?);
    state
        .git
        .run(&cwd(&path), ["fetch", checked_ref(&remote)?, &refspec])
        .await?;
    Ok(())
}

// Fully qualified refs (not the bare `<b>:<b>` form) so a branch whose name
// starts with '+' is not read as git's force flag.
fn fast_forward_refspec(branch: &str) -> String {
    format!("refs/heads/{branch}:refs/heads/{branch}")
}

// See `remote_add`: a URL is validated for a leading '-' only.
fn checked_remote_url(value: &str) -> AppResult<&str> {
    if value.starts_with('-') {
        return Err(AppError::Other(format!(
            "invalid remote URL {value:?}: must not start with '-'"
        )));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fetch_target_defaults_to_all_remotes() {
        assert_eq!(fetch_target(None).unwrap(), "--all");
    }

    #[test]
    fn fetch_target_passes_a_plain_remote_name_through() {
        assert_eq!(fetch_target(Some("origin".into())).unwrap(), "origin");
    }

    #[test]
    fn fetch_target_rejects_an_option_like_remote_name() {
        assert!(fetch_target(Some("--upload-pack=x".into())).is_err());
    }

    #[test]
    fn checked_remote_url_rejects_a_leading_dash_and_names_the_value() {
        let err = checked_remote_url("--upload-pack=evil").unwrap_err();
        assert!(err.to_string().contains("--upload-pack=evil"));
    }

    #[test]
    fn checked_remote_url_accepts_https_and_scp_style_urls() {
        assert!(checked_remote_url("https://github.com/o/r.git").is_ok());
        assert!(checked_remote_url("git@github.com:o/r.git").is_ok());
    }

    #[test]
    fn fast_forward_refspec_uses_fully_qualified_refs() {
        assert_eq!(
            fast_forward_refspec("feature/x"),
            "refs/heads/feature/x:refs/heads/feature/x"
        );
    }

    #[test]
    fn fast_forward_refspec_keeps_a_plus_name_out_of_the_force_position() {
        assert_eq!(fast_forward_refspec("+main"), "refs/heads/+main:refs/heads/+main");
    }
}
