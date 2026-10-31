//! Submodule commands for the sidebar pane. Parsing lives in git/submodules.rs;
//! this file runs git and checks the user's input before git sees it. See
//! docs/specs/submodules.md for the contract and the reasons.

use crate::error::{AppError, AppResult};
use crate::git::submodules::{
    build_submodules, parse_dirty_paths, parse_gitmodules, parse_status_lines, ConfigEntry,
    Submodule,
};
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::State;

/// Lists the submodules declared in `.gitmodules`. A repo without that file
/// returns at once, so ordinary repos pay no git process for this feature.
#[tauri::command]
pub async fn submodule_list(path: String, state: State<'_, AppState>) -> AppResult<Vec<Submodule>> {
    let repo = PathBuf::from(&path);
    if !repo.join(".gitmodules").is_file() {
        return Ok(Vec::new());
    }
    let configs = parse_gitmodules(&config_text(&state, &repo).await?);
    if configs.is_empty() {
        return Ok(Vec::new());
    }
    let statuses = state
        .git
        .run_text(&repo, ["submodule", "status", "--recursive"])
        .await?;
    let dirty = dirty_paths(&state, &repo, &configs).await?;
    Ok(build_submodules(configs, &parse_status_lines(&statuses), &dirty))
}

/// Reads the `submodule.*` keys of `.gitmodules`. git exits 1 when no key
/// matches, which here means an empty list, not a failure.
async fn config_text(state: &AppState, repo: &Path) -> AppResult<String> {
    let args = ["config", "-f", ".gitmodules", "-z", "--get-regexp", r"^submodule\."];
    match state.git.run(repo, args).await {
        Ok(bytes) => Ok(String::from_utf8_lossy(&bytes).into_owned()),
        Err(AppError::GitFailed { status: Some(1), .. }) => Ok(String::new()),
        Err(e) => Err(e),
    }
}

/// Asks git which declared submodules have changes inside. The pathspec limits
/// the work to the submodule paths, so the cost stays near the submodule count.
async fn dirty_paths(state: &AppState, repo: &Path, configs: &[ConfigEntry]) -> AppResult<Vec<String>> {
    let paths: Vec<&str> = configs.iter().map(|c| c.path.as_str()).collect();
    let bytes = state.git.run(repo, status_args(&paths)).await?;
    Ok(parse_dirty_paths(&bytes))
}

fn status_args(paths: &[&str]) -> Vec<String> {
    let mut args: Vec<String> = [
        "--literal-pathspecs", "status", "--porcelain=v2", "-z", "--ignore-submodules=none", "--",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    args.extend(paths.iter().map(|p| p.to_string()));
    args
}

/// Runs `git submodule update`. `sub_path` limits it to one submodule; `init`
/// adds `--init` so uninitialized submodules get checked out.
#[tauri::command]
pub async fn submodule_update(
    path: String,
    sub_path: Option<String>,
    init: bool,
    recursive: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let args = update_args(sub_path.as_deref(), init, recursive)?;
    state.git.run(&PathBuf::from(&path), args).await?;
    Ok(())
}

fn update_args(sub_path: Option<&str>, init: bool, recursive: bool) -> AppResult<Vec<String>> {
    let mut args: Vec<String> = vec!["submodule".into(), "update".into()];
    if init {
        args.push("--init".into());
    }
    if recursive {
        args.push("--recursive".into());
    }
    if let Some(p) = sub_path {
        args.push("--".into());
        args.push(validate_sub_path(p)?.into());
    }
    Ok(args)
}

/// Copies the URLs from `.gitmodules` into each submodule's `.git/config`.
#[tauri::command]
pub async fn submodule_sync(path: String, state: State<'_, AppState>) -> AppResult<()> {
    state.git.run(&PathBuf::from(&path), ["submodule", "sync", "--recursive"]).await?;
    Ok(())
}

/// Runs `git submodule add -- <url> <sub_path>`. The `--` stops a URL that
/// starts with '-' from being read as a git option.
#[tauri::command]
pub async fn submodule_add(
    path: String,
    url: String,
    sub_path: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let args = add_args(&url, &sub_path)?;
    state.git.run(&PathBuf::from(&path), args).await?;
    Ok(())
}

fn add_args(url: &str, sub_path: &str) -> AppResult<Vec<String>> {
    let url = validate_url(url)?;
    let sub_path = validate_sub_path(sub_path)?;
    Ok(vec![
        "submodule".into(),
        "add".into(),
        "--".into(),
        url.into(),
        sub_path.into(),
    ])
}

/// Accepts a remote URL or a local path. Git reads a leading '-' as an option,
/// and a control character has no place in a URL.
fn validate_url(url: &str) -> AppResult<&str> {
    if url.is_empty() || url.starts_with('-') || url.chars().any(char::is_control) {
        return Err(AppError::Other(format!(
            "submodule URL {url:?} is invalid: expected a non-empty repository URL or path that does not start with '-'"
        )));
    }
    Ok(url)
}

/// Accepts a path that stays inside the repo: relative, no drive or URL colon,
/// no `.` / `..` / empty segment, no leading '-'.
fn validate_sub_path(sub_path: &str) -> AppResult<&str> {
    let bad = |why: &str| {
        AppError::Other(format!(
            "submodule path {sub_path:?} is invalid ({why}): expected a relative path inside the repository"
        ))
    };
    if sub_path.is_empty() || sub_path.starts_with('-') {
        return Err(bad("empty or starts with '-'"));
    }
    if sub_path.starts_with('/') || sub_path.starts_with('\\') || sub_path.contains(':') {
        return Err(bad("absolute or contains ':'"));
    }
    if sub_path.chars().any(char::is_control) {
        return Err(bad("contains a control character"));
    }
    if sub_path.split(['/', '\\']).any(|seg| matches!(seg, "" | "." | "..")) {
        return Err(bad("contains an empty, '.' or '..' segment"));
    }
    Ok(sub_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_url_accepts_remote_and_local_paths() {
        assert_eq!(validate_url("https://github.com/a/b.git").unwrap(), "https://github.com/a/b.git");
        assert_eq!(validate_url(r"C:\Repos\My Lib").unwrap(), r"C:\Repos\My Lib");
        assert_eq!(validate_url("../lib").unwrap(), "../lib");
    }

    #[test]
    fn validate_url_rejects_option_like_empty_and_control_input() {
        assert!(validate_url("").is_err());
        assert!(validate_url("--upload-pack=evil").is_err());
        assert!(validate_url("https://x\ny").is_err());
    }

    #[test]
    fn validate_sub_path_accepts_nested_relative_paths() {
        assert_eq!(validate_sub_path("libs/foo").unwrap(), "libs/foo");
        assert_eq!(validate_sub_path(r"libs\foo").unwrap(), r"libs\foo");
    }

    #[test]
    fn validate_sub_path_rejects_escapes_and_absolute_paths() {
        assert!(validate_sub_path("../outside").is_err());
        assert!(validate_sub_path("a/../../b").is_err());
        assert!(validate_sub_path("/etc/passwd").is_err());
        assert!(validate_sub_path(r"\\server\share").is_err());
        assert!(validate_sub_path("C:/x").is_err());
    }

    #[test]
    fn validate_sub_path_rejects_empty_dot_and_option_like_input() {
        assert!(validate_sub_path("").is_err());
        assert!(validate_sub_path("./lib").is_err());
        assert!(validate_sub_path("lib//x").is_err());
        assert!(validate_sub_path("-rf").is_err());
    }

    #[test]
    fn update_args_plain_update_of_all_submodules() {
        let got = update_args(None, false, false).unwrap();
        assert_eq!(got, ["submodule", "update"]);
    }

    #[test]
    fn update_args_init_recursive_single_path() {
        let got = update_args(Some("libs/foo"), true, true).unwrap();
        assert_eq!(got, ["submodule", "update", "--init", "--recursive", "--", "libs/foo"]);
    }

    #[test]
    fn update_args_refuses_an_escaping_path() {
        assert!(update_args(Some("../x"), true, false).is_err());
    }

    #[test]
    fn add_args_puts_double_dash_before_url_and_path() {
        let got = add_args("https://x/foo.git", "libs/foo").unwrap();
        assert_eq!(got, ["submodule", "add", "--", "https://x/foo.git", "libs/foo"]);
    }

    #[test]
    fn add_args_refuses_bad_url_or_path() {
        assert!(add_args("--evil", "libs/foo").is_err());
        assert!(add_args("https://x/foo.git", "../escape").is_err());
    }

    #[test]
    fn status_args_limit_status_to_the_submodule_paths() {
        let got = status_args(&["libs/foo", "libs/bar"]);
        assert_eq!(&got[..6], [
            "--literal-pathspecs", "status", "--porcelain=v2", "-z", "--ignore-submodules=none", "--",
        ]);
        assert_eq!(&got[6..], ["libs/foo", "libs/bar"]);
    }
}
