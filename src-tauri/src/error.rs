use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("git command failed (status {status:?}): {stderr}")]
    GitFailed { status: Option<i32>, stderr: String },

    #[error("git executable not found in PATH; set the `git.executable` setting to its full path")]
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

    /// AI commit message errors. The text is shown to the user as is, so it
    /// carries no prefix (docs/specs/ai-commit-message.md "Errors").
    #[error("{0}")]
    Ai(String),

    /// Git LFS refusals ("Git LFS is not installed") and bad LFS input. Shown
    /// as is, without a prefix (docs/specs/git-lfs.md "Errors").
    #[error("{0}")]
    Lfs(String),

    #[error("other: {0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
