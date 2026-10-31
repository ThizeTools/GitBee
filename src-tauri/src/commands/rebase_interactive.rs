//! Interactive rebase from a commit: the rebase editor's list becomes a todo,
//! and `git rebase -i` replays it with that todo. The pure rules are in
//! `rebase_todo.rs`. Spec: docs/specs/interactive-rebase.md.

use super::rebase_todo::{
    build_todo, listed_shas_match, message_file, message_writes, sequence_editor_command,
    sh_path, validate_items, RebaseItem,
};
use crate::error::{AppError, AppResult};
use crate::git::runner::NO_EDITOR_ENV;
use crate::git::{checked_ref, GitRunner};
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

fn cwd(path: &str) -> PathBuf { PathBuf::from(path) }

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RebaseStatus {
    Done,
    /// Git stopped on a conflict or a failed amend. The rebase is still in
    /// progress and the existing continue/abort flow takes over.
    Stopped,
}

#[derive(Debug, Serialize)]
pub struct RebaseOutcome {
    pub status: RebaseStatus,
    pub message: String,
    /// HEAD before the rebase. The undo entry resets back to it.
    pub before: String,
    /// HEAD after a finished rebase; null when it stopped.
    pub after: Option<String>,
}

#[tauri::command]
pub async fn rebase_interactive(
    path: String,
    base: String,
    items: Vec<RebaseItem>,
    state: State<'_, AppState>,
) -> AppResult<RebaseOutcome> {
    let temp = std::env::temp_dir();
    run_interactive(&state.git, &cwd(&path), &base, &items, &temp).await
}

/// Replays `items` (oldest first) on top of `base`. `runs_root` holds this
/// run's todo and message files; production passes the system temp dir and
/// tests pass a scratch dir. Refusals happen before any file is written.
pub async fn run_interactive(
    git: &GitRunner,
    repo: &Path,
    base: &str,
    items: &[RebaseItem],
    runs_root: &Path,
) -> AppResult<RebaseOutcome> {
    validate_items(items)?;
    checked_ref(base)?;
    refuse_if_rebasing(git, repo).await?;
    refuse_dirty(git, repo).await?;
    check_range(git, repo, base, items).await?;
    let before = head_sha(git, repo).await?;
    let dir = new_run_dir(runs_root)?;
    let result = replay(git, repo, base, items, &dir).await;
    settle(git, repo, before, items.len(), &dir, result).await
}

async fn replay(
    git: &GitRunner,
    repo: &Path,
    base: &str,
    items: &[RebaseItem],
    dir: &Path,
) -> AppResult<()> {
    let todo = write_run_files(git, dir, items)?;
    let sequence = sequence_editor_command(&todo);
    // WHY: GIT_SEQUENCE_EDITOR replaces git's todo editor with our copy, and
    // NO_EDITOR_ENV keeps any squash message prompt from opening an editor.
    let envs = [("GIT_SEQUENCE_EDITOR", sequence.as_str()), NO_EDITOR_ENV];
    git.run_with_env(repo, ["rebase", "-i", base], &envs).await?;
    Ok(())
}

/// Writes the message files and the todo into `dir`. Returns the todo path
/// as sh reads it. Every path in the todo goes through `sh_path`.
fn write_run_files(git: &GitRunner, dir: &Path, items: &[RebaseItem]) -> AppResult<String> {
    let dir_text = sh_path(dir)?;
    for (index, text) in message_writes(items) {
        std::fs::write(message_file(&dir_text, index), text)?;
    }
    let exe = sh_path(git.executable())?;
    let todo_text = build_todo(items, &dir_text, &exe);
    let todo = format!("{dir_text}/todo.txt");
    std::fs::write(&todo, todo_text)?;
    Ok(todo)
}

/// Turns the git result into the outcome. A failed git call with the rebase
/// state still on disk is a stop, not an error. Its run folder stays, because
/// the amend lines in the todo still read the message files.
async fn settle(
    git: &GitRunner,
    repo: &Path,
    before: String,
    count: usize,
    dir: &Path,
    result: AppResult<()>,
) -> AppResult<RebaseOutcome> {
    match result {
        Ok(()) => finished(git, repo, before, count, dir).await,
        Err(err) => {
            let stopped = matches!(err, AppError::GitFailed { .. })
                && rebase_in_progress(git, repo).await?;
            if stopped {
                return Ok(stopped_outcome(before, err));
            }
            remove_run_dir(dir);
            Err(err)
        }
    }
}

async fn finished(
    git: &GitRunner,
    repo: &Path,
    before: String,
    count: usize,
    dir: &Path,
) -> AppResult<RebaseOutcome> {
    remove_run_dir(dir);
    let after = head_sha(git, repo).await?;
    Ok(RebaseOutcome {
        status: RebaseStatus::Done,
        message: format!("Rebased {count} commit(s)"),
        before,
        after: Some(after),
    })
}

fn stopped_outcome(before: String, err: AppError) -> RebaseOutcome {
    let detail = err.to_string();
    RebaseOutcome {
        status: RebaseStatus::Stopped,
        message: format!(
            "The rebase stopped and waits for you. Resolve the conflicts, then continue or abort it.\n{}",
            detail.trim()
        ),
        before,
        after: None,
    }
}

async fn refuse_if_rebasing(git: &GitRunner, repo: &Path) -> AppResult<()> {
    if rebase_in_progress(git, repo).await? {
        return Err(AppError::Other(
            "a rebase is already in progress; continue or abort it first".into(),
        ));
    }
    Ok(())
}

/// WHY tracked files only: git rebase refuses on staged or unstaged changes
/// to tracked files, but not on untracked ones, and reset --hard (the undo)
/// leaves untracked files alone too.
async fn refuse_dirty(git: &GitRunner, repo: &Path) -> AppResult<()> {
    let text = git
        .run_text(repo, ["status", "--porcelain", "--untracked-files=no"])
        .await?;
    let changed = text.lines().count();
    if changed == 0 {
        return Ok(());
    }
    Err(AppError::Other(format!(
        "Commit or stash your changes first: {changed} tracked file(s) have changes"
    )))
}

/// Checks the commits of `base..HEAD` against the list: no merge commits, and
/// exactly the listed commits. The second check catches a history that moved
/// after the list was opened.
async fn check_range(git: &GitRunner, repo: &Path, base: &str, items: &[RebaseItem]) -> AppResult<()> {
    let range = format!("{base}..HEAD");
    check_no_merges(git, repo, &range).await?;
    let listed = git.run_text(repo, ["rev-list", range.as_str()]).await?;
    let shas: Vec<&str> = listed.lines().collect();
    if listed_shas_match(&shas, items) {
        return Ok(());
    }
    Err(AppError::Other(format!(
        "the commits in {range} changed since the list was opened: git lists {}, the editor sent {}; reopen the rebase editor",
        shas.len(),
        items.len()
    )))
}

async fn check_no_merges(git: &GitRunner, repo: &Path, range: &str) -> AppResult<()> {
    let merges = git.run_text(repo, ["rev-list", "--merges", range]).await?;
    match merges.lines().next() {
        None => Ok(()),
        Some(merge) => Err(AppError::Other(format!(
            "the range {range} contains merge commit {}; interactive rebase cannot replay merges",
            merge.get(..7).unwrap_or(merge)
        ))),
    }
}

async fn head_sha(git: &GitRunner, repo: &Path) -> AppResult<String> {
    let text = git.run_text(repo, ["rev-parse", "HEAD"]).await?;
    Ok(text.trim().to_string())
}

async fn git_dir(git: &GitRunner, repo: &Path) -> AppResult<PathBuf> {
    let text = git.run_text(repo, ["rev-parse", "--git-dir"]).await?;
    Ok(repo.join(text.trim()))
}

async fn rebase_in_progress(git: &GitRunner, repo: &Path) -> AppResult<bool> {
    let dir = git_dir(git, repo).await?;
    Ok(dir.join("rebase-merge").exists() || dir.join("rebase-apply").exists())
}

/// Makes a fresh folder for this run. The name carries the pid and a
/// nanosecond stamp, so two runs never share a folder.
fn new_run_dir(runs_root: &Path) -> AppResult<PathBuf> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = runs_root.join(format!("gitbee-rebase-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// A failed removal only leaves files behind, so it is logged, not returned.
fn remove_run_dir(dir: &Path) {
    if let Err(err) = std::fs::remove_dir_all(dir) {
        tracing::warn!(path = %dir.display(), %err, "could not remove the rebase run folder");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::rebase_todo::RebaseAction;
    use std::process::Command;

    /// A throwaway repo in `root/repo`, with run folders in `root/runs`, so a
    /// run's files never sit inside the worktree under test. The repo has a
    /// local identity so the test's commits and the replayed ones work.
    /// Dropping it removes `root`.
    struct Scratch {
        root: PathBuf,
    }

    impl Scratch {
        fn new(name: &str) -> Self {
            let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
            let root = std::env::temp_dir()
                .join(format!("gitbee-rebase-test-{name}-{}-{nanos}", std::process::id()));
            std::fs::create_dir_all(root.join("repo")).unwrap();
            std::fs::create_dir_all(root.join("runs")).unwrap();
            let scratch = Self { root };
            scratch.git(&["init", "-q"]);
            scratch.git(&["config", "user.name", "Scratch"]);
            scratch.git(&["config", "user.email", "scratch@example.test"]);
            scratch.git(&["config", "commit.gpgsign", "false"]);
            scratch
        }

        fn repo(&self) -> PathBuf {
            self.root.join("repo")
        }

        fn runs(&self) -> PathBuf {
            self.root.join("runs")
        }

        fn git(&self, args: &[&str]) -> String {
            let out = Command::new("git")
                .arg("-C")
                .arg(self.repo())
                .args(args)
                .output()
                .expect("git must be installed for these tests");
            assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        }

        /// Writes `content` to `file`, commits it, returns the new HEAD sha.
        fn commit(&self, file: &str, content: &str, subject: &str) -> String {
            std::fs::write(self.repo().join(file), content).unwrap();
            self.git(&["add", file]);
            self.git(&["commit", "-q", "-m", subject]);
            self.git(&["rev-parse", "HEAD"])
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn item(action: RebaseAction, sha: &str, message: Option<&str>) -> RebaseItem {
        RebaseItem { action, sha: sha.to_string(), message: message.map(str::to_string) }
    }

    async fn run(scratch: &Scratch, base: &str, items: &[RebaseItem]) -> AppResult<RebaseOutcome> {
        let git = GitRunner::discover().unwrap();
        run_interactive(&git, &scratch.repo(), base, items, &scratch.runs()).await
    }

    #[tokio::test]
    async fn reword_replaces_the_message_and_keeps_the_tree() {
        let s = Scratch::new("reword");
        let base = s.commit("f.txt", "0\n", "base");
        let a = s.commit("f.txt", "1\n", "a1");
        let b = s.commit("g.txt", "x\n", "b1");
        let items = [item(RebaseAction::Reword, &a, Some("A reworded")), item(RebaseAction::Pick, &b, None)];
        let out = run(&s, &base, &items).await.unwrap();
        assert_eq!(out.status, RebaseStatus::Done);
        assert_eq!(out.before, b);
        assert_eq!(s.git(&["log", "--format=%s", "-2"]), "b1\nA reworded");
        assert_eq!(s.git(&["show", "HEAD~1:f.txt"]), "1");
    }

    #[tokio::test]
    async fn squash_folds_the_newer_commit_into_the_older_one() {
        let s = Scratch::new("squash");
        let base = s.commit("f.txt", "0\n", "base");
        let a = s.commit("f.txt", "1\n", "a1");
        let b = s.commit("g.txt", "x\n", "b1");
        let items = [item(RebaseAction::Pick, &a, None), item(RebaseAction::Squash, &b, None)];
        let out = run(&s, &base, &items).await.unwrap();
        assert_eq!(out.status, RebaseStatus::Done);
        let range = format!("{base}..HEAD");
        assert_eq!(s.git(&["rev-list", "--count", range.as_str()]), "1");
        assert!(s.git(&["log", "-1", "--format=%B"]).contains("b1"));
    }

    #[tokio::test]
    async fn an_edited_squash_head_keeps_the_edited_message_only() {
        let s = Scratch::new("squash-edit");
        let base = s.commit("f.txt", "0\n", "base");
        let a = s.commit("f.txt", "1\n", "a1");
        let b = s.commit("g.txt", "x\n", "b1");
        let items = [item(RebaseAction::Pick, &a, Some("Edited head")), item(RebaseAction::Squash, &b, None)];
        run(&s, &base, &items).await.unwrap();
        assert_eq!(s.git(&["log", "-1", "--format=%B"]), "Edited head");
    }

    #[tokio::test]
    async fn drop_removes_the_commit_from_the_branch() {
        let s = Scratch::new("drop");
        let base = s.commit("f.txt", "0\n", "base");
        let a = s.commit("f.txt", "1\n", "a1");
        let b = s.commit("g.txt", "x\n", "b1");
        let items = [item(RebaseAction::Drop, &a, None), item(RebaseAction::Pick, &b, None)];
        run(&s, &base, &items).await.unwrap();
        let range = format!("{base}..HEAD");
        assert_eq!(s.git(&["log", "--format=%s", range.as_str()]), "b1");
        assert_eq!(s.git(&["show", "HEAD~1:f.txt"]), "0");
    }

    #[tokio::test]
    async fn a_conflict_stops_the_rebase_and_keeps_the_rebase_state() {
        let s = Scratch::new("conflict");
        let base = s.commit("f.txt", "0\n", "base");
        let a = s.commit("f.txt", "1\n", "a1");
        let b = s.commit("f.txt", "2\n", "b1");
        // Reversed order: b's change is written against a's content, so it
        // conflicts on top of base.
        let items = [item(RebaseAction::Pick, &b, None), item(RebaseAction::Pick, &a, None)];
        let out = run(&s, &base, &items).await.unwrap();
        assert_eq!(out.status, RebaseStatus::Stopped);
        assert!(out.after.is_none());
        assert!(s.repo().join(".git").join("rebase-merge").exists());
        s.git(&["rebase", "--abort"]);
    }

    #[tokio::test]
    async fn a_dirty_worktree_is_refused_before_git_runs() {
        let s = Scratch::new("dirty");
        let base = s.commit("f.txt", "0\n", "base");
        let a = s.commit("f.txt", "1\n", "a1");
        std::fs::write(s.repo().join("f.txt"), "changed\n").unwrap();
        let err = run(&s, &base, &[item(RebaseAction::Pick, &a, None)]).await.unwrap_err();
        assert!(err.to_string().contains("Commit or stash your changes first"), "unexpected: {err}");
        assert_eq!(s.git(&["rev-parse", "HEAD"]), a);
    }

    #[tokio::test]
    async fn a_merge_commit_in_range_is_refused() {
        let s = Scratch::new("merge");
        let base = s.commit("f.txt", "0\n", "base");
        s.git(&["checkout", "-q", "-b", "side", base.as_str()]);
        let side = s.commit("h.txt", "side\n", "side1");
        s.git(&["checkout", "-q", "-"]);
        let a = s.commit("g.txt", "x\n", "a1");
        s.git(&["merge", "--no-ff", "-q", "-m", "merge side", "side"]);
        let items = [item(RebaseAction::Pick, &a, None), item(RebaseAction::Pick, &side, None)];
        let err = run(&s, &base, &items).await.unwrap_err();
        assert!(err.to_string().contains("merge commit"), "unexpected: {err}");
    }

    #[tokio::test]
    async fn a_list_that_no_longer_matches_the_range_is_refused() {
        let s = Scratch::new("moved");
        let base = s.commit("f.txt", "0\n", "base");
        let a = s.commit("f.txt", "1\n", "a1");
        let b = s.commit("g.txt", "x\n", "b1");
        let err = run(&s, &base, &[item(RebaseAction::Pick, &a, None)]).await.unwrap_err();
        assert!(err.to_string().contains("changed since the list was opened"), "unexpected: {err}");
        assert_eq!(s.git(&["rev-parse", "HEAD"]), b);
    }
}
