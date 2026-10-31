//! Threads around one PTY session. The reader turns bytes into text, the exit
//! waiter reports the shell's exit, and the emitter coalesces output into
//! events. Each thread ends by itself; none of them waits on a session lock.

use super::manager::TerminalSink;
use super::output::{Utf8Chunker, MAX_CHUNK_BYTES};
use super::PtyChild;
use std::io::{ErrorKind, Read};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant};

/// How long output may wait for more output before it is emitted. Short
/// enough to feel live, long enough that a fast `git log` is one event.
pub const COALESCE_WINDOW: Duration = Duration::from_millis(8);

const READ_BUFFER_BYTES: usize = MAX_CHUNK_BYTES;

/// Longest the exit waiter waits for the reader to drain after the shell exits.
const EXIT_DRAIN_WAIT: Duration = Duration::from_millis(500);

/// What the reader and the exit waiter send to the emitter.
#[derive(Debug, PartialEq, Eq)]
pub enum PtyEvent {
    Output(String),
    Exit(Option<i32>),
}

/// Reads the PTY on a new thread until EOF, sending decoded text. The returned
/// receiver fires once the reader has sent its last chunk.
pub fn spawn_reader(reader: Box<dyn Read + Send>, tx: Sender<PtyEvent>) -> Receiver<()> {
    let (drained_tx, drained_rx) = mpsc::channel::<()>();
    thread::spawn(move || {
        pump_reader(reader, &tx);
        let _ = drained_tx.send(());
    });
    drained_rx
}

/// Reads until EOF, sending each complete text chunk. Stops early when the
/// emitter is gone, since nothing would receive the rest.
pub fn pump_reader<R: Read>(mut reader: R, tx: &Sender<PtyEvent>) {
    let mut chunker = Utf8Chunker::default();
    let mut buf = vec![0u8; READ_BUFFER_BYTES];
    while let Some(n) = read_some(&mut reader, &mut buf) {
        for text in chunker.push(&buf[..n]) {
            if tx.send(PtyEvent::Output(text)).is_err() {
                return;
            }
        }
    }
    if let Some(rest) = chunker.finish() {
        let _ = tx.send(PtyEvent::Output(rest));
    }
}

/// One read. None at EOF or on a hard error, which both mean the PTY is
/// gone. An interrupted read is retried.
fn read_some<R: Read>(reader: &mut R, buf: &mut [u8]) -> Option<usize> {
    loop {
        match reader.read(buf) {
            Ok(0) => return None,
            Ok(n) => return Some(n),
            Err(err) if err.kind() == ErrorKind::Interrupted => continue,
            Err(_) => return None,
        }
    }
}

/// Waits for the shell to exit on a new thread. `on_exit` runs first, so the
/// session is gone from the map. Then the waiter gives the reader up to
/// EXIT_DRAIN_WAIT to deliver the shell's last output, so the exit notice
/// follows that output. The wait is bounded: a PTY that never reaches EOF must
/// not keep the exit event from the UI.
pub fn spawn_exit_waiter<F>(
    mut child: Box<dyn PtyChild>,
    tx: Sender<PtyEvent>,
    drained: Receiver<()>,
    on_exit: F,
) where
    F: FnOnce() + Send + 'static,
{
    thread::spawn(move || {
        let code = child.wait_exit();
        on_exit();
        let _ = drained.recv_timeout(EXIT_DRAIN_WAIT);
        let _ = tx.send(PtyEvent::Exit(code));
    });
}

/// Forwards events to the sink until the Exit event, or until every sender is
/// gone. Output waits at most COALESCE_WINDOW from its first chunk, so a burst
/// becomes a few events and a trickle still arrives promptly.
pub fn run_emitter(id: u32, rx: &Receiver<PtyEvent>, sink: &dyn TerminalSink) {
    let mut batch = Batch::default();
    loop {
        let received = match batch.deadline {
            None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
            Some(at) => rx.recv_timeout(at.saturating_duration_since(Instant::now())),
        };
        match received {
            Ok(PtyEvent::Output(text)) => batch.push(id, text, sink),
            Ok(PtyEvent::Exit(code)) => {
                batch.flush(id, sink);
                sink.exited(id, code);
                return;
            }
            Err(RecvTimeoutError::Timeout) => batch.flush(id, sink),
            Err(RecvTimeoutError::Disconnected) => {
                batch.flush(id, sink);
                return;
            }
        }
    }
}

/// Output waiting to be emitted as one event.
#[derive(Default)]
struct Batch {
    text: String,
    deadline: Option<Instant>,
}

impl Batch {
    /// Appends a chunk. Flushes first when the result would exceed MAX_CHUNK_BYTES,
    /// so every emitted event stays within the IPC size bound.
    fn push(&mut self, id: u32, next: String, sink: &dyn TerminalSink) {
        if self.text.len() + next.len() > MAX_CHUNK_BYTES {
            self.flush(id, sink);
        }
        if self.deadline.is_none() {
            self.deadline = Some(Instant::now() + COALESCE_WINDOW);
        }
        self.text.push_str(&next);
    }

    fn flush(&mut self, id: u32, sink: &dyn TerminalSink) {
        self.deadline = None;
        if self.text.is_empty() {
            return;
        }
        sink.output(id, &std::mem::take(&mut self.text));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::testing::{wait_until, FakeSink, RecordedEvent};
    use std::io::Cursor;
    use std::sync::{mpsc, Arc};

    #[test]
    fn reader_sends_decoded_text_then_stops_at_eof() {
        let (tx, rx) = mpsc::channel();
        pump_reader(Cursor::new(b"hello".to_vec()), &tx);
        drop(tx);
        let events: Vec<PtyEvent> = rx.iter().collect();
        assert_eq!(events, vec![PtyEvent::Output("hello".to_string())]);
    }

    #[test]
    fn emitter_coalesces_chunks_and_reports_exit_last() {
        let (tx, rx) = mpsc::channel();
        tx.send(PtyEvent::Output("ab".into())).unwrap();
        tx.send(PtyEvent::Output("cd".into())).unwrap();
        tx.send(PtyEvent::Exit(Some(0))).unwrap();
        let sink = FakeSink::default();
        run_emitter(7, &rx, &sink);
        assert_eq!(
            sink.events(),
            vec![RecordedEvent::Output(7, "abcd".into()), RecordedEvent::Exited(7, Some(0))],
        );
    }

    #[test]
    fn emitter_splits_output_that_would_exceed_the_chunk_bound() {
        let (tx, rx) = mpsc::channel();
        let big = "z".repeat(MAX_CHUNK_BYTES - 1);
        tx.send(PtyEvent::Output(big.clone())).unwrap();
        tx.send(PtyEvent::Output("zz".into())).unwrap();
        drop(tx);
        let sink = FakeSink::default();
        run_emitter(3, &rx, &sink);
        let texts: Vec<String> = sink.outputs();
        assert_eq!(texts, vec![big, "zz".to_string()]);
    }

    #[test]
    fn emitter_flushes_pending_output_when_senders_disconnect() {
        let (tx, rx) = mpsc::channel();
        tx.send(PtyEvent::Output("tail".into())).unwrap();
        drop(tx);
        let sink = FakeSink::default();
        run_emitter(1, &rx, &sink);
        assert_eq!(sink.events(), vec![RecordedEvent::Output(1, "tail".into())]);
    }

    #[test]
    fn emitter_flushes_a_lone_chunk_after_the_coalesce_window() {
        let (tx, rx) = mpsc::channel();
        let sink = Arc::new(FakeSink::default());
        let worker_sink = Arc::clone(&sink);
        let worker = thread::spawn(move || run_emitter(2, &rx, worker_sink.as_ref()));
        tx.send(PtyEvent::Output("slow".into())).unwrap();
        wait_until(|| !sink.outputs().is_empty());
        assert_eq!(sink.outputs(), vec!["slow".to_string()]);
        drop(tx);
        worker.join().unwrap();
    }
}
