use crate::error::AppResult;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn watcher_start(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut w = state.watcher.lock();
    w.start(&PathBuf::from(path), app)?;
    Ok(())
}

#[tauri::command]
pub async fn watcher_stop(state: State<'_, AppState>) -> AppResult<()> {
    let mut w = state.watcher.lock();
    w.stop();
    Ok(())
}
