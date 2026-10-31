import { describe, test, expect } from "bun:test";
import {
  checksLabel, checksTone, labelCssColor, mergeChoices, mergeabilityLabel, newPullError, pullBadge, pullRowModel,
  reviewBodyError, reviewDecisionLabel, reviewerStateLabel, scopeErrorMessage,
} from "./pulls";
import type { ChecksSummary, PullRow } from "./pullTypes";

const NOW_MS = Date.parse("2026-10-31T12:00:00Z");
const NOW_S = NOW_MS / 1000;

function row(overrides: Partial<PullRow> = {}): PullRow {
  return {
    number: 7, title: "Add login", state: "open", merged: false, draft: false,
    author: "octo", author_avatar: "", head_ref: "feature/login", head_sha: "abc1234",
    base_ref: "main", same_repo: true, updated_at: NOW_S - 3 * 3600, html_url: "",
    ...overrides,
  };
}

function checks(overrides: Partial<ChecksSummary> = {}): ChecksSummary {
  return { passed: 0, failed: 0, pending: 0, skipped: 0, runs: [], ...overrides };
}

describe("reviewDecisionLabel", () => {
  test("names each GitHub decision", () => {
    expect(reviewDecisionLabel("APPROVED")).toBe("Approved");
    expect(reviewDecisionLabel("CHANGES_REQUESTED")).toBe("Changes requested");
    expect(reviewDecisionLabel("REVIEW_REQUIRED")).toBe("Review required");
  });

  test("says when no review rule applies", () => {
    expect(reviewDecisionLabel(null)).toBe("No review rule");
  });

  test("turns an unknown decision into readable words", () => {
    expect(reviewDecisionLabel("SOMETHING_NEW")).toBe("something new");
  });
});

describe("reviewerStateLabel", () => {
  test("words each review state", () => {
    expect(reviewerStateLabel("APPROVED")).toBe("approved");
    expect(reviewerStateLabel("CHANGES_REQUESTED")).toBe("requested changes");
    expect(reviewerStateLabel("COMMENTED")).toBe("commented");
  });
});

describe("checksLabel and checksTone", () => {
  test("lists failures first and skips zero counts", () => {
    expect(checksLabel(checks({ failed: 2, pending: 1, passed: 5 }))).toBe("2 failed · 1 pending · 5 passed");
  });

  test("says No checks when nothing ran", () => {
    expect(checksLabel(checks())).toBe("No checks");
  });

  test("tone is bad on any failure, then pending, then good", () => {
    expect(checksTone(checks({ failed: 1, passed: 9 }))).toBe("bad");
    expect(checksTone(checks({ pending: 1, passed: 9 }))).toBe("pending");
    expect(checksTone(checks({ passed: 3 }))).toBe("good");
    expect(checksTone(checks({ skipped: 2 }))).toBe("none");
  });
});

describe("pullBadge", () => {
  test("a draft shows Draft only while open", () => {
    expect(pullBadge({ state: "open", merged: false, draft: true })).toBe("Draft");
    expect(pullBadge({ state: "open", merged: false, draft: false })).toBe("Open");
  });

  test("closed PRs show Merged or Closed", () => {
    expect(pullBadge({ state: "closed", merged: true, draft: false })).toBe("Merged");
    expect(pullBadge({ state: "closed", merged: false, draft: false })).toBe("Closed");
  });
});

describe("pullRowModel", () => {
  test("builds the strings a row shows", () => {
    const m = pullRowModel(row(), NOW_MS);
    expect(m.numberLabel).toBe("#7");
    expect(m.route).toBe("feature/login → main");
    expect(m.updated).toBe("3 h ago");
    expect(m.badge).toBe("Open");
    expect(m.crossRepo).toBe(false);
  });

  test("marks a fork's PR as cross-repo", () => {
    expect(pullRowModel(row({ same_repo: false }), NOW_MS).crossRepo).toBe(true);
  });
});

describe("reviewBodyError", () => {
  test("approve may go without text", () => {
    expect(reviewBodyError("approve", "")).toBeNull();
  });

  test("comment and request changes need text", () => {
    expect(reviewBodyError("comment", "   ")).toBe("Write a comment for this review.");
    expect(reviewBodyError("request_changes", "")).toBe("Say which changes you want.");
    expect(reviewBodyError("comment", "looks good")).toBeNull();
  });
});

describe("newPullError", () => {
  const ok = { title: "Add login", head: "feature/login", base: "main" };

  test("accepts a complete request", () => {
    expect(newPullError(ok)).toBeNull();
  });

  test("names the first missing field", () => {
    expect(newPullError({ ...ok, title: " " })).toBe("Enter a title.");
    expect(newPullError({ ...ok, head: "" })).toBe("Choose a head branch.");
    expect(newPullError({ ...ok, base: "" })).toBe("Enter a base branch.");
  });

  test("refuses head equal to base", () => {
    expect(newPullError({ ...ok, base: "feature/login" })).toBe("Head and base must be different branches.");
  });
});

describe("mergeChoices", () => {
  test("offers merge, squash and rebase in that order", () => {
    expect(mergeChoices().map((c) => c.value)).toEqual(["merge", "squash", "rebase"]);
  });
});

describe("scopeErrorMessage", () => {
  test("gist scope failure asks for gist access", () => {
    expect(scopeErrorMessage("GitHub: GIST_SCOPE_MISSING: sign in again")).toBe("Sign in again to grant gist access.");
  });

  test("insufficient scopes asks to sign in again", () => {
    expect(scopeErrorMessage("INSUFFICIENT_SCOPES: token missing")).toContain("Sign in again");
  });

  test("other errors are not scope errors", () => {
    expect(scopeErrorMessage("Pull Request is not mergeable")).toBeNull();
  });
});

describe("mergeabilityLabel", () => {
  test("says what GitHub computed, or that it is still computing", () => {
    expect(mergeabilityLabel(true)).toBe("Can be merged");
    expect(mergeabilityLabel(false)).toBe("Has conflicts with the base branch");
    expect(mergeabilityLabel(null)).toBe("Mergeability not computed yet");
  });
});

describe("labelCssColor", () => {
  test("turns six hex digits into a colour", () => {
    expect(labelCssColor("d73a4a")).toBe("#d73a4a");
  });

  test("refuses anything that is not six hex digits", () => {
    expect(labelCssColor("red; background: url(x)")).toBe("var(--fg-muted)");
    expect(labelCssColor("#d73a4a")).toBe("var(--fg-muted)");
    expect(labelCssColor("")).toBe("var(--fg-muted)");
  });
});
