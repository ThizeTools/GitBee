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
