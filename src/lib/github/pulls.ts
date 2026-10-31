// Pure formatting and validation for the pull-request view. No IO, no
// stores, so the bun tests cover every rule. The view and the actions call
// these; nothing here decides what happens, it only words and checks it.
// Spec: docs/specs/github-pull-requests.md.

import { formatRelativeDate } from "../graph/relativeDate";
import type { ChecksSummary, MergeMethod, NewPull, PullRow, ReviewEvent } from "./pullTypes";

const DECISION_LABELS: Record<string, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REVIEW_REQUIRED: "Review required",
};

const REVIEWER_STATE_LABELS: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};

/** Words GitHub's `reviewDecision`. Null means no review rule applies to the base branch. */
export function reviewDecisionLabel(decision: string | null): string {
  if (decision === null) return "No review rule";
  return DECISION_LABELS[decision] ?? decision.toLowerCase().replace(/_/g, " ");
}

/** Words one reviewer's latest review state, eg. "requested changes". */
export function reviewerStateLabel(state: string): string {
  return REVIEWER_STATE_LABELS[state] ?? state.toLowerCase().replace(/_/g, " ");
}

/** One line for the checks summary: failures first, then pending, passed, skipped. */
export function checksLabel(checks: ChecksSummary): string {
  const parts: string[] = [];
  if (checks.failed > 0) parts.push(`${checks.failed} failed`);
  if (checks.pending > 0) parts.push(`${checks.pending} pending`);
  if (checks.passed > 0) parts.push(`${checks.passed} passed`);
  if (checks.skipped > 0) parts.push(`${checks.skipped} skipped`);
  return parts.length > 0 ? parts.join(" · ") : "No checks";
}

export type ChecksTone = "bad" | "pending" | "good" | "none";

/** Colour class for the checks line: any failure is bad, then pending, then good. */
export function checksTone(checks: ChecksSummary): ChecksTone {
  if (checks.failed > 0) return "bad";
  if (checks.pending > 0) return "pending";
  if (checks.passed > 0) return "good";
  return "none";
}

export type PullBadge = "Draft" | "Open" | "Merged" | "Closed";

/** The status word on a row. A draft is shown as Draft only while it is open. */
export function pullBadge(pr: Pick<PullRow, "state" | "merged" | "draft">): PullBadge {
  if (pr.merged) return "Merged";
  if (pr.state === "closed") return "Closed";
  return pr.draft ? "Draft" : "Open";
}

export interface PullRowModel {
  numberLabel: string;
  title: string;
  author: string;
  badge: PullBadge;
  /** Head and base on one line, eg. "feature/login → main". */
  route: string;
  updated: string;
  crossRepo: boolean;
}

/** Everything one list row shows, as strings. `nowMs` is a parameter so tests pin the clock. */
export function pullRowModel(pr: PullRow, nowMs: number): PullRowModel {
  return {
    numberLabel: `#${pr.number}`,
    title: pr.title,
    author: pr.author,
    badge: pullBadge(pr),
    route: `${pr.head_ref} → ${pr.base_ref}`,
    updated: formatRelativeDate(pr.updated_at, nowMs),
    crossRepo: !pr.same_repo,
  };
}

/** Why a review cannot be sent yet, or null. Approve may be sent bare; the other two need text. */
export function reviewBodyError(event: ReviewEvent, body: string): string | null {
  if (event === "approve" || body.trim() !== "") return null;
  return event === "comment" ? "Write a comment for this review." : "Say which changes you want.";
}

/** Why a new pull request cannot be created yet, or null. Mirrors `validate_new_pull`. */
export function newPullError(req: Pick<NewPull, "title" | "head" | "base">): string | null {
  if (req.title.trim() === "") return "Enter a title.";
  if (req.head.trim() === "") return "Choose a head branch.";
  if (req.base.trim() === "") return "Enter a base branch.";
  if (req.head.trim() === req.base.trim()) return "Head and base must be different branches.";
  return null;
}

/** The three merge strategies, in the order the chooser shows them. */
export function mergeChoices(): { label: string; value: MergeMethod; description: string }[] {
  return [
    { label: "Create a merge commit", value: "merge", description: "Keeps every commit and adds a merge commit." },
    { label: "Squash and merge", value: "squash", description: "Joins all commits into one commit on the base branch." },
    { label: "Rebase and merge", value: "rebase", description: "Replays each commit onto the base branch, no merge commit." },
  ];
}

/**
 * The sign-in message for a token-scope failure, or null for any other error.
 * The backend clears the stored token on these (commands/github.rs
 * `settle_scoped`), so the view then shows the sign-in panel.
 */
export function scopeErrorMessage(err: unknown): string | null {
  const msg = String(err);
  if (msg.includes("GIST_SCOPE_MISSING")) return "Sign in again to grant gist access.";
  if (msg.includes("INSUFFICIENT_SCOPES")) {
    return "Token outdated. Sign in again to grant the new scopes.";
  }
  return null;
}

/** Words GitHub's `mergeable` flag. Null means GitHub has not finished computing it. */
export function mergeabilityLabel(mergeable: boolean | null): string {
  if (mergeable === true) return "Can be merged";
  if (mergeable === false) return "Has conflicts with the base branch";
  return "Mergeability not computed yet";
}

/**
 * A GitHub label colour as a CSS colour. GitHub sends six hex digits without '#'.
 * Anything else falls back to the muted foreground, so no text from the API can
 * reach the style attribute as CSS.
 */
export function labelCssColor(hex: string): string {
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex}` : "var(--fg-muted)";
}
