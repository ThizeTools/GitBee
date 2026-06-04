use crate::error::AppResult;
use crate::git::checked_ref;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

fn cwd(path: &str) -> PathBuf { PathBuf::from(path) }

#[tauri::command]
pub async fn commit_create(
    path: String,
    message: String,
    amend: Option<bool>,
    sign: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut args: Vec<String> = vec!["commit".into(), "-m".into(), message];
    if amend.unwrap_or(false) { args.push("--amend".into()); }
    if sign.unwrap_or(false) { args.push("-S".into()); }
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

#[tauri::command]
pub async fn commit_show(
    path: String,
    sha: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    state
        .git
        .run_text_lossy(
            &cwd(&path),
            ["show", "--no-color", "--format=fuller", checked_ref(&sha)?],
        )
        .await
}

#[tauri::command]
pub async fn commit_cherry_pick(
    path: String,
    sha: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["cherry-pick", checked_ref(&sha)?]).await?;
    Ok(())
}

#[tauri::command]
pub async fn commit_revert(
    path: String,
    sha: String,
    no_edit: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    checked_ref(&sha)?;
    let mut args: Vec<String> = vec!["revert".into()];
    if no_edit.unwrap_or(true) { args.push("--no-edit".into()); }
    args.push(sha);
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

// Generate a single-commit patch via `git format-patch -1 <sha> -o
// <dest_dir>`. Returns the absolute path of the generated `.patch` file
// (format-patch always writes one file for `-1`, named after the
// commit's subject). The caller passes a destination folder picked
// through Tauri's file dialog.
#[tauri::command]
pub async fn commit_format_patch(
    path: String,
    sha: String,
    dest_dir: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let output = state
        .git
        .run_text(&cwd(&path), ["format-patch", "-1", checked_ref(&sha)?, "-o", &dest_dir])
        .await?;
    // `format-patch -1` prints the single resulting filename on stdout,
    // relative to `dest_dir` on some git versions and absolute on
    // others. Normalize to absolute by joining when relative.
    let line = output.lines().next().unwrap_or("").trim().to_string();
    if line.is_empty() { return Ok(dest_dir); }
    let p = std::path::Path::new(&line);
    if p.is_absolute() {
        Ok(line)
    } else {
        Ok(std::path::Path::new(&dest_dir).join(p).to_string_lossy().into_owned())
    }
}

// Apply a patch file to the working tree via `git apply --3way`. The
// 3-way variant falls back to a merge with conflict markers when a
// straight apply doesn't cleanly fit, which matches what the user
// expects from a GUI ("apply this and tell me where conflicts are").
// The patch is NOT committed — the user inspects, stages, and commits
// like any other change. For a "treat patches as commits" workflow
// (`git am`) we'd add a separate command later.
#[tauri::command]
pub async fn patch_apply(
    path: String,
    patch_file: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state
        .git
        .run(&cwd(&path), ["apply", "--3way", &patch_file])
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn commit_reset(
    path: String,
    sha: String,
    mode: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let flag = match mode.as_str() {
        "soft" => "--soft",
        "hard" => "--hard",
        _ => "--mixed",
    };
    state.git.run(&cwd(&path), ["reset", flag, checked_ref(&sha)?]).await?;
    Ok(())
}
