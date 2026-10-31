// Shapes returned by the pull-request commands. They mirror
// src-tauri/src/github/pull_types.rs (serde keeps snake_case field names).
// Spec: docs/specs/github-pull-requests.md.

export interface PullRow {
  number: number;
  title: string;
  state: "open" | "closed";
  merged: boolean;
  draft: boolean;
  author: string;
  author_avatar: string;
  head_ref: string;
  head_sha: string;
  base_ref: string;
  /** False for a fork's PR and for a PR whose head repo was deleted. */
  same_repo: boolean;
  /** Unix seconds. */
  updated_at: number;
  html_url: string;
}

export interface PullLabel {
  name: string;
  color: string;
}

export interface ReviewerState {
  login: string;
  /** APPROVED, CHANGES_REQUESTED, COMMENTED or DISMISSED. */
  state: string;
}

export interface ReviewSummary {
  /** GitHub's reviewDecision; null when no review rule applies. */
  decision: string | null;
  reviewers: ReviewerState[];
  requested: string[];
}

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string | null;
}

export interface ChecksSummary {
  passed: number;
  failed: number;
  pending: number;
  skipped: number;
  runs: CheckRun[];
}

export interface PullDetail extends PullRow {
  body: string;
  labels: PullLabel[];
  additions: number;
  deletions: number;
  changed_files: number;
  mergeable: boolean | null;
  mergeable_state: string | null;
  review: ReviewSummary;
  checks: ChecksSummary;
}

export type MergeMethod = "merge" | "squash" | "rebase";
export type ReviewEvent = "approve" | "request_changes" | "comment";

/** Body of `github_create_pull`. */
export interface NewPull {
  title: string;
  head: string;
  base: string;
  body: string;
  draft: boolean;
}
