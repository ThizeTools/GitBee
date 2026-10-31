//! Tauri commands for pull requests (`docs/specs/github-pull-requests.md`).
//! The GitHub commands are one `github::pulls` call each, run through
//! `commands::github::with_api`. `pr_checkout` runs git and is the only one
//! that touches the repository.

use crate::commands::github::with_api;
use crate::error::AppResult;
use crate::git::GitRunner;
use crate::github::pull_parse::checked_branch_name;
use crate::github::pull_types::{MergeMethod, NewPull, PullDetail, PullRow, ReviewEvent};
use crate::github::pulls;
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::State;

#[tauri::command]
pub async fn github_list_pulls(
    owner: String,
    repo: String,
    pr_state: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<PullRow>> {
    with_api(&state, |api| async move {
        pulls::list_pulls(&api, &owner, &repo, &pr_state).await
    }).await
}

#[tauri::command]
pub async fn github_pull_detail(
    owner: String,
    repo: String,
    number: u64,
    state: State<'_, AppState>,
) -> AppResult<PullDetail> {
    with_api(&state, |api| async move {
        pulls::load_detail(&api, &owner, &repo, number).await
    }).await
}

#[tauri::command]
pub async fn github_merge_pull(
    owner: String,
    repo: String,
    number: u64,
    method: MergeMethod,
    state: State<'_, AppState>,
) -> AppResult<String> {
    with_api(&state, |api| async move {
        pulls::merge_pull(&api, &owner, &repo, number, method).await
    }).await
}

#[tauri::command]
pub async fn github_review_pull(
    owner: String,
    repo: String,
    number: u64,
    event: ReviewEvent,
    body: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    with_api(&state, |api| async move {
        pulls::submit_review(&api, &owner, &repo, number, event, &body).await
    }).await
}

#[tauri::command]
pub async fn github_create_pull(
    owner: String,
    repo: String,
    req: NewPull,
    state: State<'_, AppState>,
) -> AppResult<PullRow> {
    with_api(&state, |api| async move {
        pulls::create_pull(&api, &owner, &repo, &req).await
    }).await
}

#[tauri::command]
pub async fn github_branch_on_remote(
    owner: String,
    repo: String,
    branch: String,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    with_api(&state, |api| async move {
        pulls::branch_on_remote(&api, &owner, &repo, &branch).await
    }).await
}

/// Checks out a PR's head branch in the repo at `path`. Same-repo PRs check
/// out the branch from origin. Fork PRs fetch `refs/pull/<n>/head` into a
/// local `pr/<n>` branch. Spec: docs/specs/github-pull-requests.md, "Checkout".
#[tauri::command]
pub async fn pr_checkout(
    path: String,
    number: u64,
    head_ref: String,
    same_repo: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let cwd = PathBuf::from(&path);
    if same_repo {
        checkout_same_repo(&state.git, &cwd, &head_ref).await
    } else {
        checkout_fork(&state.git, &cwd, number).await
    }
}

/// Local branch that holds a fork PR's head.
pub fn fork_branch(number: u64) -> String {
    format!("pr/{number}")
}

/// `git fetch` arguments for a fork PR. The `+` lets a force-pushed PR move
/// its local branch. GitHub keeps every PR head at `refs/pull/<n>/head`, even
/// when the fork was deleted.
pub fn fork_fetch_args(number: u64) -> Vec<String> {
    vec![
        "fetch".into(),
        "origin".into(),
        format!("+refs/pull/{number}/head:refs/heads/{}", fork_branch(number)),
    ]
}

/// Remote-tracking ref of a branch on origin.
pub fn remote_tracking(branch: &str) -> String {
    format!("refs/remotes/origin/{branch}")
}

/// `git fetch` arguments that update origin's branch in its tracking ref.
pub fn same_repo_fetch_args(branch: &str) -> Vec<String> {
    vec![
        "fetch".into(),
        "origin".into(),
        format!("+refs/heads/{branch}:{}", remote_tracking(branch)),
    ]
}

async fn checkout_fork(git: &GitRunner, cwd: &Path, number: u64) -> AppResult<()> {
    git.run(cwd, fork_fetch_args(number)).await?;
    let local = fork_branch(number);
    git.run(cwd, ["checkout", local.as_str()]).await?;
    Ok(())
}

/// Fetches origin's branch, then either fast-forwards the local branch of the
/// same name or creates it tracking origin. A local branch that has diverged
/// makes the fast-forward fail, and git's message reaches the user.
async fn checkout_same_repo(git: &GitRunner, cwd: &Path, head: &str) -> AppResult<()> {
    let head = checked_branch_name(head)?;
    git.run(cwd, same_repo_fetch_args(head)).await?;
    let tracking = remote_tracking(head);
    if local_branch_exists(git, cwd, head).await {
        git.run(cwd, ["checkout", head]).await?;
        git.run(cwd, ["merge", "--ff-only", tracking.as_str()]).await?;
    } else {
        git.run(cwd, ["checkout", "--track", "-b", head, tracking.as_str()]).await?;
    }
    Ok(())
}

async fn local_branch_exists(git: &GitRunner, cwd: &Path, branch: &str) -> bool {
    let full = format!("refs/heads/{branch}");
    git.run(cwd, ["rev-parse", "--verify", "--quiet", full.as_str()]).await.is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fork_branch_is_pr_slash_number() {
        assert_eq!(fork_branch(42), "pr/42");
    }

    #[test]
    fn fork_fetch_reads_the_pull_head_into_the_local_branch() {
        assert_eq!(
            fork_fetch_args(42),
            vec!["fetch", "origin", "+refs/pull/42/head:refs/heads/pr/42"],
        );
    }

    #[test]
    fn same_repo_fetch_updates_the_tracking_ref() {
        assert_eq!(
            same_repo_fetch_args("feature/login"),
            vec!["fetch", "origin", "+refs/heads/feature/login:refs/remotes/origin/feature/login"],
        );
    }

    #[test]
    fn remote_tracking_names_origin_refs() {
        assert_eq!(remote_tracking("main"), "refs/remotes/origin/main");
    }

    /// A bare `origin` with one branch and one fork-style PR ref, plus a
    /// working clone that has no local copy of either. Removed on drop.
    struct Remote {
        root: PathBuf,
        work: PathBuf,
        git: GitRunner,
    }

    impl Remote {
        async fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let root = std::env::temp_dir()
                .join(format!("gitbee-pr-{tag}-{}-{nanos}", std::process::id()));
            let origin = root.join("origin.git");
            let work = root.join("work");
            std::fs::create_dir_all(&work).unwrap();
            let git = GitRunner::discover().unwrap();
            let r = Self { root, work, git };
            r.run(&r.root, ["init", "--bare", origin.to_str().unwrap()]).await;
            r.run(&r.work, ["init"]).await;
            r.run(&r.work, ["remote", "add", "origin", origin.to_str().unwrap()]).await;
            // Point the unborn HEAD at feature; `checkout -b` is not reliable on an unborn branch.
            r.run(&r.work, ["symbolic-ref", "HEAD", "refs/heads/feature"]).await;
            r.commit("feature work").await;
            r.run(&r.work, ["push", "origin", "HEAD:refs/heads/feature"]).await;
            r.run(&r.work, ["push", "origin", "HEAD:refs/pull/7/head"]).await;
            r.run(&r.work, ["checkout", "--detach"]).await;
            r.run(&r.work, ["branch", "-D", "feature"]).await;
            r
        }

        async fn run<const N: usize>(&self, dir: &Path, args: [&str; N]) {
            self.git.run(dir, args).await.unwrap();
        }

        async fn commit(&self, message: &str) {
            self.git.run(&self.work, [
                "-c", "user.name=GitBee", "-c", "user.email=test@example.com",
                "commit", "--allow-empty", "-m", message,
            ]).await.unwrap();
        }

        async fn current_branch(&self) -> String {
            let out = self.git.run_text(&self.work, ["rev-parse", "--abbrev-ref", "HEAD"])
                .await.unwrap();
            out.trim().to_string()
        }
    }

    impl Drop for Remote {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[tokio::test]
    async fn same_repo_checkout_creates_a_tracking_branch_from_origin() {
        let remote = Remote::new("same").await;
        checkout_same_repo(&remote.git, &remote.work, "feature").await.unwrap();
        assert_eq!(remote.current_branch().await, "feature");
    }

    #[tokio::test]
    async fn same_repo_checkout_reuses_an_existing_local_branch() {
        let remote = Remote::new("reuse").await;
        checkout_same_repo(&remote.git, &remote.work, "feature").await.unwrap();
        remote.run(&remote.work, ["checkout", "--detach"]).await;
        checkout_same_repo(&remote.git, &remote.work, "feature").await.unwrap();
        assert_eq!(remote.current_branch().await, "feature");
    }

    #[tokio::test]
    async fn fork_checkout_fetches_the_pull_head_into_pr_branch() {
        let remote = Remote::new("fork").await;
        checkout_fork(&remote.git, &remote.work, 7).await.unwrap();
        assert_eq!(remote.current_branch().await, "pr/7");
    }
}
