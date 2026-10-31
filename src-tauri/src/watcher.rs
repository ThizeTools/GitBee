use crate::error::AppResult;
use crate::git::GitRunner;
use crate::state::AppState;
use notify::{EventKind, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

// Trailing-edge coalescing: a burst ends after QUIET without events, or
// MAX_WAIT after its first event. The previous leading-edge 400 ms
// debounce fired on the first event and dropped the rest, so long bursts
// (builds, npm install) re-fired for their whole duration and the final
// state could be missed. See docs/specs/repo-refresh.md.
const QUIET: Duration = Duration::from_millis(300);
const MAX_WAIT: Duration = Duration::from_millis(2000);
// Above this many distinct working-tree paths in one burst, skip the
// check-ignore round-trip and just refresh once.
const MAX_TRACKED_PATHS: usize = 2000;

// Filenames inside .git that change as a side-effect of read-only git
// commands (or as transient lock files during writes) and therefore do
// NOT represent a real repo state change. Compared by basename.
fn is_noise(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
        return false;
    };
    if name.ends_with(".lock") || name.ends_with(".tmp") {
        return true;
    }
    matches!(
        name,
        "FETCH_HEAD"
            | "ORIG_HEAD"
            | "COMMIT_EDITMSG"
            | "AUTO_MERGE"
            | "gitk.cache"
            | "shallow"
            | "packed-refs.new"
    )
}

/// True when a change at `rel` (relative to the git dir) means repo state
/// changed. objects/ and logs/ always change together with refs/ or the
/// index, which are reported on their own, so skipping them cuts most of
/// a fetch/gc burst. Example: `is_meaningful_git_path(Path::new("HEAD"))`.
fn is_meaningful_git_path(rel: &Path) -> bool {
    let first = rel
        .components()
        .next()
        .and_then(|c| c.as_os_str().to_str())
        .unwrap_or("");
    if matches!(first, "objects" | "logs" | "hooks") {
        return false;
    }
    !is_noise(rel)
}

#[derive(Debug, PartialEq)]
enum PathClass {
    GitMeaningful,
    // `.git/index` alone means only `git status` is stale, so it gets its
    // own class instead of forcing a full refresh.
    GitIndex,
    GitNoise,
    WorkTree(String),
    Outside,
}

/// Sorts one event path. Working-tree paths come back repo-relative with
/// forward slashes, the form `git check-ignore --stdin` expects and echoes.
fn classify(repo: &Path, git_dir: &Path, path: &Path) -> PathClass {
    if let Ok(rel) = path.strip_prefix(git_dir) {
        if rel == Path::new("index") {
            return PathClass::GitIndex;
        }
        return if is_meaningful_git_path(rel) {
            PathClass::GitMeaningful
        } else {
            PathClass::GitNoise
        };
    }
    match path.strip_prefix(repo) {
        Ok(rel) if !rel.as_os_str().is_empty() => {
            PathClass::WorkTree(rel.to_string_lossy().replace('\\', "/"))
        }
        _ => PathClass::Outside,
    }
}

/// How much of the UI a burst invalidates. Status = only `git status`
/// needs reloading (working tree or index changed); Full = refs, HEAD,
/// stash, config etc. changed, so the whole graph may be stale too.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RefreshScope {
    Status,
    Full,
}

#[derive(Default)]
struct PendingBurst {
    git_changed: bool,
    index_changed: bool,
    overflow: bool,
    worktree: HashSet<String>,
    first_at: Option<Instant>,
    last_at: Option<Instant>,
    flush_scheduled: bool,
}

impl PendingBurst {
    /// Records one path; returns false when the path is irrelevant.
    fn record(&mut self, class: PathClass) -> bool {
        match class {
            PathClass::GitMeaningful => self.git_changed = true,
            PathClass::GitIndex => self.index_changed = true,
            PathClass::WorkTree(rel) if self.worktree.len() < MAX_TRACKED_PATHS => {
                self.worktree.insert(rel);
            }
            PathClass::WorkTree(_) => self.overflow = true,
            PathClass::GitNoise | PathClass::Outside => return false,
        }
        true
    }

    fn is_settled(&self, now: Instant) -> bool {
        let quiet = self
            .last_at
            .map_or(true, |t| now.duration_since(t) >= QUIET);
        let capped = self
            .first_at
            .map_or(true, |t| now.duration_since(t) >= MAX_WAIT);
        quiet || capped
    }
}

struct WatchContext {
    repo: PathBuf,
    git_dir: PathBuf,
    app: AppHandle,
    alive: AtomicBool,
    pending: Mutex<PendingBurst>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepoChangedEvent {
    pub path: String,
    pub scope: RefreshScope,
}

fn record_event(ctx: &Arc<WatchContext>, paths: &[PathBuf]) {
    let mut p = ctx.pending.lock();
    let mut touched = false;
    for path in paths {
        touched |= p.record(classify(&ctx.repo, &ctx.git_dir, path));
    }
    if !touched {
        return;
    }
    let now = Instant::now();
    p.first_at.get_or_insert(now);
    p.last_at = Some(now);
    if p.flush_scheduled {
        return;
    }
    p.flush_scheduled = true;
    let ctx = Arc::clone(ctx);
    tauri::async_runtime::spawn(async move { flush_when_quiet(ctx).await });
}

async fn flush_when_quiet(ctx: Arc<WatchContext>) {
    loop {
        tokio::time::sleep(QUIET).await;
        if ctx.pending.lock().is_settled(Instant::now()) {
            break;
        }
    }
    let burst = std::mem::take(&mut *ctx.pending.lock());
    if !ctx.alive.load(Ordering::Relaxed) {
        return;
    }
    let Some(scope) = burst_scope(&ctx, &burst).await else {
        return;
    };
    if !ctx.alive.load(Ordering::Relaxed) {
        return;
    }
    let path = ctx.repo.to_string_lossy().to_string();
    let _ = ctx.app.emit("repo-changed", RepoChangedEvent { path, scope });
}

/// Decides from the burst alone when it can; only a working-tree-only burst
/// needs the `check-ignore` round-trip.
fn quick_scope(burst: &PendingBurst) -> Option<RefreshScope> {
    if burst.git_changed || burst.overflow {
        return Some(RefreshScope::Full);
    }
    if burst.index_changed {
        return Some(RefreshScope::Status);
    }
    None
}

async fn burst_scope(ctx: &WatchContext, burst: &PendingBurst) -> Option<RefreshScope> {
    if let Some(scope) = quick_scope(burst) {
        return Some(scope);
    }
    if burst.worktree.is_empty() {
        return None;
    }
    let state = ctx.app.state::<AppState>();
    let ignored = ignored_paths(&state.git, &ctx.repo, &burst.worktree).await;
    if burst.worktree.iter().any(|p| !ignored.contains(p)) {
        return Some(RefreshScope::Status);
    }
    None
}

/// Asks git which of `paths` are ignored, in one process for the whole
/// burst. Exit status 1 means "none ignored"; any failure returns an
/// empty set so the caller errs toward refreshing.
async fn ignored_paths(git: &GitRunner, repo: &Path, paths: &HashSet<String>) -> HashSet<String> {
    let mut stdin = Vec::new();
    for p in paths {
        stdin.extend_from_slice(p.as_bytes());
        stdin.push(0);
    }
    let Ok(out) = git
        .run_with_stdin(repo, ["check-ignore", "-z", "--stdin"], &stdin)
        .await
    else {
        return HashSet::new();
    };
    out.split(|b| *b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .collect()
}

pub struct RepoWatcher {
    watcher: Option<notify::RecommendedWatcher>,
    ctx: Option<Arc<WatchContext>>,
}

impl RepoWatcher {
    pub fn new() -> Self {
        Self {
            watcher: None,
            ctx: None,
        }
    }

    pub fn start(&mut self, repo_path: &Path, app: AppHandle) -> AppResult<()> {
        self.stop();
        let git_dir = repo_path.join(".git");
        let ctx = Arc::new(WatchContext {
            repo: repo_path.to_path_buf(),
            git_dir: git_dir.clone(),
            app,
            alive: AtomicBool::new(true),
            pending: Mutex::new(PendingBurst::default()),
        });
        let cb_ctx = Arc::clone(&ctx);
        let mut watcher =
            notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
                let Ok(ev) = res else { return };
                if matches!(
                    ev.kind,
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                ) {
                    record_event(&cb_ctx, &ev.paths);
                }
            })?;
        // One recursive watch on the root covers a normal `.git` directory
        // (one directory handle instead of two). A linked worktree has a
        // `.git` FILE pointing elsewhere; keep watching it as before.
        watcher.watch(repo_path, RecursiveMode::Recursive)?;
        if !git_dir.is_dir() {
            watcher.watch(&git_dir, RecursiveMode::Recursive)?;
        }
        self.watcher = Some(watcher);
        self.ctx = Some(ctx);
        Ok(())
    }

    /// Drops the OS watcher (releasing its directory handles) and cancels
    /// any burst still waiting to flush.
    pub fn stop(&mut self) {
        self.watcher = None;
        if let Some(ctx) = self.ctx.take() {
            ctx.alive.store(false, Ordering::Relaxed);
        }
    }
}

impl Default for RepoWatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl From<notify::Error> for crate::error::AppError {
    fn from(e: notify::Error) -> Self {
        crate::error::AppError::Other(format!("watcher: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> PathBuf {
        PathBuf::from("C:/r")
    }
    fn git() -> PathBuf {
        repo().join(".git")
    }

    #[test]
    fn git_refs_are_meaningful_and_index_is_its_own_class() {
        assert_eq!(
            classify(&repo(), &git(), &git().join("HEAD")),
            PathClass::GitMeaningful
        );
        assert_eq!(
            classify(&repo(), &git(), &git().join("index")),
            PathClass::GitIndex
        );
        assert_eq!(
            classify(
                &repo(),
                &git(),
                &git().join("refs").join("heads").join("main")
            ),
            PathClass::GitMeaningful
        );
    }

    #[test]
    fn git_objects_logs_and_locks_are_noise() {
        assert_eq!(
            classify(
                &repo(),
                &git(),
                &git().join("objects").join("ab").join("cd")
            ),
            PathClass::GitNoise
        );
        assert_eq!(
            classify(&repo(), &git(), &git().join("logs").join("HEAD")),
            PathClass::GitNoise
        );
        assert_eq!(
            classify(&repo(), &git(), &git().join("index.lock")),
            PathClass::GitNoise
        );
        assert_eq!(
            classify(&repo(), &git(), &git().join("FETCH_HEAD")),
            PathClass::GitNoise
        );
    }

    #[test]
    fn worktree_paths_are_repo_relative_with_forward_slashes() {
        let p = repo().join("src").join("main.rs");
        assert_eq!(
            classify(&repo(), &git(), &p),
            PathClass::WorkTree("src/main.rs".into())
        );
    }

    #[test]
    fn root_itself_and_foreign_paths_are_outside() {
        assert_eq!(classify(&repo(), &git(), &repo()), PathClass::Outside);
        assert_eq!(
            classify(&repo(), &git(), Path::new("D:/other/file")),
            PathClass::Outside
        );
    }

    #[test]
    fn burst_overflows_past_path_cap() {
        let mut b = PendingBurst::default();
        for i in 0..=MAX_TRACKED_PATHS {
            b.record(PathClass::WorkTree(format!("f{i}")));
        }
        assert!(b.overflow);
        assert_eq!(b.worktree.len(), MAX_TRACKED_PATHS);
    }

    #[test]
    fn quick_scope_is_full_for_git_changes_and_overflow() {
        let mut git_burst = PendingBurst::default();
        git_burst.record(PathClass::GitMeaningful);
        assert_eq!(quick_scope(&git_burst), Some(RefreshScope::Full));

        let mut overflow_burst = PendingBurst::default();
        overflow_burst.overflow = true;
        assert_eq!(quick_scope(&overflow_burst), Some(RefreshScope::Full));
    }

    #[test]
    fn quick_scope_is_status_for_index_only() {
        let mut b = PendingBurst::default();
        b.record(PathClass::GitIndex);
        assert_eq!(quick_scope(&b), Some(RefreshScope::Status));
    }

    #[test]
    fn quick_scope_is_none_for_default_and_worktree_only_bursts() {
        assert_eq!(quick_scope(&PendingBurst::default()), None);
        let mut b = PendingBurst::default();
        b.record(PathClass::WorkTree("src/main.rs".into()));
        assert_eq!(quick_scope(&b), None);
    }

    #[test]
    fn refresh_scope_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&RefreshScope::Status).unwrap(),
            "\"status\""
        );
        assert_eq!(serde_json::to_string(&RefreshScope::Full).unwrap(), "\"full\"");
    }

    #[test]
    fn burst_settles_after_quiet_or_max_wait() {
        let now = Instant::now();
        let mut b = PendingBurst {
            first_at: Some(now),
            last_at: Some(now),
            ..Default::default()
        };
        assert!(!b.is_settled(now));
        assert!(b.is_settled(now + QUIET));
        b.last_at = Some(now + MAX_WAIT);
        assert!(b.is_settled(now + MAX_WAIT));
    }
}
