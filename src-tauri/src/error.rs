use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("git command failed (status {status:?}): {stderr}")]
    GitFailed { status: Option<i32>, stderr: String },

    #[error("git executable not found in PATH; configure `gitExecutable` in settings")]
    GitNotFound,

    #[error("invalid repository path: {0}")]
    InvalidRepoPath(String),

    #[error("parser error: {0}")]
    Parse(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("github: {0}")]
    GitHub(String),

    #[error("other: {0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
