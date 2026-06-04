use crate::error::AppResult;
use crate::git::checked_ref;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

fn cwd(path: &str) -> PathBuf { PathBuf::from(path) }

#[tauri::command]
pub async fn tag_create(
    path: String,
    name: String,
    sha: Option<String>,
    message: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    checked_ref(&name)?;
    if let Some(s) = sha.as_deref() { checked_ref(s)?; }
    let mut args: Vec<String> = vec!["tag".into()];
    if let Some(m) = message { args.push("-a".into()); args.push("-m".into()); args.push(m); }
    args.push(name);
    if let Some(s) = sha { args.push(s); }
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

#[tauri::command]
pub async fn tag_delete(
    path: String,
    name: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["tag", "-d", checked_ref(&name)?]).await?;
    Ok(())
}

// Move an existing tag to point at a new commit (`git tag -f <name>
// <sha>`). Used by the "Fast-forward tag" action; the caller passes
// HEAD's sha. Note that this is a destructive rewrite — if the tag was
// already pushed, the user has to push again with `--force` for the
// remote to advance.
#[tauri::command]
pub async fn tag_move(
    path: String,
    name: String,
    sha: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["tag", "-f", checked_ref(&name)?, checked_ref(&sha)?]).await?;
    Ok(())
}

// Convert a lightweight tag into an annotated one (or change an existing
// annotated tag's message). Git has no in-place "annotate" — the only
// way is delete + recreate, so this command does both atomically from
// the user's POV. Same caveat as tag_move re: pushed tags.
#[tauri::command]
pub async fn tag_annotate(
    path: String,
    name: String,
    message: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    checked_ref(&name)?;
    let sha = state
        .git
        .run_text(&cwd(&path), ["rev-parse", &format!("{name}^{{}}")])
        .await?
        .trim()
        .to_string();
    state.git.run(&cwd(&path), ["tag", "-d", &name]).await?;
    state
        .git
        .run(&cwd(&path), ["tag", "-a", &name, "-m", &message, &sha])
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn tag_push(
    path: String,
    remote: String,
    name: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["push", checked_ref(&remote)?, checked_ref(&name)?]).await?;
    Ok(())
}
