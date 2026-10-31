use crate::error::{AppError, AppResult};
use crate::git::GitRunner;
use crate::github::api;
use std::path::Path;

/// Strip the trailing slashes and return the embedded host+path so we
/// can rewrite `.git/config` after a token-bearing push.
fn clean_https_url(clone_url: &str) -> String {
    clone_url.to_string()
}

/// Compare local HEAD to the remote tip of `branch` via `ls-remote`.
/// Used to recover from a push that returned HTTP 408 / disconnect
/// after the pack already reached GitHub: if the remote SHA matches
/// our local SHA the operation actually succeeded and we shouldn't
/// surface the transport error to the user.
async fn push_succeeded_via_verify(
    git: &GitRunner,
    repo_path: &Path,
    branch: &str,
    auth_url: &str,
) -> bool {
    let local = match git
        .run_text(repo_path, ["rev-parse", "HEAD"])
        .await
    {
        Ok(s) => s.trim().to_string(),
        Err(_) => return false,
    };
    if local.is_empty() { return false; }
    let remote = match git
        .run_text(
            repo_path,
            [
                "-c", "credential.helper=",
                "ls-remote", auth_url,
                &format!("refs/heads/{branch}"),
            ],
        )
        .await
    {
        Ok(s) => s,
        Err(_) => return false,
    };
    remote
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().next())
        .map(|sha| sha == local)
        .unwrap_or(false)
}

/// Push the local repo at `repo_path` to `clone_url` on `branch`. The
/// token is injected inline (`x-access-token:<token>@…`) and the
/// credential helper is disabled so the URL never lands in
/// `.git/config` or the OS credential store. After the push, the saved
/// remote is rewritten to the clean URL.
pub(super) async fn push_initial(
    git: &GitRunner,
    repo_path: &Path,
    branch: &str,
    clone_url: &str,
    token: &str,
) -> AppResult<()> {
    let auth_url = api::authed_clone_url(clone_url, token);
    // Caller already added `origin` pointing at the clean URL. We need
    // the push to record `branch.<name>.remote=origin` so subsequent
    // `git push` works without `--set-upstream`, but the actual transfer
    // needs the token-bearing URL. Solution: temporarily flip origin to
    // the auth URL, push `-u origin branch` (this sets upstream to
    // origin/<branch>, not to the anonymous URL), then flip origin back
    // to the clean URL. The token never lands in `.git/config`
    // permanently — only during the brief push window — and the user
    // gets a fully-tracked branch out of the box.
    let _ = git.run(repo_path, ["remote", "set-url", "origin", &auth_url]).await;
    // Bump http.postBuffer and disable the slow-speed timeout so flaky
    // connections don't trip a 408 from the GitHub edge before the pack
    // finishes uploading. Retry once on transient HTTP errors and
    // verify the server actually has our SHA before declaring failure
    // — git sometimes reports HTTP 408 even when the pack landed (the
    // disconnect happens after the server has already accepted the
    // data).
    let push_args = [
        "-c", "credential.helper=",
        "-c", "credential.useHttpPath=true",
        "-c", "http.postBuffer=524288000",
        "-c", "http.lowSpeedLimit=0",
        "-c", "http.lowSpeedTime=999999",
        "push", "-u", "origin", branch,
    ];
    let mut push_res = git.run(repo_path, push_args).await;
    if let Err(e) = &push_res {
        let msg = e.to_string();
        let transient = msg.contains("HTTP 408")
            || msg.contains("HTTP 502")
            || msg.contains("HTTP 503")
            || msg.contains("HTTP 504")
            || msg.contains("RPC failed")
            || msg.contains("hung up")
            || msg.contains("unexpected disconnect");
        if transient {
            tracing::warn!("push transient failure, retrying once: {msg}");
            push_res = git.run(repo_path, push_args).await;
        }
    }
    if let Err(e) = push_res {
        let msg = e.to_string();
        // Verify FIRST — a 408 at the end of a large push often means
        // the data + ref-update made it to GitHub but the response
        // timed out. The retry then sees the ref already at our SHA
        // and reports `! [rejected] <branch> -> <branch> (fetch first)`
        // even though the work is done. Comparing local HEAD with the
        // remote ref disambiguates: if they match, push succeeded and
        // any client-side error (408, RPC, "rejected") is benign.
        if push_succeeded_via_verify(git, repo_path, branch, &auth_url).await {
            tracing::warn!("push reported error but ref already matches remote; treating as success: {msg}");
            // Make sure tracking gets recorded even when the push
            // itself returned non-zero — the user opened the modal
            // expecting `git push` to work without `--set-upstream`
            // afterward, and a 408-recovered push without -u side
            // effects would leave the branch un-tracked.
            let _ = git
                .run(
                    repo_path,
                    ["branch", "--set-upstream-to", &format!("origin/{branch}"), branch],
                )
                .await;
        } else if msg.contains("rejected") || msg.contains("non-fast-forward") {
            // Restore the clean origin URL before bailing — the auth
            // URL was set as a transient measure to make `push -u
            // origin` record upstream correctly, and we don't want the
            // token persisted on disk.
            let _ = git.run(repo_path, ["remote", "set-url", "origin", clone_url]).await;
            return Err(AppError::GitHub(format!(
                "PUSH_REJECTED: remote '{}' has commits the local branch lacks; pull --rebase and retry",
                clean_https_url(clone_url)
            )));
        } else {
            // Restore clean origin URL even on failure so a token never
            // sits in .git/config waiting for the next operation.
            let _ = git.run(repo_path, ["remote", "set-url", "origin", clone_url]).await;
            return Err(e);
        }
    }
    // The push above used the auth URL inline, so origin's tracking is
    // pointing at it. Re-set the remote URL to the clean form so future
    // operations don't carry the token.
    let _ = git.run(repo_path, ["remote", "set-url", "origin", clone_url]).await;
    // Best-effort: clear any stale x-access-token entry from credential
    // managers (matches the cleanup in github_clone).
    let reject_input = b"protocol=https\nhost=github.com\nusername=x-access-token\n\n";
    let _ = git
        .run_with_stdin(repo_path, ["credential", "reject"], reject_input)
        .await;
    Ok(())
}
