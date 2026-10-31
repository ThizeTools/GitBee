use crate::commands::git_progress::{run_reporting, GitOp};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

fn cwd(p: &str) -> PathBuf { PathBuf::from(p) }

#[derive(Debug, Serialize)]
pub struct RepoLogRow { pub ts: String, pub subject: String, pub author: String }

// Repository tab in the Logs panel: combine reflog + recent commits.
#[tauri::command]
pub async fn repo_logs(
    path: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> AppResult<Vec<RepoLogRow>> {
    let n = limit.unwrap_or(200).min(2000);
    let text = state.git.run_text(
        &cwd(&path),
        ["reflog", &format!("-n{n}"), "--format=%gd%x09%an%x09%ci%x09%gs"],
    ).await?;
    let mut out = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.splitn(4, '\t').collect();
        if parts.len() < 4 { continue; }
        out.push(RepoLogRow {
            ts: parts[2].into(),
            author: parts[1].into(),
            subject: format!("{} — {}", parts[0], parts[3]),
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn repo_clone(
    url: String,
    dest: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let dest_pb = PathBuf::from(&dest);
    if !dest_pb.exists() {
        tokio::fs::create_dir_all(&dest_pb).await?;
    }
    // Clone into dest/<basename>.
    let name = url
        .rsplit(['/', ':'])
        .next()
        .unwrap_or("repo")
        .trim_end_matches(".git")
        .to_string();
    let target = dest_pb.join(&name);
    if target.exists() {
        return Err(AppError::Other(format!("target already exists: {}", target.display())));
    }
    let target_str = target.to_string_lossy().into_owned();
    run_reporting(&app, &state.git, &dest_pb, &target_str, GitOp::Clone, ["clone", "--progress", &url, &target_str]).await?;
    let ts = now_secs();
    let _ = state.cache.upsert_repo(target.to_string_lossy().as_ref(), ts);
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn repo_create(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let pb = PathBuf::from(&path);
    if !pb.is_dir() {
        return Err(AppError::InvalidRepoPath(path));
    }
    state.git.run(&pb, ["init"]).await?;
    let ts = now_secs();
    let _ = state.cache.upsert_repo(pb.to_string_lossy().as_ref(), ts);
    Ok(pb.to_string_lossy().into_owned())
}

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}
