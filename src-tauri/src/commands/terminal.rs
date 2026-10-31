//! Tauri commands for the embedded terminal. They validate input and delegate
//! to `pty::manager::PtyManager`, the only owner of sessions. Design and events:
//! docs/specs/embedded-terminal.md.

use crate::error::{AppError, AppResult};
use crate::pty::manager::{PtyManager, TerminalSink};
use crate::pty::portable::PortableBackend;
use crate::pty::{shell, PtySize};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

/// Managed app state: the manager that owns every live shell session.
pub struct TerminalRegistry {
    manager: Arc<PtyManager>,
}

impl Default for TerminalRegistry {
    fn default() -> Self {
        Self { manager: Arc::new(PtyManager::new(Arc::new(PortableBackend))) }
    }
}

#[derive(Serialize, Clone)]
struct OutputPayload<'a> {
    id: u32,
    data: &'a str,
}

#[derive(Serialize, Clone)]
struct ExitPayload {
    id: u32,
    code: Option<i32>,
}

/// Forwards session output and exit notices to the webview as events.
struct AppSink {
    app: AppHandle,
}

impl TerminalSink for AppSink {
    fn output(&self, id: u32, data: &str) {
        let _ = self.app.emit("terminal-output", OutputPayload { id, data });
    }

    fn exited(&self, id: u32, code: Option<i32>) {
        let _ = self.app.emit("terminal-exit", ExitPayload { id, code });
    }
}

/// Resolves the directory a shell starts in. Fails with the offending path when
/// it is not an existing directory.
/// Example: repo_dir("C:/missing".into()) is Err(InvalidRepoPath("C:/missing")).
fn repo_dir(path: String) -> AppResult<PathBuf> {
    let cwd = PathBuf::from(&path);
    if cwd.is_dir() {
        return Ok(cwd);
    }
    Err(AppError::InvalidRepoPath(path))
}

/// Starts a shell in the repo at `path`, sized `cols` by `rows`. Returns the session id.
#[tauri::command]
pub async fn terminal_spawn(
    path: String,
    cols: u16,
    rows: u16,
    app: AppHandle,
    registry: tauri::State<'_, TerminalRegistry>,
) -> AppResult<u32> {
    let cwd = repo_dir(path)?;
    let env_shell = std::env::var("SHELL").ok();
    let chosen = shell::choose_shell(cfg!(windows), env_shell.as_deref(), &shell::is_on_path);
    registry
        .manager
        .spawn(chosen, cwd, PtySize::new(cols, rows), Arc::new(AppSink { app }))
}

/// Sends keystrokes or pasted text to a session. Runs on the blocking pool
/// because a full PTY input buffer blocks the write, and that must not stall
/// the async runtime.
#[tauri::command]
pub async fn terminal_write(
    id: u32,
    data: String,
    registry: tauri::State<'_, TerminalRegistry>,
) -> AppResult<()> {
    let manager = Arc::clone(&registry.manager);
    tokio::task::spawn_blocking(move || manager.write(id, data.as_bytes()))
        .await
        .map_err(|e| AppError::Other(format!("terminal write task failed: {e}")))?
}

/// Resizes a session's grid to `cols` by `rows`.
#[tauri::command]
pub async fn terminal_resize(
    id: u32,
    cols: u16,
    rows: u16,
    registry: tauri::State<'_, TerminalRegistry>,
) -> AppResult<()> {
    registry.manager.resize(id, PtySize::new(cols, rows))
}

/// Ends a session. Returns at once; the PTY is released in the background.
#[tauri::command]
pub async fn terminal_kill(id: u32, registry: tauri::State<'_, TerminalRegistry>) -> AppResult<()> {
    registry.manager.kill(id);
    Ok(())
}

/// Ends every session when the app exits, so no shell outlives GitBee.
pub fn shutdown(app: &AppHandle) {
    app.state::<TerminalRegistry>().manager.kill_all();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_dir_accepts_an_existing_directory() {
        let dir = std::env::temp_dir();
        let path = dir.to_string_lossy().into_owned();
        assert_eq!(repo_dir(path).unwrap(), dir);
    }

    #[test]
    fn repo_dir_rejects_a_missing_path_and_names_it() {
        let missing = "/definitely/not/a/gitbee/repo".to_string();
        match repo_dir(missing.clone()) {
            Err(AppError::InvalidRepoPath(path)) => assert_eq!(path, missing),
            other => panic!("expected InvalidRepoPath, got {other:?}"),
        }
    }
}
