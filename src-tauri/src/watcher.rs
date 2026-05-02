use crate::error::AppResult;
use notify::{EventKind, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const DEBOUNCE: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Serialize)]
pub struct RepoChangedEvent {
    pub path: String,
}

pub struct RepoWatcher {
    watcher: Option<notify::RecommendedWatcher>,
    watching: Mutex<Option<PathBuf>>,
}

impl RepoWatcher {
    pub fn new() -> Self {
        Self { watcher: None, watching: Mutex::new(None) }
    }

    pub fn start(&mut self, repo_path: &Path, app: AppHandle) -> AppResult<()> {
        self.stop();
        let last = Mutex::new(Instant::now() - DEBOUNCE * 2);
        let path_str = repo_path.to_string_lossy().to_string();
        let app_handle = app.clone();

        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(ev) = res else { return };
            if !matches!(
                ev.kind,
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
            ) {
                return;
            }
            let mut last = last.lock();
            if last.elapsed() < DEBOUNCE {
                return;
            }
            *last = Instant::now();
            let _ = app_handle.emit(
                "repo-changed",
                RepoChangedEvent { path: path_str.clone() },
            );
        })?;

        let git_dir = repo_path.join(".git");
        watcher.watch(&git_dir, RecursiveMode::Recursive)?;
        watcher.watch(repo_path, RecursiveMode::NonRecursive)?;

        *self.watching.lock() = Some(repo_path.to_path_buf());
        self.watcher = Some(watcher);
        Ok(())
    }

    pub fn stop(&mut self) {
        self.watcher = None;
        *self.watching.lock() = None;
    }
}

impl Default for RepoWatcher {
    fn default() -> Self { Self::new() }
}

impl From<notify::Error> for crate::error::AppError {
    fn from(e: notify::Error) -> Self {
        crate::error::AppError::Other(format!("watcher: {e}"))
    }
}
