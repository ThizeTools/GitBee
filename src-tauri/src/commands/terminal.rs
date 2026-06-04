use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::oneshot;
use tokio::sync::Mutex as TokioMutex;

// Line-mode shell. Not a real PTY: works for basic commands and git, breaks
// for curses apps. Documented in docs/specs/ui-overhaul-2026-04.md.

pub struct TerminalSession {
    pub id: String,
    pub stdin: Arc<TokioMutex<ChildStdin>>,
    // Kill signal for the exit-watcher task that OWNS the Child. We do NOT
    // share the Child behind a Mutex: the old design held the child lock
    // across `wait().await` for the whole shell lifetime, so terminal_kill
    // could never acquire it and the kill hung forever, leaking the process.
    // Sending on (or dropping) this channel makes the watcher start_kill the
    // child. (audit 2026-05)
    pub kill: Option<oneshot::Sender<()>>,
}

#[derive(Default)]
pub struct TerminalRegistry {
    pub sessions: Mutex<HashMap<String, TerminalSession>>,
}

#[derive(Serialize, Clone)]
struct OutputPayload<'a> { id: &'a str, chunk: String }

#[derive(Serialize, Clone)]
struct ExitPayload<'a> { id: &'a str, code: Option<i32> }

fn new_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("term-{n}")
}

fn build_shell(cwd: &str) -> std::io::Result<tokio::process::Child> {
    // Use cmd.exe in pipe mode on Windows. The frontend renders the prompt
    // visually (we feed cwd back via the @@__GKP_CWD__@@ marker after each
    // command) so the prompt look is decoupled from the shell.
    #[cfg(target_os = "windows")]
    let mut cmd = {
        // CREATE_NO_WINDOW: 0x08000000. Without it, release builds (which
        // run with no console) flash a black window on every spawn AND can
        // cause cmd.exe to exit immediately because it can't attach to a
        // console — which used to trigger an infinite respawn loop on the
        // frontend. tokio::process::Command exposes creation_flags as an
        // inherent Windows method, so no extra trait import is needed.
        let mut c = Command::new("cmd.exe");
        c.args(["/Q", "/K", "@echo off & prompt $S"]);
        c.creation_flags(0x0800_0000);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let mut c = Command::new(shell);
        c.args(["-i"]);
        c
    };
    cmd.current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
}

#[tauri::command]
pub async fn terminal_spawn(
    cwd: String,
    app: AppHandle,
    registry: tauri::State<'_, TerminalRegistry>,
) -> AppResult<String> {
    let mut child = build_shell(&cwd)?;
    let id = new_id();
    let stdin = child.stdin.take().ok_or_else(|| AppError::Other("no stdin".into()))?;
    let stdout = child.stdout.take().ok_or_else(|| AppError::Other("no stdout".into()))?;
    let stderr = child.stderr.take().ok_or_else(|| AppError::Other("no stderr".into()))?;

    let id_clone = id.clone();
    let app_for_out = app.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut buf = String::new();
        loop {
            buf.clear();
            match reader.read_line(&mut buf).await {
                Ok(0) => break,
                Ok(_) => {
                    let _ = app_for_out.emit(
                        "terminal-output",
                        OutputPayload { id: &id_clone, chunk: buf.clone() },
                    );
                }
                Err(_) => break,
            }
        }
    });

    let id_clone2 = id.clone();
    let app_for_err = app.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut buf = String::new();
        loop {
            buf.clear();
            match reader.read_line(&mut buf).await {
                Ok(0) => break,
                Ok(_) => {
                    let _ = app_for_err.emit(
                        "terminal-output",
                        OutputPayload { id: &id_clone2, chunk: buf.clone() },
                    );
                }
                Err(_) => break,
            }
        }
    });

    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    let session = TerminalSession {
        id: id.clone(),
        stdin: Arc::new(TokioMutex::new(stdin)),
        kill: Some(kill_tx),
    };
    let id_for_exit = id.clone();
    let app_for_exit = app.clone();
    // The exit-watcher owns the Child. It races the shell's natural exit
    // against a kill request: an explicit terminal_kill sends on kill_rx, and
    // dropping the session (sender) also resolves kill_rx (Err) — both lead to
    // start_kill. No shared lock, so terminal_kill never blocks. (audit 2026-05)
    tokio::spawn(async move {
        let status = tokio::select! {
            s = child.wait() => s.ok(),
            _ = kill_rx => {
                let _ = child.start_kill();
                child.wait().await.ok()
            }
        };
        let _ = app_for_exit.emit(
            "terminal-exit",
            ExitPayload { id: &id_for_exit, code: status.and_then(|s| s.code()) },
        );
    });

    registry.sessions.lock().insert(id.clone(), session);
    Ok(id)
}

#[tauri::command]
pub async fn terminal_write(
    id: String,
    data: String,
    registry: tauri::State<'_, TerminalRegistry>,
) -> AppResult<()> {
    let stdin = {
        let map = registry.sessions.lock();
        let s = map.get(&id).ok_or_else(|| AppError::Other(format!("no terminal {id}")))?;
        s.stdin.clone()
    };
    let mut g = stdin.lock().await;
    g.write_all(data.as_bytes()).await?;
    g.flush().await?;
    Ok(())
}

#[tauri::command]
pub async fn terminal_kill(
    id: String,
    registry: tauri::State<'_, TerminalRegistry>,
) -> AppResult<()> {
    let session = registry.sessions.lock().remove(&id);
    if let Some(mut s) = session {
        // Signal the exit-watcher to kill the child. If the receiver is already
        // gone (shell exited on its own) the send simply fails — harmless.
        if let Some(tx) = s.kill.take() {
            let _ = tx.send(());
        }
    }
    Ok(())
}
