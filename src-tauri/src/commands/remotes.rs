use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

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

#[tauri::command]
pub async fn remote_add(
    path: String,
    name: String,
    url: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["remote", "add", &name, &url]).await?;
    Ok(())
}

#[tauri::command]
pub async fn remote_remove(
    path: String,
    name: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["remote", "remove", &name]).await?;
    Ok(())
}

#[tauri::command]
pub async fn remote_fetch(
    path: String,
    name: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let n = name.unwrap_or_else(|| "--all".to_string());
    state.git.run(&cwd(&path), ["fetch", "--prune", &n]).await?;
    Ok(())
}

#[tauri::command]
pub async fn remote_pull(
    path: String,
    rebase: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut args: Vec<&str> = vec!["pull"];
    if rebase.unwrap_or(false) { args.push("--rebase"); }
    state.git.run(&cwd(&path), args).await?;
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
    // only the user-visible tag names.
    let text = state.git
        .run_text(&cwd(&path), ["ls-remote", "--tags", "--refs", &name])
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
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut args: Vec<String> = vec!["push".into()];
    if force.unwrap_or(false) { args.push("--force-with-lease".into()); }
    args.push(remote);
    if let Some(b) = branch { args.push(b); }
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}
