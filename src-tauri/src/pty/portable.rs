//! The real backend, built on portable-pty (ConPTY on Windows, openpty elsewhere).
//! This is the only file that names portable-pty. Everything else sees the
//! traits in pty/mod.rs.

use super::{PtyBackend, PtyChild, PtySession, PtySize, SpawnSpec, SpawnedPty};
use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize as NativeSize};
use std::io::Write;
use std::sync::Arc;
use std::thread;

/// Starts shells as real PTY children.
pub struct PortableBackend;

impl PtyBackend for PortableBackend {
    fn spawn(&self, spec: &SpawnSpec, size: PtySize) -> AppResult<SpawnedPty> {
        let pair = native_pty_system().openpty(to_native(size)).map_err(native_err)?;
        let child = pair.slave.spawn_command(command_for(spec)).map_err(native_err)?;
        // The parent must not keep the slave open, or the reader never sees
        // EOF after the shell exits.
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().map_err(native_err)?;
        let writer = pair.master.take_writer().map_err(native_err)?;
        let killer = child.clone_killer();
        Ok(SpawnedPty {
            session: Box::new(PortableSession::new(writer, pair.master, killer)),
            reader,
            child: Box::new(PortableChild(child)),
        })
    }
}

fn command_for(spec: &SpawnSpec) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(&spec.shell.program);
    cmd.args(&spec.shell.args);
    cmd.cwd(&spec.cwd);
    for (key, value) in &spec.env {
        cmd.env(key, value);
    }
    cmd
}

fn to_native(size: PtySize) -> NativeSize {
    NativeSize { rows: size.rows, cols: size.cols, pixel_width: 0, pixel_height: 0 }
}

fn native_err<E: std::fmt::Display>(err: E) -> AppError {
    AppError::Other(format!("pty: {err}"))
}

type SharedWriter = Arc<Mutex<Option<Box<dyn Write + Send>>>>;
type SharedMaster = Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>;

/// One PTY. The writer and master sit behind Arcs so kill can move their
/// release onto a detached thread without waiting on a blocked write.
pub struct PortableSession {
    writer: SharedWriter,
    master: SharedMaster,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

impl PortableSession {
    fn new(
        writer: Box<dyn Write + Send>,
        master: Box<dyn MasterPty + Send>,
        killer: Box<dyn ChildKiller + Send + Sync>,
    ) -> Self {
        Self {
            writer: Arc::new(Mutex::new(Some(writer))),
            master: Arc::new(Mutex::new(Some(master))),
            killer: Mutex::new(killer),
        }
    }
}

fn closed_err() -> AppError {
    AppError::Other("terminal session is already closed".into())
}

impl PtySession for PortableSession {
    fn write(&self, bytes: &[u8]) -> AppResult<()> {
        let mut slot = self.writer.lock();
        let writer = slot.as_mut().ok_or_else(closed_err)?;
        writer.write_all(bytes)?;
        writer.flush()?;
        Ok(())
    }

    fn resize(&self, size: PtySize) -> AppResult<()> {
        let slot = self.master.lock();
        let master = slot.as_ref().ok_or_else(closed_err)?;
        master.resize(to_native(size)).map_err(native_err)
    }

    /// Kills the shell now and releases the PTY on a detached thread. Closing
    /// the ConPTY can wait for the output pipe to drain, so the caller never does it.
    fn kill(&self) {
        let _ = self.killer.lock().kill();
        let writer = Arc::clone(&self.writer);
        let master = Arc::clone(&self.master);
        thread::spawn(move || {
            drop(writer.lock().take());
            drop(master.lock().take());
        });
    }
}

struct PortableChild(Box<dyn Child + Send + Sync>);

impl PtyChild for PortableChild {
    fn wait_exit(&mut self) -> Option<i32> {
        self.0.wait().ok().map(|status| status.exit_code() as i32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::ShellProgram;
    use std::io::Read;
    use std::sync::mpsc;
    use std::time::Duration;

    /// Program that prints a marker and exits 0 on each platform.
    fn echo_spec() -> SpawnSpec {
        let shell = if cfg!(windows) {
            ShellProgram {
                program: "cmd.exe".into(),
                args: vec!["/C".into(), "echo gitbee-pty-ok".into()],
            }
        } else {
            ShellProgram {
                program: "/bin/sh".into(),
                args: vec!["-c".into(), "echo gitbee-pty-ok".into()],
            }
        };
        SpawnSpec::new(shell, std::env::temp_dir())
    }

    #[test]
    fn real_program_prints_output_and_reports_exit_zero() {
        let SpawnedPty { session, reader, mut child } =
            PortableBackend.spawn(&echo_spec(), PtySize::new(80, 24)).expect("spawn echo program");
        let (tx, rx) = mpsc::channel::<String>();
        std::thread::spawn(move || read_text_into(reader, &tx));
        assert_eq!(child.wait_exit(), Some(0));
        let seen = collect_until(&rx, "gitbee-pty-ok");
        session.kill();
        assert!(seen.contains("gitbee-pty-ok"), "output was: {seen:?}");
    }

    fn read_text_into(mut reader: Box<dyn Read + Send>, tx: &mpsc::Sender<String>) {
        let mut buf = [0u8; 1024];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || tx.send(String::from_utf8_lossy(&buf[..n]).into_owned()).is_err() {
                break;
            }
        }
    }

    fn collect_until(rx: &mpsc::Receiver<String>, marker: &str) -> String {
        let mut all = String::new();
        while !all.contains(marker) {
            match rx.recv_timeout(Duration::from_secs(5)) {
                Ok(chunk) => all.push_str(&chunk),
                Err(_) => break,
            }
        }
        all
    }
}
