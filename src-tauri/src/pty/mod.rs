//! Embedded terminal backend. The rest of the app talks to shells only through
//! the traits in this file; `portable.rs` is the one place that names
//! portable-pty.
//!
//! WHY a project-owned trait: the session map, reader pump and kill ordering
//! are tested with fakes (`testing.rs`), and swapping the PTY crate changes a
//! single file. See docs/specs/embedded-terminal.md.

pub mod manager;
pub mod output;
pub mod portable;
pub mod pump;
pub mod shell;
#[cfg(test)]
pub mod testing;

use crate::error::AppResult;
use std::io::Read;
use std::path::PathBuf;

/// Character-cell size of the terminal grid.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PtySize {
    pub cols: u16,
    pub rows: u16,
}

impl PtySize {
    /// Clamps both axes to one cell or more. A zero-sized PTY makes some
    /// shells exit at once, and a hidden dock can report 0x0 while measuring.
    pub fn new(cols: u16, rows: u16) -> Self {
        Self { cols: cols.max(1), rows: rows.max(1) }
    }
}

/// Executable and arguments of the interactive shell.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShellProgram {
    pub program: String,
    pub args: Vec<String>,
}

/// Everything a backend needs to start one shell.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpawnSpec {
    pub shell: ShellProgram,
    pub cwd: PathBuf,
    /// Variables added on top of the inherited environment.
    pub env: Vec<(String, String)>,
}

impl SpawnSpec {
    /// Builds the spec for a repo shell. TERM tells shells and pagers (git
    /// log, less, vim) that the other end understands xterm escape codes.
    /// Example: SpawnSpec::new(shell, PathBuf::from("C:/repo")).env contains TERM.
    pub fn new(shell: ShellProgram, cwd: PathBuf) -> Self {
        Self {
            shell,
            cwd,
            env: vec![("TERM".to_string(), "xterm-256color".to_string())],
        }
    }
}

/// Starts shells. The real implementation is `portable::PortableBackend`;
/// tests use `testing::FakeBackend`.
pub trait PtyBackend: Send + Sync {
    fn spawn(&self, spec: &SpawnSpec, size: PtySize) -> AppResult<SpawnedPty>;
}

/// The parts of a started shell. Each part has one owner: the session stays
/// in the manager map, the reader goes to the pump thread and the child to the
/// exit waiter. Returning them separately avoids Option::take dances later.
pub struct SpawnedPty {
    pub session: Box<dyn PtySession>,
    pub reader: Box<dyn Read + Send>,
    pub child: Box<dyn PtyChild>,
}

/// Input, resize and kill for one PTY. Methods take `&self` so the manager can
/// reach a session without holding any session-wide lock.
pub trait PtySession: Send + Sync {
    /// Sends input bytes to the shell. May block while the PTY input buffer is full.
    fn write(&self, bytes: &[u8]) -> AppResult<()>;
    fn resize(&self, size: PtySize) -> AppResult<()>;
    /// Starts terminating the shell and releasing the PTY. Must return at once:
    /// the UI thread calls it, and a PTY close can wait on pending output.
    fn kill(&self);
}

/// The shell process. `wait_exit` blocks until the shell exits.
pub trait PtyChild: Send {
    /// Exit code, or None when the process reports none (for example, killed).
    fn wait_exit(&mut self) -> Option<i32>;
}
