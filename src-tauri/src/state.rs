use crate::cache::CacheStore;
use crate::error::AppResult;
use crate::git::GitRunner;
use crate::watcher::RepoWatcher;
use parking_lot::Mutex;
use std::path::PathBuf;

pub struct AppState {
    pub git: GitRunner,
    pub cache: CacheStore,
    pub watcher: Mutex<RepoWatcher>,
}

impl AppState {
    pub fn init() -> AppResult<Self> {
        // Open the cache first so we can honor a configured git path. Only a
        // cache failure (disk/IO) is fatal here — a missing git executable is
        // NOT, see resolve_git. (audit 2026-05)
        let cache = CacheStore::open(&crate::cache::store::default_db_path())?;
        let git = resolve_git(&cache);
        Ok(Self { git, cache, watcher: Mutex::new(RepoWatcher::new()) })
    }
}

// Locate git without ever panicking at startup. Previously `GitRunner::discover()?`
// bubbled up to `.expect(...)` in lib.rs, so a machine with git installed but
// not on PATH crashed the whole app on launch. Now: honor an explicit
// `git.executable` setting, then PATH + well-known install locations, and as a
// last resort assume `git` resolves at call time — the window still opens and
// git-dependent actions surface a normal error toast instead. (audit 2026-05)
fn resolve_git(cache: &CacheStore) -> GitRunner {
    if let Ok(Some(p)) = cache.settings_get("git.executable") {
        let pb = PathBuf::from(&p);
        if pb.is_file() {
            return GitRunner::with_executable(pb);
        }
    }
    if let Ok(runner) = GitRunner::discover() {
        return runner;
    }
    GitRunner::with_executable(PathBuf::from(if cfg!(windows) { "git.exe" } else { "git" }))
}
