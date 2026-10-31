//! Sends git progress to the window as `git-progress` events. The parsing and
//! rate rules live in git/progress.rs; this module connects them to Tauri and
//! the git runner. See docs/specs/git-progress.md for the event contract.

use crate::error::AppResult;
use crate::git::progress::{ProgressLine, Throttle, PROGRESS_MIN_GAP};
use crate::git::GitRunner;
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

/// Tauri event name. The frontend listens for it in src/lib/stores/gitProgress.ts.
pub const PROGRESS_EVENT: &str = "git-progress";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitOp {
    Fetch,
    Pull,
    Push,
    Clone,
}

impl GitOp {
    pub fn as_str(self) -> &'static str {
        match self {
            GitOp::Fetch => "fetch",
            GitOp::Pull => "pull",
            GitOp::Push => "push",
            GitOp::Clone => "clone",
        }
    }
}

/// Payload of one `git-progress` event. `done` is true exactly once per
/// operation, after git has exited, whether it succeeded or failed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitProgressEvent {
    pub repo: String,
    pub op: &'static str,
    pub phase: Option<String>,
    pub percent: Option<u8>,
    pub done: bool,
}

/// Where progress events go. Tauri's AppHandle implements it; tests use a
/// recording fake. `Sync` because the git future holds the sink across awaits.
pub trait ProgressSink: Sync {
    fn send(&self, event: GitProgressEvent);
}

impl ProgressSink for AppHandle {
    fn send(&self, event: GitProgressEvent) {
        // A failed emit only drops one progress update. It must never change
        // the git result, so the error is ignored on purpose.
        let _ = self.emit(PROGRESS_EVENT, event);
    }
}

/// Turns git's progress lines into throttled events for one operation. The
/// throttle is here, not in the frontend, so every op gets the same limit.
struct ProgressReporter<'a, K: ProgressSink> {
    sink: &'a K,
    repo: &'a str,
    op: GitOp,
    throttle: Mutex<Throttle>,
}

impl<'a, K: ProgressSink> ProgressReporter<'a, K> {
    fn new(sink: &'a K, repo: &'a str, op: GitOp) -> Self {
        Self { sink, repo, op, throttle: Mutex::new(Throttle::new(PROGRESS_MIN_GAP)) }
    }

    fn report(&self, line: ProgressLine) {
        self.report_at(line, Instant::now());
    }

    /// `now` is a parameter so the throttle can be tested without sleeping.
    fn report_at(&self, line: ProgressLine, now: Instant) {
        // A poisoned lock only means an earlier send panicked; progress is
        // best-effort, so the event is sent rather than dropped.
        let due = self.throttle.lock().map(|mut t| t.allow(now)).unwrap_or(true);
        if !due {
            return;
        }
        self.sink.send(self.event(Some(line.phase), line.percent, false));
    }

    fn finish(&self) {
        self.sink.send(self.event(None, None, true));
    }

    fn event(&self, phase: Option<String>, percent: Option<u8>, done: bool) -> GitProgressEvent {
        GitProgressEvent {
            repo: self.repo.to_string(),
            op: self.op.as_str(),
            phase,
            percent,
            done,
        }
    }
}

/// Runs git with `--progress` already in `args` and reports its progress for
/// `repo`. A final `done` event is always sent, also when git fails, so the
/// window never keeps a stale progress pill.
pub async fn run_reporting<K, I, S>(
    sink: &K,
    git: &GitRunner,
    cwd: &Path,
    repo: &str,
    op: GitOp,
    args: I,
) -> AppResult<Vec<u8>>
where
    K: ProgressSink,
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let reporter = ProgressReporter::new(sink, repo, op);
    let result = git.run_with_progress(cwd, args, |line| reporter.report(line)).await;
    reporter.finish();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use std::path::PathBuf;
    use std::time::Duration;

    /// Records every event so tests can check what the window would receive.
    #[derive(Default)]
    struct RecordingSink {
        events: Mutex<Vec<GitProgressEvent>>,
    }

    impl RecordingSink {
        fn events(&self) -> Vec<GitProgressEvent> {
            self.events.lock().unwrap().clone()
        }
    }

    impl ProgressSink for RecordingSink {
        fn send(&self, event: GitProgressEvent) {
            self.events.lock().unwrap().push(event);
        }
    }

    fn line(percent: u8) -> ProgressLine {
        ProgressLine { phase: "Writing objects".into(), percent: Some(percent), done: None, total: None }
    }

    #[test]
    fn reporter_drops_lines_inside_the_throttle_gap() {
        let sink = RecordingSink::default();
        let reporter = ProgressReporter::new(&sink, "/repo", GitOp::Push);
        let t0 = Instant::now();
        reporter.report_at(line(10), t0);
        reporter.report_at(line(20), t0 + Duration::from_millis(10));
        reporter.report_at(line(30), t0 + PROGRESS_MIN_GAP);
        let percents: Vec<Option<u8>> = sink.events().iter().map(|e| e.percent).collect();
        assert_eq!(percents, [Some(10), Some(30)]);
    }

    #[test]
    fn finish_sends_a_done_event_without_phase_or_percent() {
        let sink = RecordingSink::default();
        ProgressReporter::new(&sink, "/repo", GitOp::Fetch).finish();
        let events = sink.events();
        assert_eq!(events.len(), 1);
        assert!(events[0].done);
        assert_eq!((events[0].phase.as_deref(), events[0].percent), (None, None));
        assert_eq!(events[0].op, "fetch");
    }

    #[tokio::test]
    async fn run_reporting_sends_done_when_git_cannot_start() {
        let sink = RecordingSink::default();
        let git = GitRunner::with_executable(PathBuf::from("no-such-git-binary-gitbee-test"));
        let result = run_reporting(&sink, &git, Path::new("."), "/repo", GitOp::Push, ["push"]).await;
        assert!(matches!(result, Err(AppError::Io(_))));
        let events = sink.events();
        assert_eq!(events.len(), 1);
        assert!(events[0].done);
        assert_eq!(events[0].repo, "/repo");
        assert_eq!(events[0].op, "push");
    }

    #[test]
    fn event_payload_uses_the_documented_keys() {
        let event = GitProgressEvent {
            repo: "/r".into(),
            op: GitOp::Clone.as_str(),
            phase: Some("Receiving objects".into()),
            percent: Some(45),
            done: false,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["repo"], "/r");
        assert_eq!(json["op"], "clone");
        assert_eq!(json["phase"], "Receiving objects");
        assert_eq!(json["percent"], 45);
        assert_eq!(json["done"], false);
    }

    #[test]
    fn git_op_names_match_the_frontend_union() {
        assert_eq!(GitOp::Fetch.as_str(), "fetch");
        assert_eq!(GitOp::Pull.as_str(), "pull");
        assert_eq!(GitOp::Push.as_str(), "push");
        assert_eq!(GitOp::Clone.as_str(), "clone");
    }
}
