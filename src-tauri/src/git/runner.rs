use super::progress::{parse_progress, ProgressLine, SegmentSplitter};
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

/// Env for git calls that may reach an editor (`rebase --continue`, the
/// squash step). `GIT_EDITOR=true` accepts git's prepared message at once.
/// WHY: the process is hidden, so an editor it started would block forever.
/// See docs/specs/interactive-rebase.md.
pub const NO_EDITOR_ENV: (&str, &str) = ("GIT_EDITOR", "true");

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

    // GIT_OPTIONAL_LOCKS=0: read-only commands (notably `git status`) must
    // not rewrite .git/index or take index.lock. The rewrite re-triggered
    // the repo watcher in a loop, and the lock made the user's own git
    // commands in other tools fail. See docs/specs/repo-refresh.md.
    //
    // GIT_TERMINAL_PROMPT=0 and the low-speed limit: without a terminal git
    // can wait forever on a credential prompt, and a stalled HTTP transfer
    // never ends, which kept the auto-fetch in-flight guard set. Callers
    // passing their own `-c http.lowSpeed*` (github/create.rs push_initial)
    // override these, because later `-c` values win. See
    // docs/specs/repo-refresh.md.
    fn base_command(&self, cwd: &Path, stdin: Stdio) -> Command {
        let mut cmd = Command::new(&self.git_exe);
        cmd.args(["-c", "http.lowSpeedLimit=1", "-c", "http.lowSpeedTime=60"]);
        cmd.current_dir(cwd)
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(stdin)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // CREATE_NO_WINDOW (0x08000000): keeps git.exe from popping a flashing
        // console window on every invocation in release builds (which have no
        // parent console). With the file watcher firing many git calls per
        // refresh, this otherwise looks like an infinite stream of terminals.
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x0800_0000);
        cmd
    }

    pub fn executable(&self) -> &Path {
        &self.git_exe
    }

    pub async fn run<I, S>(&self, cwd: &Path, args: I) -> AppResult<Vec<u8>>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        self.run_with_env(cwd, args, &[]).await
    }

    /// Like `run`, plus environment variables for this one call. A hidden
    /// process must never reach an editor, so callers that may open one pass
    /// `NO_EDITOR_ENV` (see docs/specs/interactive-rebase.md).
    pub async fn run_with_env<I, S>(
        &self,
        cwd: &Path,
        args: I,
        envs: &[(&str, &str)],
    ) -> AppResult<Vec<u8>>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        let mut cmd = self.base_command(cwd, Stdio::null());
        cmd.envs(envs.iter().copied());
        cmd.args(args);
        let output = cmd.output().await?;

        if !output.status.success() {
            return Err(AppError::GitFailed {
                status: output.status.code(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            });
        }
        Ok(output.stdout)
    }

    /// Like `run`, but calls `on_line` for each progress segment git writes to
    /// stderr while it works. Git redraws progress with `\r`, so `\r` and `\n`
    /// both end a segment. The full stderr is still kept for the error, so a
    /// failure is reported exactly as `run` reports it. See
    /// docs/specs/git-progress.md.
    pub async fn run_with_progress<I, S, F>(
        &self,
        cwd: &Path,
        args: I,
        on_line: F,
    ) -> AppResult<Vec<u8>>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
        F: Fn(ProgressLine) + Send + Sync,
    {
        let mut cmd = self.base_command(cwd, Stdio::null());
        cmd.args(args);
        let mut child = cmd.spawn()?;
        let stdout = take_piped(child.stdout.take(), "stdout")?;
        let stderr = take_piped(child.stderr.take(), "stderr")?;
        // Stdout is drained while stderr is read: a full pipe on either side
        // would otherwise block git and deadlock the wait.
        let (out, err, status) = tokio::join!(
            read_all(stdout),
            read_progress(stderr, &on_line),
            child.wait(),
        );
        finish_output(status?, out?, err?)
    }

    pub async fn run_text<I, S>(&self, cwd: &Path, args: I) -> AppResult<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        let bytes = self.run(cwd, args).await?;
        String::from_utf8(bytes).map_err(|e| AppError::Parse(format!("non-utf8 git output: {e}")))
    }

    /// Like `run_text` but never fails on non-UTF8 bytes — decodes lossily
    /// (replacement chars for invalid sequences). Use for human-display
    /// output (diffs, blame, file contents, commit bodies) where a Latin-1 /
    /// Shift-JIS file must still render rather than hard-erroring the whole
    /// command. Do NOT use where exact bytes matter (sha parsing, etc.).
    /// (audit 2026-05)
    pub async fn run_text_lossy<I, S>(&self, cwd: &Path, args: I) -> AppResult<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        let bytes = self.run(cwd, args).await?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    pub async fn is_repository(&self, cwd: &Path) -> bool {
        self.run(cwd, ["rev-parse", "--is-inside-work-tree"])
            .await
            .is_ok()
    }

    /// Run git with bytes piped to stdin. Used for `git credential …`
    /// commands that read fields from stdin in their prompt protocol.
    pub async fn run_with_stdin<I, S>(
        &self,
        cwd: &Path,
        args: I,
        stdin_bytes: &[u8],
    ) -> AppResult<Vec<u8>>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        let mut cmd = self.base_command(cwd, Stdio::piped());
        cmd.args(args);
        let mut child = cmd.spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(stdin_bytes).await?;
            stdin.shutdown().await?;
        }
        let output = child.wait_with_output().await?;
        if !output.status.success() {
            return Err(AppError::GitFailed {
                status: output.status.code(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            });
        }
        Ok(output.stdout)
    }
}

// `base_command` always pipes both streams, so a missing pipe is a bug in
// this file, not a git failure. The error names the stream to make it findable.
fn take_piped<T>(pipe: Option<T>, name: &str) -> AppResult<T> {
    pipe.ok_or_else(|| AppError::Other(format!("git {name} was not piped; check base_command")))
}

async fn read_all<R: AsyncRead + Unpin>(mut reader: R) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).await?;
    Ok(bytes)
}

/// Reads stderr to the end, reporting each progress segment as it arrives.
/// Returns every byte read so the caller can build the error from it.
async fn read_progress<R, F>(mut reader: R, on_line: &F) -> std::io::Result<Vec<u8>>
where
    R: AsyncRead + Unpin,
    F: Fn(ProgressLine),
{
    let mut all = Vec::new();
    let mut splitter = SegmentSplitter::default();
    let mut chunk = [0u8; 4096];
    loop {
        let n = reader.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        all.extend_from_slice(&chunk[..n]);
        splitter.feed(&chunk[..n], |segment| report_segment(segment, on_line));
    }
    splitter.finish(|segment| report_segment(segment, on_line));
    Ok(all)
}

fn report_segment<F: Fn(ProgressLine)>(segment: &[u8], on_line: &F) {
    if let Some(line) = parse_progress(&String::from_utf8_lossy(segment)) {
        on_line(line);
    }
}

// Same error shape as `run`, so callers cannot tell the two apart on failure.
fn finish_output(status: ExitStatus, stdout: Vec<u8>, stderr: Vec<u8>) -> AppResult<Vec<u8>> {
    if !status.success() {
        return Err(AppError::GitFailed {
            status: status.code(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
        });
    }
    Ok(stdout)
}

fn which_git() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "git.exe" } else { "git" };
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(exe);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    // Fall back to well-known install locations so a machine where git is
    // installed but not on PATH (Git-for-Windows "Git Bash only" install,
    // GitHub Desktop's bundled git) still works instead of the app refusing
    // to start. (audit 2026-05)
    well_known_git().into_iter().find(|p| p.is_file())
}

#[cfg(windows)]
fn well_known_git() -> Vec<PathBuf> {
    vec![
        PathBuf::from(r"C:\Program Files\Git\cmd\git.exe"),
        PathBuf::from(r"C:\Program Files (x86)\Git\cmd\git.exe"),
    ]
}

#[cfg(not(windows))]
fn well_known_git() -> Vec<PathBuf> {
    vec![
        PathBuf::from("/usr/bin/git"),
        PathBuf::from("/usr/local/bin/git"),
        PathBuf::from("/opt/homebrew/bin/git"),
    ]
}

/// Reject a user/repo-supplied ref/sha/name that begins with '-'. No shell is
/// involved (we use `Command::args`), so the only injection class is git
/// parsing such a value as an option (e.g. a malicious repo's branch named
/// `--upload-pack=…`). Validate at the call site for every user-controlled
/// positional. (audit 2026-05)
pub fn checked_ref(value: &str) -> AppResult<&str> {
    if value.starts_with('-') {
        return Err(AppError::Other(format!(
            "invalid git ref/name {value:?}: must not start with '-'"
        )));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    fn env_value(cmd: &Command, key: &str) -> Option<String> {
        cmd.as_std()
            .get_envs()
            .find(|(k, _)| *k == OsStr::new(key))
            .and_then(|(_, v)| v.map(|v| v.to_string_lossy().into_owned()))
    }

    #[test]
    fn base_command_sets_low_speed_args_and_noninteractive_env() {
        let cmd = GitRunner::with_executable(PathBuf::from("git"))
            .base_command(Path::new("."), Stdio::null());
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            &args[..4],
            &["-c", "http.lowSpeedLimit=1", "-c", "http.lowSpeedTime=60"]
        );
        assert_eq!(env_value(&cmd, "GIT_TERMINAL_PROMPT").as_deref(), Some("0"));
        assert_eq!(env_value(&cmd, "GIT_OPTIONAL_LOCKS").as_deref(), Some("0"));
    }

    #[tokio::test]
    async fn read_progress_reports_each_segment_and_keeps_every_byte() {
        let input: &[u8] = b"Receiving objects:  10% (1/10)\rReceiving objects:  20% (2/10)\n";
        let seen = std::sync::Mutex::new(Vec::new());
        let on_line = |line: ProgressLine| seen.lock().unwrap().push(line);
        let all = read_progress(input, &on_line).await.unwrap();
        assert_eq!(all, input);
        let percents: Vec<Option<u8>> = seen.lock().unwrap().iter().map(|l| l.percent).collect();
        assert_eq!(percents, [Some(10), Some(20)]);
    }

    #[tokio::test]
    async fn run_with_progress_returns_stdout_on_success() {
        let runner = GitRunner::discover().unwrap();
        let out = runner.run_with_progress(Path::new("."), ["--version"], |_| {}).await.unwrap();
        assert!(String::from_utf8_lossy(&out).starts_with("git version"));
    }

    #[tokio::test]
    async fn run_with_progress_keeps_git_stderr_in_the_error() {
        let runner = GitRunner::discover().unwrap();
        let err = runner
            .run_with_progress(Path::new("."), ["--no-such-flag-gitbee-test"], |_| {})
            .await
            .unwrap_err();
        match err {
            AppError::GitFailed { stderr, .. } => assert!(!stderr.is_empty()),
            other => panic!("expected GitFailed, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn run_with_env_passes_the_variable_to_git() {
        // `git var GIT_EDITOR` prints the editor git would launch, so it shows
        // whether the per-call env reached the git process.
        let runner = GitRunner::discover().unwrap();
        let out = runner
            .run_with_env(Path::new("."), ["var", "GIT_EDITOR"], &[NO_EDITOR_ENV])
            .await
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&out).trim(), "true");
    }

    #[tokio::test]
    async fn run_with_progress_reports_a_missing_executable_as_an_error() {
        let runner = GitRunner::with_executable(PathBuf::from("no-such-git-binary-gitbee-test"));
        assert!(runner.run_with_progress(Path::new("."), ["status"], |_| {}).await.is_err());
    }
}
