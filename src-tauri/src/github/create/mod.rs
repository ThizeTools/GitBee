//! Create a new repository on github.com (`POST /user/repos` or
//! `POST /orgs/{org}/repos`) and push an initial commit. Used by the
//! "Create on GitHub" and "Publish to GitHub" entry points. See
//! `docs/specs/github-create-repo.md`.

mod push;
mod remote;
mod validate;

pub use remote::{check_name_available, list_create_owners};
pub use validate::validate_name;

use crate::error::{AppError, AppResult};
use crate::git::GitRunner;
use crate::github::api;
use crate::github::types::{CreateRepoReq, GhRepoCreated};
use push::push_initial;
use remote::create_remote_repo;

/// "Create on GitHub" path: API create + local init/clone + push.
pub async fn create_on_github(
    git: &GitRunner,
    token: &str,
    req: CreateRepoReq,
) -> AppResult<GhRepoCreated> {
    validate_name(&req.name)?;
    let user = api::fetch_user(token).await?;
    let owner_is_user = req.owner == user.login;

    // Resolve destination folder before talking to GitHub so a bad path
    // doesn't leave an orphan repo behind.
    let dest = req.dest_folder.clone().ok_or_else(|| {
        AppError::Other("dest_folder required for create-on-github".into())
    })?;
    let dest_pb = std::path::PathBuf::from(&dest);
    if !dest_pb.exists() {
        tokio::fs::create_dir_all(&dest_pb).await?;
    }
    let target = dest_pb.join(&req.name);
    if target.exists() {
        return Err(AppError::Other(format!(
            "target already exists: {}",
            target.display()
        )));
    }

    let api_resp = create_remote_repo(token, &req, owner_is_user, &user.login).await?;

    if req.auto_init {
        // GitHub seeded the repo with a README. Clone it down — same
        // token-stripping cleanup as `github_clone`.
        let auth_url = api::authed_clone_url(&api_resp.clone_url, token);
        git.run(
            &dest_pb,
            [
                "-c", "credential.helper=",
                "-c", "credential.useHttpPath=true",
                "clone", &auth_url, target.to_string_lossy().as_ref(),
            ],
        )
        .await?;
        let _ = git.run(&target, ["remote", "set-url", "origin", &api_resp.clone_url]).await;
    } else {
        // Empty repo on GitHub — init locally, make an initial commit
        // if there's something to commit, push.
        tokio::fs::create_dir_all(&target).await?;
        git.run(&target, ["init", "-b", &api_resp.default_branch]).await?;
        // Stage anything in the folder. If the folder is empty this
        // produces nothing; commit will fail and we skip the push (the
        // GitHub repo stays empty, ready for the user's first push).
        let _ = git.run(&target, ["add", "-A"]).await;
        let has_changes = git
            .run(&target, ["diff", "--cached", "--quiet"])
            .await
            .is_err();
        if has_changes {
            git.run(
                &target,
                ["commit", "-m", &format!("Initial commit for {}/{}", req.owner, req.name)],
            )
            .await?;
            push_initial(git, &target, &api_resp.default_branch, &api_resp.clone_url, token).await?;
        } else {
            // No local content; just wire up origin so the next user
            // push works.
            git.run(&target, ["remote", "add", "origin", &api_resp.clone_url]).await?;
        }
    }

    Ok(GhRepoCreated {
        clone_url: api_resp.clone_url,
        ssh_url: api_resp.ssh_url,
        html_url: api_resp.html_url,
        default_branch: api_resp.default_branch,
        local_path: target.to_string_lossy().into_owned(),
    })
}

/// "Publish to GitHub" path: existing local repo with no `origin`.
/// Creates the GitHub repo, wires up the remote, pushes the current
/// branch.
pub async fn publish_local(
    git: &GitRunner,
    token: &str,
    repo_path: String,
    mut req: CreateRepoReq,
) -> AppResult<GhRepoCreated> {
    validate_name(&req.name)?;
    req.auto_init = false; // never auto-init when we already have content
    req.dest_folder = None;

    let user = api::fetch_user(token).await?;
    let owner_is_user = req.owner == user.login;

    let repo_pb = std::path::PathBuf::from(&repo_path);
    if !git.is_repository(&repo_pb).await {
        return Err(AppError::InvalidRepoPath(repo_path));
    }

    // Refuse if origin is already configured. The frontend handles the
    // overwrite confirmation and re-calls if the user agrees (v2:
    // explicit overwrite flag — for v1 the user removes it manually).
    let remotes = git
        .run_text(&repo_pb, ["remote"])
        .await
        .unwrap_or_default();
    if remotes.lines().any(|l| l.trim() == "origin") {
        let url = git
            .run_text(&repo_pb, ["remote", "get-url", "origin"])
            .await
            .unwrap_or_default();
        return Err(AppError::GitHub(format!(
            "REMOTE_EXISTS: 'origin' already configured at {}",
            url.trim()
        )));
    }

    let api_resp = create_remote_repo(token, &req, owner_is_user, &user.login).await?;

    // Wire up origin. We push using an auth URL directly, then rewrite
    // — same token-strip pattern as create_on_github.
    git.run(&repo_pb, ["remote", "add", "origin", &api_resp.clone_url]).await?;

    // If the repo has no commits yet, make one so push has something
    // to send. Otherwise the push will fail with "src refspec does not
    // match any" and confuse the user.
    let has_head = git.run(&repo_pb, ["rev-parse", "--verify", "HEAD"]).await.is_ok();
    if !has_head {
        let _ = git.run(&repo_pb, ["add", "-A"]).await;
        let _ = git
            .run(
                &repo_pb,
                ["commit", "--allow-empty", "-m", "Initial commit"],
            )
            .await;
    }

    // Resolve the *actual* current branch after we know HEAD exists.
    // `git init` on Windows still defaults to `master` unless
    // `init.defaultBranch` is set, so a fresh repo will have committed
    // on `master` even though the user asked for `main` on GitHub.
    // Rename it to the requested default branch with `branch -M` so
    // the push refspec matches what we just created remotely.
    let current_branch = git
        .run_text(&repo_pb, ["rev-parse", "--abbrev-ref", "HEAD"])
        .await
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != "HEAD")
        .unwrap_or_else(|| api_resp.default_branch.clone());
    if current_branch != api_resp.default_branch {
        // -M is force-rename; safe because there's only one branch on a
        // freshly-initialized repo, and renaming a non-default branch
        // to match the remote default is exactly what the user asked
        // for via the modal.
        git.run(&repo_pb, ["branch", "-M", &api_resp.default_branch]).await?;
    }
    let head_branch = api_resp.default_branch.clone();

    push_initial(git, &repo_pb, &head_branch, &api_resp.clone_url, token).await?;

    Ok(GhRepoCreated {
        clone_url: api_resp.clone_url,
        ssh_url: api_resp.ssh_url,
        html_url: api_resp.html_url,
        default_branch: api_resp.default_branch,
        local_path: repo_path,
    })
}
