use crate::error::AppResult;
use crate::git::checked_ref;
use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

fn cwd(path: &str) -> PathBuf { PathBuf::from(path) }

#[derive(Debug, Serialize)]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
    pub sha: String,
}

#[tauri::command]
pub async fn stash_list(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<StashEntry>> {
    let text = state
        .git
        .run_text(&cwd(&path), ["stash", "list", "--format=%H%x09%gd%x09%gs"])
        .await?;
    let mut out = Vec::new();
    for (idx, line) in text.lines().enumerate() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() < 3 { continue; }
        // Derive the index from git's own selector (`%gd` → "stash@{N}"),
        // NOT the enumerate counter: a skipped malformed line would shift the
        // counter and make stash_apply/pop/drop target the WRONG stash. Fall
        // back to the counter only if the selector can't be parsed. (audit 2026-05)
        out.push(StashEntry {
            index: parse_stash_index(parts[1], idx),
            message: parts[2].to_string(),
            sha: parts[0].to_string(),
        });
    }
    Ok(out)
}

// Extract N from git's stash selector "stash@{N}".
fn parse_stash_index(selector: &str, fallback: usize) -> usize {
    selector
        .rsplit_once('{')
        .and_then(|(_, rest)| rest.strip_suffix('}'))
        .and_then(|n| n.parse().ok())
        .unwrap_or(fallback)
}

// Builds the "stash@{N}" selector every apply/pop/drop positional uses. The
// selector is generated from a number, so `checked_ref` cannot fail on it today;
// it stays so every positional goes through the same rule.
fn stash_ref(index: usize) -> String {
    format!("stash@{{{index}}}")
}

// `-m <msg>` is an option argument, so a message starting with '-' is safe and
// is not validated.
#[tauri::command]
pub async fn stash_create(
    path: String,
    message: Option<String>,
    include_untracked: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut args: Vec<String> = vec!["stash".into(), "push".into()];
    if include_untracked.unwrap_or(false) { args.push("-u".into()); }
    if let Some(m) = message { args.push("-m".into()); args.push(m); }
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

#[tauri::command]
pub async fn stash_apply(
    path: String,
    index: usize,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let r = stash_ref(index);
    state.git.run(&cwd(&path), ["stash", "apply", checked_ref(&r)?]).await?;
    Ok(())
}

#[tauri::command]
pub async fn stash_pop(
    path: String,
    index: usize,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let r = stash_ref(index);
    state.git.run(&cwd(&path), ["stash", "pop", checked_ref(&r)?]).await?;
    Ok(())
}

#[tauri::command]
pub async fn stash_drop(
    path: String,
    index: usize,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let r = stash_ref(index);
    state.git.run(&cwd(&path), ["stash", "drop", checked_ref(&r)?]).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stash_ref_builds_the_selector_git_expects() {
        assert_eq!(stash_ref(3), "stash@{3}");
    }
}
