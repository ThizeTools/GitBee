//! Owns the live PTY sessions and routes calls to them by id.
//!
//! Lock rule (WHY, see commit 036f930): the map lock is held only to insert,
//! look up or remove an entry. It is never held while a session writes,
//! resizes, is killed, or while a thread is joined. The old line-mode terminal
//! kept a child lock across `wait()`, and terminal_kill then blocked forever.

use super::pump::{self, PtyEvent};
use super::{PtyBackend, PtySession, PtySize, ShellProgram, SpawnSpec, SpawnedPty};
use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;

/// Receives session output and exit notices. The app implements it by emitting
/// Tauri events; tests implement it by recording.
pub trait TerminalSink: Send + Sync {
    fn output(&self, id: u32, data: &str);
    fn exited(&self, id: u32, code: Option<i32>);
}

type SessionMap = HashMap<u32, Arc<dyn PtySession>>;

/// Keeps every live session, keyed by the id handed to the frontend.
pub struct PtyManager {
    backend: Arc<dyn PtyBackend>,
    sessions: Arc<Mutex<SessionMap>>,
    next_id: AtomicU32,
}

impl PtyManager {
    pub fn new(backend: Arc<dyn PtyBackend>) -> Self {
        Self {
            backend,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU32::new(1),
        }
    }

    /// Starts a shell in `cwd` and returns its session id. Output and the exit
    /// notice reach `sink` from background threads.
    pub fn spawn(
        &self,
        shell: ShellProgram,
        cwd: PathBuf,
        size: PtySize,
        sink: Arc<dyn TerminalSink>,
    ) -> AppResult<u32> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let spec = SpawnSpec::new(shell, cwd);
        let SpawnedPty { session, reader, child } = self.backend.spawn(&spec, size)?;
        self.sessions.lock().insert(id, Arc::from(session));
        let (tx, rx) = mpsc::channel::<PtyEvent>();
        let drained = pump::spawn_reader(reader, tx.clone());
        let sessions = Arc::clone(&self.sessions);
        pump::spawn_exit_waiter(child, tx, drained, move || drop_entry(&sessions, id));
        thread::spawn(move || pump::run_emitter(id, &rx, sink.as_ref()));
        Ok(id)
    }

    /// Sends input to a session. Fails with the id when no live session has it.
    pub fn write(&self, id: u32, bytes: &[u8]) -> AppResult<()> {
        self.session(id)?.write(bytes)
    }

    pub fn resize(&self, id: u32, size: PtySize) -> AppResult<()> {
        self.session(id)?.resize(size)
    }

    /// Ends a session and forgets it. An unknown id is ignored, because the
    /// shell may have exited on its own a moment earlier.
    pub fn kill(&self, id: u32) {
        let removed = self.sessions.lock().remove(&id);
        if let Some(session) = removed {
            session.kill();
        }
    }

    /// Ends every session. Called once when the app exits.
    pub fn kill_all(&self) {
        let all: Vec<Arc<dyn PtySession>> = self.sessions.lock().drain().map(|(_, s)| s).collect();
        for session in all {
            session.kill();
        }
    }

    /// Number of sessions still in the map. Exited and killed sessions are not counted.
    pub fn live_count(&self) -> usize {
        self.sessions.lock().len()
    }

    fn session(&self, id: u32) -> AppResult<Arc<dyn PtySession>> {
        let found = self.sessions.lock().get(&id).cloned();
        found.ok_or_else(|| {
            AppError::Other(format!("no terminal session with id {id}; expected an id from terminal_spawn"))
        })
    }
}

/// Removes an exited session. The entry is dropped after the lock is released,
/// since dropping the last handle can close the PTY and wait for output to drain.
fn drop_entry(sessions: &Mutex<SessionMap>, id: u32) {
    let removed = sessions.lock().remove(&id);
    drop(removed);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::testing::{wait_until, FakeBackend, FakeSink, RecordedEvent};

    fn shell() -> ShellProgram {
        ShellProgram { program: "fake-shell".into(), args: Vec::new() }
    }

    fn manager_with(backend: Arc<FakeBackend>) -> PtyManager {
        PtyManager::new(backend)
    }

    #[test]
    fn spawn_hands_out_increasing_ids() {
        let manager = manager_with(Arc::new(FakeBackend::exiting_with(b"", None)));
        let sink = Arc::new(FakeSink::default());
        let first = manager.spawn(shell(), PathBuf::from("/r"), PtySize::new(80, 24), sink.clone()).unwrap();
        let second = manager.spawn(shell(), PathBuf::from("/r"), PtySize::new(80, 24), sink).unwrap();
        assert!(second > first);
    }

    #[test]
    fn spawn_passes_cwd_and_term_to_backend() {
        let backend = Arc::new(FakeBackend::long_lived());
        let manager = manager_with(backend.clone());
        manager.spawn(shell(), PathBuf::from("/repo"), PtySize::new(80, 24), Arc::new(FakeSink::default())).unwrap();
        let specs = backend.state().specs();
        assert_eq!(specs[0].cwd, PathBuf::from("/repo"));
        assert!(specs[0].env.iter().any(|(k, v)| k == "TERM" && v == "xterm-256color"));
    }

    #[test]
    fn write_reaches_the_session() {
        let backend = Arc::new(FakeBackend::long_lived());
        let manager = manager_with(backend.clone());
        let id = manager.spawn(shell(), PathBuf::from("/r"), PtySize::new(80, 24), Arc::new(FakeSink::default())).unwrap();
        manager.write(id, b"ls\r").unwrap();
        assert_eq!(backend.state().written(), b"ls\r".to_vec());
    }

    #[test]
    fn write_to_unknown_id_names_the_id() {
        let manager = manager_with(Arc::new(FakeBackend::long_lived()));
        let err = manager.write(99, b"x").unwrap_err();
        assert!(err.to_string().contains("99"), "error was: {err}");
    }

    #[test]
    fn resize_passes_the_new_size_to_the_session() {
        let backend = Arc::new(FakeBackend::long_lived());
        let manager = manager_with(backend.clone());
        let id = manager.spawn(shell(), PathBuf::from("/r"), PtySize::new(80, 24), Arc::new(FakeSink::default())).unwrap();
        manager.resize(id, PtySize::new(120, 40)).unwrap();
        assert_eq!(backend.state().sizes().last().copied(), Some(PtySize::new(120, 40)));
    }

    #[test]
    fn kill_ends_the_session_and_forgets_it() {
        let backend = Arc::new(FakeBackend::long_lived());
        let manager = manager_with(backend.clone());
        let id = manager.spawn(shell(), PathBuf::from("/r"), PtySize::new(80, 24), Arc::new(FakeSink::default())).unwrap();
        manager.kill(id);
        assert_eq!(backend.state().kill_count(), 1);
        assert!(manager.write(id, b"x").is_err());
    }

    #[test]
    fn kill_of_unknown_id_is_a_no_op() {
        let manager = manager_with(Arc::new(FakeBackend::long_lived()));
        manager.kill(42);
        assert_eq!(manager.live_count(), 0);
    }

    #[test]
    fn kill_all_ends_every_session() {
        let backend = Arc::new(FakeBackend::long_lived());
        let manager = manager_with(backend.clone());
        for _ in 0..3 {
            manager.spawn(shell(), PathBuf::from("/r"), PtySize::new(80, 24), Arc::new(FakeSink::default())).unwrap();
        }
        manager.kill_all();
        assert_eq!(backend.state().kill_count(), 3);
        assert_eq!(manager.live_count(), 0);
    }

    #[test]
    fn output_and_exit_reach_the_sink_and_exited_session_is_removed() {
        let manager = manager_with(Arc::new(FakeBackend::exiting_with(b"hi", Some(0))));
        let sink = Arc::new(FakeSink::default());
        let id = manager.spawn(shell(), PathBuf::from("/r"), PtySize::new(80, 24), sink.clone()).unwrap();
        wait_until(|| sink.events().iter().any(|e| matches!(e, RecordedEvent::Exited(..))));
        assert_eq!(
            sink.events(),
            vec![RecordedEvent::Output(id, "hi".into()), RecordedEvent::Exited(id, Some(0))],
        );
        wait_until(|| manager.live_count() == 0);
        assert!(manager.write(id, b"x").is_err());
    }
}
