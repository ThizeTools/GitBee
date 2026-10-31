// Git LFS commands. Detection and file checks run git only where the repo uses
// LFS; the actions refuse when git-lfs is missing. Spec: docs/specs/git-lfs.md.

use crate::error::{AppError, AppResult};
use crate::git::lfs::{
    check_lfs_paths, parse_lfs_version, read_patterns, validate_pattern, LfsInfo,
};
use crate::state::AppState;
use std::path::Path;
use tauri::State;
use tokio::sync::OnceCell;

// The git-lfs version probe runs once per app session, not once per repo tab.
// WHY: a repo that never uses LFS should not start a git process for it on
// every open. The probe runs in the temp dir, so a missing repo folder cannot
// cache "not installed" for the whole session. A later install needs a restart.
static LFS_VERSION: OnceCell<Option<String>> = OnceCell::const_new();

async fn installed_version(state: &AppState) -> Option<String> {
    LFS_VERSION
        .get_or_init(|| probe_version(state))
        .await
        .clone()
}

async fn probe_version(state: &AppState) -> Option<String> {
    let out = state
        .git
        .run_text(&std::env::temp_dir(), ["lfs", "version"])
        .await
        .ok()?;
    parse_lfs_version(&out)
}

/// Every action goes through this, so a missing git-lfs gives one message.
async fn require_installed(state: &AppState) -> AppResult<()> {
    match installed_version(state).await {
        Some(_) => Ok(()),
        None => Err(AppError::Lfs("Git LFS is not installed".into())),
    }
}

#[tauri::command]
pub async fn lfs_status(path: String, state: State<'_, AppState>) -> AppResult<LfsInfo> {
    let version = installed_version(&state).await;
    let patterns = read_patterns(Path::new(&path)).await;
    Ok(LfsInfo {
        installed: version.is_some(),
        version,
        used: !patterns.is_empty(),
        patterns,
    })
}

/// Which of `paths` are LFS files. A repo whose root .gitattributes names no
/// LFS pattern answers without starting git, which keeps the invariant that a
/// non-LFS repo never pays for an LFS check.
#[tauri::command]
pub async fn lfs_files(
    path: String,
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    let repo = Path::new(&path);
    if read_patterns(repo).await.is_empty() {
        return Ok(Vec::new());
    }
    check_lfs_paths(&state.git, repo, &paths).await
}

#[tauri::command]
pub async fn lfs_pull(path: String, state: State<'_, AppState>) -> AppResult<()> {
    require_installed(&state).await?;
    state.git.run(Path::new(&path), ["lfs", "pull"]).await?;
    Ok(())
}

#[tauri::command]
pub async fn lfs_fetch(path: String, state: State<'_, AppState>) -> AppResult<()> {
    require_installed(&state).await?;
    state.git.run(Path::new(&path), ["lfs", "fetch"]).await?;
    Ok(())
}

#[tauri::command]
pub async fn lfs_track(path: String, pattern: String, state: State<'_, AppState>) -> AppResult<()> {
    let pattern = validate_pattern(&pattern)?;
    require_installed(&state).await?;
    state.git.run(Path::new(&path), ["lfs", "track", pattern]).await?;
    Ok(())
}

#[tauri::command]
pub async fn lfs_untrack(path: String, pattern: String, state: State<'_, AppState>) -> AppResult<()> {
    let pattern = validate_pattern(&pattern)?;
    require_installed(&state).await?;
    state.git.run(Path::new(&path), ["lfs", "untrack", pattern]).await?;
    Ok(())
}

/// `--local` writes the hooks into this repo's .git only, not the global config.
#[tauri::command]
pub async fn lfs_install(path: String, state: State<'_, AppState>) -> AppResult<()> {
    require_installed(&state).await?;
    state.git.run(Path::new(&path), ["lfs", "install", "--local"]).await?;
    Ok(())
}
