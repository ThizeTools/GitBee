use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct Worktree {
    pub path: String,
    pub branch: Option<String>,
    pub head: String,
    pub bare: bool,
    pub locked: bool,
}

#[tauri::command]
pub async fn worktree_list(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<Worktree>> {
    let text = state
        .git
        .run_text(&PathBuf::from(&path), ["worktree", "list", "--porcelain"])
        .await?;
    Ok(parse(&text))
}

// Add a new worktree at `target` checking out `reference` (a branch, tag,
// or commit SHA). When `new_branch` is set, git creates that branch at
// `reference` and checks it out in the new worktree (`-b` flag); this is
// the common case when the ref is a remote-tracking branch the user
// hasn't pulled locally yet.
#[tauri::command]
pub async fn worktree_add(
    path: String,
    target: String,
    reference: String,
    new_branch: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut args: Vec<String> = vec!["worktree".into(), "add".into()];
    if let Some(b) = new_branch.as_deref() {
        if !b.is_empty() {
            args.push("-b".into());
            args.push(b.into());
        }
    }
    args.push(target);
    args.push(reference);
    state.git.run(&PathBuf::from(&path), args).await?;
    Ok(())
}

#[tauri::command]
pub async fn worktree_remove(
    path: String,
    target: String,
    force: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut args: Vec<&str> = vec!["worktree", "remove"];
    if force.unwrap_or(false) { args.push("--force"); }
    args.push(&target);
    state.git.run(&PathBuf::from(&path), args).await?;
    Ok(())
}

fn parse(text: &str) -> Vec<Worktree> {
    let mut out = Vec::new();
    let mut cur: Option<Worktree> = None;
    for line in text.lines() {
        if line.is_empty() {
            if let Some(w) = cur.take() { out.push(w); }
            continue;
        }
        if let Some(p) = line.strip_prefix("worktree ") {
            if let Some(w) = cur.take() { out.push(w); }
            cur = Some(Worktree {
                path: p.to_string(),
                branch: None,
                head: String::new(),
                bare: false,
                locked: false,
            });
        } else if let Some(w) = cur.as_mut() {
            if let Some(h) = line.strip_prefix("HEAD ") { w.head = h.to_string(); }
            else if let Some(b) = line.strip_prefix("branch ") {
                w.branch = Some(b.trim_start_matches("refs/heads/").to_string());
            }
            else if line == "bare" { w.bare = true; }
            else if line.starts_with("locked") { w.locked = true; }
        }
    }
    if let Some(w) = cur.take() { out.push(w); }
    out
}
