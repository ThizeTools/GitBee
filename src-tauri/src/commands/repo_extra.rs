use crate::commands::git_progress::{run_reporting, GitOp};
use crate::commands::remotes::checked_remote_url;
use crate::error::{AppError, AppResult};
use crate::git::checked_ref;
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

/// Clone options from the clone dialog. `None` and `false` mean git's default.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct CloneOpts {
    pub depth: Option<u32>,
    pub branch: Option<String>,
    pub single_branch: bool,
}

/// Folder name git gives a clone: the last URL segment without `.git`.
/// Handles both `https://host/o/r.git` and scp-style `git@host:o/r.git`.
pub fn clone_dir_name(url: &str) -> String {
    url.rsplit(['/', ':'])
        .next()
        .unwrap_or("repo")
        .trim_end_matches(".git")
        .to_string()
}

/// Args for one clone with progress. The URL is checked for a leading '-', and
/// `--` ends option parsing before it, so no URL can be read as a flag. The
/// branch goes through `checked_ref` for the same reason.
pub fn clone_args(url: &str, target: &str, opts: &CloneOpts) -> AppResult<Vec<String>> {
    let mut args: Vec<String> = vec!["clone".into(), "--progress".into()];
    args.extend(clone_option_args(opts)?);
    args.push("--".into());
    args.push(checked_remote_url(url)?.into());
    args.push(target.into());
    Ok(args)
}

/// `--depth`, `--branch` and `--single-branch`, in that order. An empty branch
/// name means none, because the dialog sends "" for an unset field.
fn clone_option_args(opts: &CloneOpts) -> AppResult<Vec<String>> {
    let mut args: Vec<String> = Vec::new();
    if let Some(depth) = opts.depth {
        if depth == 0 {
            return Err(AppError::Other("clone depth must be at least 1, got 0".into()));
        }
        args.extend(["--depth".into(), depth.to_string()]);
    }
    if let Some(branch) = opts.branch.as_deref().filter(|b| !b.is_empty()) {
        args.extend(["--branch".into(), checked_ref(branch)?.into()]);
    }
    if opts.single_branch {
        args.push("--single-branch".into());
    }
    Ok(args)
}

/// Clones `url` into `dest/<name>`. Input is checked before anything touches
/// the disk, so a refused URL or option leaves no folder behind. Progress goes
/// out as `git-progress` events keyed by the target folder (docs/specs/git-progress.md).
#[tauri::command]
pub async fn repo_clone(
    url: String,
    dest: String,
    depth: Option<u32>,
    branch: Option<String>,
    single_branch: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let dest_pb = PathBuf::from(&dest);
    let target = dest_pb.join(clone_dir_name(&url));
    let target_str = target.to_string_lossy().into_owned();
    let opts = CloneOpts { depth, branch, single_branch };
    let args = clone_args(&url, &target_str, &opts)?;
    if !dest_pb.exists() {
        tokio::fs::create_dir_all(&dest_pb).await?;
    }
    if target.exists() {
        return Err(AppError::Other(format!("target already exists: {}", target.display())));
    }
    run_reporting(&app, &state.git, &dest_pb, &target_str, GitOp::Clone, args).await?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn full_opts() -> CloneOpts {
        CloneOpts { depth: Some(1), branch: Some("main".into()), single_branch: true }
    }

    #[test]
    fn dir_name_drops_git_suffix_for_https_and_scp_urls() {
        assert_eq!(clone_dir_name("https://github.com/o/repo.git"), "repo");
        assert_eq!(clone_dir_name("git@github.com:o/repo.git"), "repo");
        assert_eq!(clone_dir_name("https://github.com/o/repo"), "repo");
    }

    #[test]
    fn default_options_give_a_plain_clone_after_double_dash() {
        let args = clone_args("https://x/o/r.git", "/d/r", &CloneOpts::default()).unwrap();
        assert_eq!(args, ["clone", "--progress", "--", "https://x/o/r.git", "/d/r"]);
    }

    #[test]
    fn shallow_and_single_branch_options_map_to_git_flags() {
        let args = clone_args("https://x/o/r.git", "/d/r", &full_opts()).unwrap();
        assert_eq!(
            args,
            [
                "clone", "--progress", "--depth", "1", "--branch", "main", "--single-branch",
                "--", "https://x/o/r.git", "/d/r",
            ],
        );
    }

    #[test]
    fn an_empty_branch_name_adds_no_branch_flag() {
        let opts = CloneOpts { depth: None, branch: Some(String::new()), single_branch: false };
        let args = clone_args("https://x/o/r.git", "/d/r", &opts).unwrap();
        assert!(!args.iter().any(|a| a == "--branch"));
    }

    #[test]
    fn a_url_starting_with_a_dash_is_refused_before_git_runs() {
        let err = clone_args("--upload-pack=touch /tmp/x", "/d/r", &CloneOpts::default())
            .unwrap_err()
            .to_string();
        assert!(err.contains("--upload-pack=touch /tmp/x"), "unexpected message: {err}");
    }

    #[test]
    fn a_branch_starting_with_a_dash_is_refused() {
        let opts = CloneOpts { depth: None, branch: Some("--evil".into()), single_branch: false };
        assert!(clone_args("https://x/o/r.git", "/d/r", &opts).is_err());
    }

    #[test]
    fn depth_zero_is_refused_because_git_has_no_such_clone() {
        let opts = CloneOpts { depth: Some(0), branch: None, single_branch: false };
        let err = clone_args("https://x/o/r.git", "/d/r", &opts).unwrap_err().to_string();
        assert!(err.contains("at least 1"), "unexpected message: {err}");
    }
}
