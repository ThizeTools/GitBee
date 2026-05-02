use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;

#[derive(Debug, Clone)]
pub struct GitRunner {
    git_exe: PathBuf,
}

impl GitRunner {
    pub fn discover() -> AppResult<Self> {
        let exe = which_git().ok_or(AppError::GitNotFound)?;
        Ok(Self { git_exe: exe })
    }

    pub fn with_executable(git_exe: PathBuf) -> Self {
        Self { git_exe }
    }

    pub async fn run<I, S>(&self, cwd: &Path, args: I) -> AppResult<Vec<u8>>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        let mut cmd = Command::new(&self.git_exe);
        cmd.current_dir(cwd)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // CREATE_NO_WINDOW (0x08000000): keeps git.exe from popping a flashing
        // console window on every invocation in release builds (which have no
        // parent console). With the file watcher firing many git calls per
        // refresh, this otherwise looks like an infinite stream of terminals.
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x0800_0000);
        let output = cmd.output().await?;

        if !output.status.success() {
            return Err(AppError::GitFailed {
                status: output.status.code(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            });
        }
        Ok(output.stdout)
    }

    pub async fn run_text<I, S>(&self, cwd: &Path, args: I) -> AppResult<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        let bytes = self.run(cwd, args).await?;
        String::from_utf8(bytes)
            .map_err(|e| AppError::Parse(format!("non-utf8 git output: {e}")))
    }

    pub async fn is_repository(&self, cwd: &Path) -> bool {
        self.run(cwd, ["rev-parse", "--is-inside-work-tree"]).await.is_ok()
    }
}

fn which_git() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "git.exe" } else { "git" };
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(exe);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}
