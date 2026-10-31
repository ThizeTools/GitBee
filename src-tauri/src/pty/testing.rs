//! Named fakes for PTY tests. No process or pipe is opened: the fake backend
//! hands out in-memory readers and a child that exits when told to.

use super::manager::TerminalSink;
use super::{PtyBackend, PtyChild, PtySession, PtySize, SpawnSpec, SpawnedPty};
use crate::error::AppResult;
use parking_lot::Mutex;
use std::io::Cursor;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

/// What the fake backend and its session observed, shared with the test.
#[derive(Default)]
pub struct FakeState {
    written: Mutex<Vec<u8>>,
    sizes: Mutex<Vec<PtySize>>,
    specs: Mutex<Vec<SpawnSpec>>,
    kills: AtomicUsize,
}

impl FakeState {
    pub fn written(&self) -> Vec<u8> {
        self.written.lock().clone()
    }
    pub fn sizes(&self) -> Vec<PtySize> {
        self.sizes.lock().clone()
    }
    pub fn specs(&self) -> Vec<SpawnSpec> {
        self.specs.lock().clone()
    }
    pub fn kill_count(&self) -> usize {
        self.kills.load(Ordering::SeqCst)
    }
}

/// Backend whose sessions either exit at once or live until killed.
pub struct FakeBackend {
    state: Arc<FakeState>,
    output: Vec<u8>,
    exit_code: Option<i32>,
    long_lived: bool,
}

impl FakeBackend {
    /// Sessions print `output`, then exit with `exit_code` right away.
    pub fn exiting_with(output: &[u8], exit_code: Option<i32>) -> Self {
        Self { state: Arc::default(), output: output.to_vec(), exit_code, long_lived: false }
    }

    /// Sessions stay alive until `kill` is called on them.
    pub fn long_lived() -> Self {
        Self { state: Arc::default(), output: Vec::new(), exit_code: None, long_lived: true }
    }

    pub fn state(&self) -> Arc<FakeState> {
        Arc::clone(&self.state)
    }
}

impl PtyBackend for FakeBackend {
    fn spawn(&self, spec: &SpawnSpec, size: PtySize) -> AppResult<SpawnedPty> {
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        self.state.specs.lock().push(spec.clone());
        self.state.sizes.lock().push(size);
        // Only a long-lived session keeps its sender; dropping it here makes
        // the child exit at once.
        let stop = if self.long_lived { Some(stop_tx) } else { None };
        Ok(SpawnedPty {
            session: Box::new(FakeSession { state: Arc::clone(&self.state), stop: Mutex::new(stop) }),
            reader: Box::new(Cursor::new(self.output.clone())),
            child: Box::new(FakeChild { stop: stop_rx, code: self.exit_code }),
        })
    }
}

/// Session that records input, resizes and kills in its FakeState. Its stop
/// sender is what lets the child exit when the session is killed.
pub struct FakeSession {
    state: Arc<FakeState>,
    stop: Mutex<Option<mpsc::Sender<()>>>,
}

impl PtySession for FakeSession {
    fn write(&self, bytes: &[u8]) -> AppResult<()> {
        self.state.written.lock().extend_from_slice(bytes);
        Ok(())
    }

    fn resize(&self, size: PtySize) -> AppResult<()> {
        self.state.sizes.lock().push(size);
        Ok(())
    }

    fn kill(&self) {
        self.state.kills.fetch_add(1, Ordering::SeqCst);
        let stop = self.stop.lock().take();
        drop(stop);
    }
}

/// Child that blocks until its stop channel closes, then reports `code`.
pub struct FakeChild {
    stop: mpsc::Receiver<()>,
    code: Option<i32>,
}

impl PtyChild for FakeChild {
    fn wait_exit(&mut self) -> Option<i32> {
        let _ = self.stop.recv();
        self.code
    }
}

/// One event the sink saw, in arrival order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecordedEvent {
    Output(u32, String),
    Exited(u32, Option<i32>),
}

/// Sink that records every call.
#[derive(Default)]
pub struct FakeSink {
    recorded: Mutex<Vec<RecordedEvent>>,
}

impl FakeSink {
    pub fn events(&self) -> Vec<RecordedEvent> {
        self.recorded.lock().clone()
    }

    /// Output payloads only, in order.
    pub fn outputs(&self) -> Vec<String> {
        self.events()
            .into_iter()
            .filter_map(|e| match e {
                RecordedEvent::Output(_, text) => Some(text),
                RecordedEvent::Exited(..) => None,
            })
            .collect()
    }
}

impl TerminalSink for FakeSink {
    fn output(&self, id: u32, data: &str) {
        self.recorded.lock().push(RecordedEvent::Output(id, data.to_string()));
    }

    fn exited(&self, id: u32, code: Option<i32>) {
        self.recorded.lock().push(RecordedEvent::Exited(id, code));
    }
}

/// Polls `cond` until it holds. Panics after 2 s so a broken thread fails the test.
pub fn wait_until(cond: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while !cond() {
        assert!(Instant::now() < deadline, "condition not met within 2 s");
        thread::sleep(Duration::from_millis(2));
    }
}
