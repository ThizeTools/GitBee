//! Data shapes of the pull-request feature: what the Tauri commands return to
//! the UI and what the "New pull request" dialog sends. Plain data with no
//! I/O. Spec: `docs/specs/github-pull-requests.md`.

use serde::{Deserialize, Serialize};

/// One row of the PR list. `same_repo` is false for a fork's PR and for a
/// head repo that was deleted; checkout then fetches `refs/pull/<n>/head`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PullRow {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub merged: bool,
    pub draft: bool,
    pub author: String,
    pub author_avatar: String,
    pub head_ref: String,
    pub head_sha: String,
    pub base_ref: String,
    pub same_repo: bool,
    pub updated_at: i64,
    pub html_url: String,
}

/// Everything the detail pane shows. `#[serde(flatten)]` puts the row fields
/// at the top level, so the TS type extends `PullRow`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PullDetail {
    #[serde(flatten)]
    pub pull: PullRow,
    pub body: String,
    pub labels: Vec<PullLabel>,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    pub mergeable: Option<bool>,
    pub mergeable_state: Option<String>,
    pub review: ReviewSummary,
    pub checks: ChecksSummary,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PullLabel {
    pub name: String,
    pub color: String,
}

/// `decision` is GitHub's `reviewDecision` (APPROVED, CHANGES_REQUESTED,
/// REVIEW_REQUIRED) or null when the branch has no review rule.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct ReviewSummary {
    pub decision: Option<String>,
    pub reviewers: Vec<ReviewerState>,
    pub requested: Vec<String>,
}

/// The state of a reviewer's latest review (APPROVED, CHANGES_REQUESTED,
/// COMMENTED or DISMISSED).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ReviewerState {
    pub login: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CheckRun {
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub html_url: Option<String>,
}

/// Counts over the first 100 check runs of the head commit. `runs` holds the
/// same runs for the list in the detail pane.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct ChecksSummary {
    pub passed: u32,
    pub failed: u32,
    pub pending: u32,
    pub skipped: u32,
    pub runs: Vec<CheckRun>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckBucket {
    Passed,
    Failed,
    Pending,
    Skipped,
}

/// Merge strategy, as the REST `merge_method` field spells it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MergeMethod {
    Merge,
    Squash,
    Rebase,
}

impl MergeMethod {
    pub fn api_name(self) -> &'static str {
        match self {
            MergeMethod::Merge => "merge",
            MergeMethod::Squash => "squash",
            MergeMethod::Rebase => "rebase",
        }
    }
}

/// Review verdict. The REST `event` field takes the upper-case names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewEvent {
    Approve,
    RequestChanges,
    Comment,
}

impl ReviewEvent {
    pub fn api_name(self) -> &'static str {
        match self {
            ReviewEvent::Approve => "APPROVE",
            ReviewEvent::RequestChanges => "REQUEST_CHANGES",
            ReviewEvent::Comment => "COMMENT",
        }
    }
}

/// Request from the "New pull request" dialog. `body` and `draft` are optional
/// on the wire so a minimal caller can omit them.
#[derive(Debug, Clone, Deserialize)]
pub struct NewPull {
    pub title: String,
    pub head: String,
    pub base: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub draft: bool,
}
