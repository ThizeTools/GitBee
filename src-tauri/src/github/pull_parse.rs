//! Pure side of pull requests: validates inputs, parses GitHub JSON into the
//! shapes in `pull_types`, and summarizes check runs. No I/O, so every rule is
//! tested on JSON fixtures. Spec: `docs/specs/github-pull-requests.md`.

use crate::error::{AppError, AppResult};
use crate::github::api::chrono_iso_to_unix;
use crate::github::pull_types::*;
use serde_json::{json, Value};


/// Owner and repo go into URL paths, so only GitHub's own name characters
/// pass. `.` and `..` are rejected because they would change the path.
pub fn repo_path(owner: &str, repo: &str) -> AppResult<String> {
    if !is_name_segment(owner) || !is_name_segment(repo) {
        return Err(AppError::GitHub(format!(
            "invalid GitHub repository {owner:?}/{repo:?}: expected letters, digits, '-', '_' or '.'"
        )));
    }
    Ok(format!("/repos/{owner}/{repo}"))
}

fn is_name_segment(s: &str) -> bool {
    !s.is_empty()
        && s != "."
        && s != ".."
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// A commit sha for a URL path: 4 to 40 hex digits.
pub fn checked_sha(sha: &str) -> AppResult<&str> {
    if sha.len() < 4 || sha.len() > 40 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::GitHub(format!("invalid commit sha {sha:?}: expected 4-40 hex digits")));
    }
    Ok(sha)
}

/// A branch name from user input. Git's own rules, reduced to what this code
/// needs: no leading '-' (option injection), no ':' (refspec separator), and
/// none of the characters git refuses in a ref name.
pub fn checked_branch_name(name: &str) -> AppResult<&str> {
    let bad = name.is_empty()
        || name.starts_with('-')
        || name.contains("..")
        || name.contains("@{")
        || name.chars().any(|c| c.is_whitespace() || c.is_control() || "~^:?*[\\".contains(c));
    if bad {
        return Err(AppError::GitHub(format!("invalid branch name {name:?}")));
    }
    Ok(name)
}

/// The error for a response whose JSON lacks what GitBee needs. Names the
/// expected shape and quotes a prefix of the offending JSON.
pub fn shape_error(expected: &str, v: &Value) -> AppError {
    let text: String = v.to_string().chars().take(160).collect();
    AppError::GitHub(format!("unexpected GitHub response: expected {expected}, got {text}"))
}

pub fn str_of(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or_default().to_string()
}

/// One pull request from REST JSON. Works for both the list and the single-PR
/// endpoint, since the fields it reads are the same in both.
pub fn parse_pull_row(v: &Value) -> AppResult<PullRow> {
    let number = v["number"].as_u64()
        .ok_or_else(|| shape_error("a pull request with a numeric \"number\"", v))?;
    let same_repo = same_full_name(&v["head"]["repo"], &v["base"]["repo"]);
    Ok(PullRow {
        number,
        title: str_of(v, "title"),
        state: str_of(v, "state"),
        merged: v["merged"].as_bool().unwrap_or(v["merged_at"].is_string()),
        draft: v["draft"].as_bool().unwrap_or(false),
        author: str_of(&v["user"], "login"),
        author_avatar: str_of(&v["user"], "avatar_url"),
        head_ref: str_of(&v["head"], "ref"),
        head_sha: str_of(&v["head"], "sha"),
        base_ref: str_of(&v["base"], "ref"),
        same_repo,
        updated_at: v["updated_at"].as_str().and_then(chrono_iso_to_unix).unwrap_or(0),
        html_url: str_of(v, "html_url"),
    })
}

/// True when both repos exist and have the same `full_name`. A null repo (a
/// deleted fork) is not the same repo.
fn same_full_name(head_repo: &Value, base_repo: &Value) -> bool {
    match (head_repo["full_name"].as_str(), base_repo["full_name"].as_str()) {
        (Some(h), Some(b)) => h.eq_ignore_ascii_case(b),
        _ => false,
    }
}

pub fn checked_pull_state(state: &str) -> AppResult<&str> {
    match state {
        "open" | "closed" => Ok(state),
        other => Err(AppError::GitHub(format!("invalid pull request state {other:?}: expected open or closed"))),
    }
}

/// Labels, sizes and mergeability. Only the single-PR endpoint returns these.
pub fn detail_base(pr: &Value, pull: PullRow) -> PullDetail {
    PullDetail {
        body: str_of(pr, "body"),
        labels: parse_labels(&pr["labels"]),
        additions: pr["additions"].as_u64().unwrap_or(0),
        deletions: pr["deletions"].as_u64().unwrap_or(0),
        changed_files: pr["changed_files"].as_u64().unwrap_or(0),
        mergeable: pr["mergeable"].as_bool(),
        mergeable_state: pr["mergeable_state"].as_str().map(String::from),
        review: ReviewSummary::default(),
        checks: ChecksSummary::default(),
        pull,
    }
}

fn parse_labels(v: &Value) -> Vec<PullLabel> {
    let Some(items) = v.as_array() else { return Vec::new() };
    items
        .iter()
        .map(|l| PullLabel { name: str_of(l, "name"), color: str_of(l, "color") })
        .collect()
}

/// The `nodes` of a GraphQL connection, or an empty slice when absent.
fn nodes(conn: &Value) -> &[Value] {
    conn["nodes"].as_array().map(Vec::as_slice).unwrap_or(&[])
}

/// Reads `data.repository.pullRequest` from `PR_REVIEW_QUERY` (the node, not
/// the response envelope).
pub fn parse_review_summary(pr: &Value) -> ReviewSummary {
    let requested = nodes(&pr["reviewRequests"])
        .iter()
        .filter_map(|n| reviewer_name(&n["requestedReviewer"]))
        .collect();
    ReviewSummary {
        decision: pr["reviewDecision"].as_str().map(String::from),
        reviewers: latest_per_reviewer(&pr["reviews"]),
        requested,
    }
}

/// One entry per reviewer, holding the state of their latest review. GitHub
/// lists reviews oldest first, so a later review replaces the earlier state.
/// Pending reviews belong to the viewer alone and are skipped.
fn latest_per_reviewer(reviews: &Value) -> Vec<ReviewerState> {
    let mut reviewers: Vec<ReviewerState> = Vec::new();
    for node in nodes(reviews) {
        let login = str_of(&node["author"], "login");
        let state = str_of(node, "state");
        if login.is_empty() || state == "PENDING" {
            continue;
        }
        match reviewers.iter_mut().find(|r| r.login == login) {
            Some(r) => r.state = state,
            None => reviewers.push(ReviewerState { login, state }),
        }
    }
    reviewers
}

/// A user's login, or a team's name for a team review request.
fn reviewer_name(v: &Value) -> Option<String> {
    v["login"].as_str().or_else(|| v["name"].as_str()).map(String::from)
}

/// Which summary count a check run falls in. Cancelled runs count as failed:
/// GitHub shows them as stopped checks that did not pass. A run that has not
/// completed is pending, whatever its conclusion field says.
pub fn bucket(status: &str, conclusion: Option<&str>) -> CheckBucket {
    if status != "completed" {
        return CheckBucket::Pending;
    }
    match conclusion {
        Some("success") => CheckBucket::Passed,
        Some("failure" | "timed_out" | "cancelled" | "action_required" | "startup_failure") => {
            CheckBucket::Failed
        }
        _ => CheckBucket::Skipped,
    }
}

/// Counts the runs by bucket and keeps the runs for the list.
pub fn summarize_checks(runs: Vec<CheckRun>) -> ChecksSummary {
    let mut s = ChecksSummary::default();
    for r in &runs {
        match bucket(&r.status, r.conclusion.as_deref()) {
            CheckBucket::Passed => s.passed += 1,
            CheckBucket::Failed => s.failed += 1,
            CheckBucket::Pending => s.pending += 1,
            CheckBucket::Skipped => s.skipped += 1,
        }
    }
    s.runs = runs;
    s
}

/// Reads the `check_runs` array of `GET .../check-runs`.
pub fn parse_check_runs(v: &Value) -> AppResult<Vec<CheckRun>> {
    let items = v["check_runs"].as_array()
        .ok_or_else(|| shape_error("an object with a \"check_runs\" array", v))?;
    Ok(items
        .iter()
        .map(|r| CheckRun {
            name: str_of(r, "name"),
            status: str_of(r, "status"),
            conclusion: r["conclusion"].as_str().map(String::from),
            html_url: r["html_url"].as_str().map(String::from),
        })
        .collect())
}

/// Request body for `POST /pulls/{n}/reviews`. GitHub refuses a COMMENT or
/// REQUEST_CHANGES review without text, so the backend checks that too and
/// does not rely on the UI.
pub fn review_body(event: ReviewEvent, body: &str) -> AppResult<Value> {
    let text = body.trim();
    if event != ReviewEvent::Approve && text.is_empty() {
        return Err(AppError::GitHub(format!(
            "a {} review needs a comment, got an empty one",
            event.api_name(),
        )));
    }
    let mut v = json!({ "event": event.api_name() });
    if !text.is_empty() {
        v["body"] = json!(text);
    }
    Ok(v)
}

/// Refuses a request GitHub would reject, before any network call.
pub fn validate_new_pull(req: &NewPull) -> AppResult<()> {
    if req.title.trim().is_empty() {
        return Err(AppError::GitHub("pull request title is empty".into()));
    }
    checked_branch_name(&req.head)?;
    checked_branch_name(&req.base)?;
    if req.head == req.base {
        return Err(AppError::GitHub(format!(
            "head and base are both {:?}; a pull request needs two different branches",
            req.head,
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::fake_api::pr_json;

    #[test]
    fn parse_pull_row_reads_the_list_fields() {
        let row = parse_pull_row(&pr_json(7, Some("acme/app"))).unwrap();
        assert_eq!(row.number, 7);
        assert_eq!(row.head_ref, "feature/login");
        assert_eq!(row.base_ref, "main");
        assert!(row.same_repo);
        assert!(row.draft);
        assert!(!row.merged);
        assert_eq!(row.author, "octo");
        // 2026-10-30T12:00:00Z in unix seconds.
        assert_eq!(row.updated_at, 1_793_361_600);
    }

    #[test]
    fn parse_pull_row_marks_a_fork_as_not_same_repo() {
        let row = parse_pull_row(&pr_json(7, Some("someone/app"))).unwrap();
        assert!(!row.same_repo);
    }

    #[test]
    fn parse_pull_row_treats_a_deleted_fork_as_not_same_repo() {
        let row = parse_pull_row(&pr_json(7, None)).unwrap();
        assert!(!row.same_repo);
    }

    #[test]
    fn parse_pull_row_names_the_shape_when_number_is_missing() {
        let err = parse_pull_row(&json!({"title": "x"})).unwrap_err();
        let text = err.to_string();
        assert!(text.contains("numeric \"number\""), "{text}");
        assert!(text.contains("\"title\""), "{text}");
    }

    #[test]
    fn repo_path_accepts_github_names_and_rejects_path_tricks() {
        assert_eq!(repo_path("acme", "my-app.v2").unwrap(), "/repos/acme/my-app.v2");
        assert!(repo_path("..", "app").is_err());
        assert!(repo_path("acme", "a/b").is_err());
        assert!(repo_path("acme", "a?x=1").is_err());
        assert!(repo_path("", "app").is_err());
    }

    #[test]
    fn checked_sha_accepts_hex_only() {
        assert!(checked_sha("abcd").is_ok());
        assert!(checked_sha("abc").is_err());
        assert!(checked_sha("zzzz").is_err());
        assert!(checked_sha("abcd/../x").is_err());
    }

    #[test]
    fn checked_branch_name_follows_git_ref_rules() {
        assert!(checked_branch_name("feature/login").is_ok());
        assert!(checked_branch_name("release-1.2_x").is_ok());
        assert!(checked_branch_name("-rf").is_err());
        assert!(checked_branch_name("a..b").is_err());
        assert!(checked_branch_name("a:b").is_err());
        assert!(checked_branch_name("a b").is_err());
        assert!(checked_branch_name("").is_err());
    }

    #[test]
    fn parse_review_summary_keeps_the_latest_state_per_reviewer() {
        let pr = json!({
            "reviewDecision": "CHANGES_REQUESTED",
            "reviews": { "nodes": [
                { "state": "CHANGES_REQUESTED", "author": { "login": "ann" } },
                { "state": "APPROVED", "author": { "login": "bob" } },
                { "state": "APPROVED", "author": { "login": "ann" } },
                { "state": "PENDING", "author": { "login": "me" } },
            ]},
            "reviewRequests": { "nodes": [
                { "requestedReviewer": { "login": "cat" } },
                { "requestedReviewer": { "name": "core-team" } },
            ]},
        });
        let s = parse_review_summary(&pr);
        assert_eq!(s.decision.as_deref(), Some("CHANGES_REQUESTED"));
        assert_eq!(s.reviewers, vec![
            ReviewerState { login: "ann".into(), state: "APPROVED".into() },
            ReviewerState { login: "bob".into(), state: "APPROVED".into() },
        ]);
        assert_eq!(s.requested, vec!["cat".to_string(), "core-team".to_string()]);
    }

    #[test]
    fn parse_review_summary_is_empty_without_reviews() {
        let s = parse_review_summary(&json!({ "reviewDecision": null }));
        assert_eq!(s, ReviewSummary::default());
    }

    #[test]
    fn bucket_maps_status_and_conclusion() {
        assert_eq!(bucket("in_progress", None), CheckBucket::Pending);
        assert_eq!(bucket("completed", Some("success")), CheckBucket::Passed);
        assert_eq!(bucket("completed", Some("failure")), CheckBucket::Failed);
        assert_eq!(bucket("completed", Some("cancelled")), CheckBucket::Failed);
        assert_eq!(bucket("completed", Some("neutral")), CheckBucket::Skipped);
        assert_eq!(bucket("completed", Some("skipped")), CheckBucket::Skipped);
        assert_eq!(bucket("completed", None), CheckBucket::Skipped);
    }

    fn run(status: &str, conclusion: Option<&str>) -> CheckRun {
        CheckRun {
            name: "ci".into(),
            status: status.into(),
            conclusion: conclusion.map(String::from),
            html_url: None,
        }
    }

    #[test]
    fn summarize_checks_counts_each_bucket() {
        let s = summarize_checks(vec![
            run("completed", Some("success")),
            run("completed", Some("success")),
            run("completed", Some("timed_out")),
            run("queued", None),
            run("completed", Some("skipped")),
        ]);
        assert_eq!((s.passed, s.failed, s.pending, s.skipped), (2, 1, 1, 1));
        assert_eq!(s.runs.len(), 5);
    }

    #[test]
    fn parse_check_runs_reads_the_array() {
        let v = json!({ "total_count": 1, "check_runs": [
            { "name": "build", "status": "completed", "conclusion": "success",
              "html_url": "https://github.com/acme/app/runs/1" },
        ]});
        let runs = parse_check_runs(&v).unwrap();
        assert_eq!(runs[0].name, "build");
        assert_eq!(runs[0].conclusion.as_deref(), Some("success"));
    }

    #[test]
    fn parse_check_runs_names_the_shape_when_the_array_is_missing() {
        let err = parse_check_runs(&json!({"total_count": 0})).unwrap_err();
        assert!(err.to_string().contains("check_runs"));
    }

    #[test]
    fn review_body_requires_text_for_comment_and_request_changes() {
        assert!(review_body(ReviewEvent::Comment, "  ").is_err());
        assert!(review_body(ReviewEvent::RequestChanges, "").is_err());
        let v = review_body(ReviewEvent::RequestChanges, " fix the test ").unwrap();
        assert_eq!(v["event"], "REQUEST_CHANGES");
        assert_eq!(v["body"], "fix the test");
    }

    #[test]
    fn review_body_omits_text_for_a_bare_approve() {
        let v = review_body(ReviewEvent::Approve, "").unwrap();
        assert_eq!(v["event"], "APPROVE");
        assert!(v.get("body").is_none());
    }

    #[test]
    fn merge_method_names_match_the_rest_api() {
        assert_eq!(MergeMethod::Merge.api_name(), "merge");
        assert_eq!(MergeMethod::Squash.api_name(), "squash");
        assert_eq!(MergeMethod::Rebase.api_name(), "rebase");
    }

    #[test]
    fn validate_new_pull_refuses_empty_title_and_equal_branches() {
        let base = NewPull { title: " ".into(), head: "f".into(), base: "main".into(), body: String::new(), draft: false };
        assert!(validate_new_pull(&base).is_err());
        let same = NewPull { title: "t".into(), head: "main".into(), base: "main".into(), body: String::new(), draft: false };
        assert!(validate_new_pull(&same).is_err());
        let ok = NewPull { title: "t".into(), head: "f".into(), base: "main".into(), body: String::new(), draft: true };
        assert!(validate_new_pull(&ok).is_ok());
    }

    #[test]
    fn checked_pull_state_accepts_only_open_or_closed() {
        assert!(checked_pull_state("open").is_ok());
        assert!(checked_pull_state("all").is_err());
    }

}
