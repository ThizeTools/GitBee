use crate::cache::CacheStore;
use crate::error::AppResult;
use crate::git::GitRunner;
use crate::watcher::RepoWatcher;
use parking_lot::Mutex;

pub struct AppState {
    pub git: GitRunner,
    pub cache: CacheStore,
    pub watcher: Mutex<RepoWatcher>,
}

impl AppState {
    pub fn init() -> AppResult<Self> {
        let git = GitRunner::discover()?;
        let cache = CacheStore::open(&crate::cache::store::default_db_path())?;
        Ok(Self { git, cache, watcher: Mutex::new(RepoWatcher::new()) })
    }
}
