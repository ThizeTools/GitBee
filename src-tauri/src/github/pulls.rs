//! Pull requests on github.com: the calls that read and change PRs (list,
//! detail, reviews, checks, merge, review, create, branch lookup). Each call
//! goes through `api::GithubApi`, so tests replay canned replies. The JSON
//! handling lives in `pull_parse`. Spec: `docs/specs/github-pull-requests.md`.

use crate::error::{AppError, AppResult};
use crate::github::api::{self, rest_json, GithubApi};
use crate::github::pull_parse::*;
use crate::github::pull_types::*;
use reqwest::{Method, StatusCode};
use serde_json::json;


/// GraphQL for the fields REST does not give: the review decision, the latest
/// reviews, and the reviewers still asked. `last: 20` keeps the newest reviews.
const PR_REVIEW_QUERY: &str = r#"
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewDecision
      reviews(last: 20) { nodes { state author { login } } }
      reviewRequests(first: 20) {
        nodes { requestedReviewer { ... on User { login } ... on Team { name } } }
      }
    }
  }
}"#;

/// `GET /repos/{o}/{r}/pulls` for one state (`open` or `closed`), newest
/// updated first, 50 at most.
pub async fn list_pulls<A: GithubApi>(
    api: &A,
    owner: &str,
    repo: &str,
    state: &str,
) -> AppResult<Vec<PullRow>> {
    let state = checked_pull_state(state)?;
    let path = format!(
        "{}/pulls?state={state}&sort=updated&direction=desc&per_page=50",
        repo_path(owner, repo)?,
    );
    let v = rest_json(api, Method::GET, &path, None).await?;
    let items = v.as_array().ok_or_else(|| shape_error("an array of pull requests", &v))?;
    items.iter().map(parse_pull_row).collect()
}

/// Review decision and reviewers, from one GraphQL call.
pub async fn load_reviews<A: GithubApi>(
    api: &A,
    owner: &str,
    repo: &str,
    number: u64,
) -> AppResult<ReviewSummary> {
    repo_path(owner, repo)?;
    let body = json!({
        "query": PR_REVIEW_QUERY,
        "variables": { "owner": owner, "name": repo, "number": number },
    });
    let v = api.graphql(&body).await?;
    let pr = &v["data"]["repository"]["pullRequest"];
    if pr.is_null() {
        return Err(AppError::GitHub(format!("pull request {owner}/{repo}#{number} not found")));
    }
    Ok(parse_review_summary(pr))
}

/// Check runs of one commit, first 100.
pub async fn load_checks<A: GithubApi>(
    api: &A,
    owner: &str,
    repo: &str,
    sha: &str,
) -> AppResult<ChecksSummary> {
    let path = format!(
        "{}/commits/{}/check-runs?per_page=100",
        repo_path(owner, repo)?,
        checked_sha(sha)?,
    );
    let v = rest_json(api, Method::GET, &path, None).await?;
    Ok(summarize_checks(parse_check_runs(&v)?))
}

/// Full detail for the pane. The single-PR call comes first because the checks
/// need its head sha. Reviews and checks then load together.
pub async fn load_detail<A: GithubApi>(
    api: &A,
    owner: &str,
    repo: &str,
    number: u64,
) -> AppResult<PullDetail> {
    let path = format!("{}/pulls/{number}", repo_path(owner, repo)?);
    let pr = rest_json(api, Method::GET, &path, None).await?;
    let pull = parse_pull_row(&pr)?;
    let head_sha = pull.head_sha.clone();
    let (review, checks) = tokio::join!(
        load_reviews(api, owner, repo, number),
        load_checks(api, owner, repo, &head_sha),
    );
    let mut detail = detail_base(&pr, pull);
    detail.review = review?;
    detail.checks = checks?;
    Ok(detail)
}

/// `PUT /pulls/{n}/merge`. Returns the merge commit sha. The caller confirms
/// first: a merge writes to the base branch on GitHub.
pub async fn merge_pull<A: GithubApi>(
    api: &A,
    owner: &str,
    repo: &str,
    number: u64,
    method: MergeMethod,
) -> AppResult<String> {
    let path = format!("{}/pulls/{number}/merge", repo_path(owner, repo)?);
    let body = json!({ "merge_method": method.api_name() });
    let v = rest_json(api, Method::PUT, &path, Some(&body)).await?;
    Ok(str_of(&v, "sha"))
}

/// Posts a review. Approve, Request changes or Comment.
pub async fn submit_review<A: GithubApi>(
    api: &A,
    owner: &str,
    repo: &str,
    number: u64,
    event: ReviewEvent,
    body: &str,
) -> AppResult<()> {
    let path = format!("{}/pulls/{number}/reviews", repo_path(owner, repo)?);
    let payload = review_body(event, body)?;
    rest_json(api, Method::POST, &path, Some(&payload)).await?;
    Ok(())
}

/// `POST /repos/{o}/{r}/pulls`. Returns the new PR as a row.
pub async fn create_pull<A: GithubApi>(
    api: &A,
    owner: &str,
    repo: &str,
    req: &NewPull,
) -> AppResult<PullRow> {
    validate_new_pull(req)?;
    let path = format!("{}/pulls", repo_path(owner, repo)?);
    let body = json!({
        "title": req.title.trim(),
        "head": req.head,
        "base": req.base,
        "body": req.body,
        "draft": req.draft,
    });
    let v = rest_json(api, Method::POST, &path, Some(&body)).await?;
    parse_pull_row(&v)
}

/// True when `branch` exists on GitHub. `GET .../branches/{b}` answers 404 for
/// a missing branch, which is a "no", not an error.
pub async fn branch_on_remote<A: GithubApi>(
    api: &A,
    owner: &str,
    repo: &str,
    branch: &str,
) -> AppResult<bool> {
    let path = format!("{}/branches/{}", repo_path(owner, repo)?, checked_branch_name(branch)?);
    let reply = api.rest(Method::GET, &path, None).await?;
    if reply.status == StatusCode::NOT_FOUND {
        return Ok(false);
    }
    api::ensure_success(&Method::GET, &path, &reply)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::fake_api::{pr_json, FakeGithubApi};

    #[tokio::test]
    async fn list_pulls_sends_the_open_query_and_parses_rows() {
        let api = FakeGithubApi::new().route(
            "GET /repos/acme/app/pulls?state=open&sort=updated&direction=desc&per_page=50",
            200,
            json!([pr_json(7, Some("acme/app")), pr_json(8, Some("x/app"))]),
        );
        let rows = list_pulls(&api, "acme", "app", "open").await.unwrap();
        assert_eq!(rows.len(), 2);
        assert!(!rows[1].same_repo);
    }

    #[tokio::test]
    async fn load_detail_joins_pr_reviews_and_checks() {
        let api = FakeGithubApi::new()
            .route("GET /repos/acme/app/pulls/7", 200, pr_json(7, Some("acme/app")))
            .route(
                "GET /repos/acme/app/commits/0123456789abcdef0123456789abcdef01234567/check-runs?per_page=100",
                200,
                json!({ "check_runs": [{ "name": "ci", "status": "completed", "conclusion": "failure" }] }),
            )
            .with_graphql(json!({ "data": { "repository": { "pullRequest": {
                "reviewDecision": "APPROVED",
                "reviews": { "nodes": [{ "state": "APPROVED", "author": { "login": "bob" } }] },
                "reviewRequests": { "nodes": [] },
            }}}}));
        let d = load_detail(&api, "acme", "app", 7).await.unwrap();
        assert_eq!(d.pull.number, 7);
        assert_eq!(d.body, "Line one\nLine two");
        assert_eq!(d.labels[0].name, "bug");
        assert_eq!((d.additions, d.deletions, d.changed_files), (12, 3, 2));
        assert_eq!(d.review.decision.as_deref(), Some("APPROVED"));
        assert_eq!(d.checks.failed, 1);
        let sent = api.sent();
        assert!(sent.iter().any(|(k, _)| k == "POST /graphql"));
    }

    #[tokio::test]
    async fn merge_pull_sends_the_method_and_returns_the_sha() {
        let api = FakeGithubApi::new().route(
            "PUT /repos/acme/app/pulls/7/merge", 200,
            json!({ "sha": "feedface", "merged": true, "message": "ok" }),
        );
        let sha = merge_pull(&api, "acme", "app", 7, MergeMethod::Squash).await.unwrap();
        assert_eq!(sha, "feedface");
        let sent = api.sent();
        assert_eq!(sent[0].1.as_ref().unwrap()["merge_method"], "squash");
    }

    #[tokio::test]
    async fn merge_pull_surfaces_github_refusal_message() {
        let api = FakeGithubApi::new().route(
            "PUT /repos/acme/app/pulls/7/merge", 405,
            json!({ "message": "Pull Request is not mergeable" }),
        );
        let err = merge_pull(&api, "acme", "app", 7, MergeMethod::Merge).await.unwrap_err();
        assert!(err.to_string().contains("Pull Request is not mergeable"));
    }

    #[tokio::test]
    async fn submit_review_posts_the_event() {
        let api = FakeGithubApi::new().route("POST /repos/acme/app/pulls/7/reviews", 200, json!({}));
        submit_review(&api, "acme", "app", 7, ReviewEvent::Comment, "nice").await.unwrap();
        let sent = api.sent();
        assert_eq!(sent[0].1.as_ref().unwrap()["event"], "COMMENT");
    }

    #[tokio::test]
    async fn create_pull_posts_trimmed_title_and_parses_the_row() {
        let api = FakeGithubApi::new().route("POST /repos/acme/app/pulls", 201, pr_json(9, Some("acme/app")));
        let req = NewPull { title: "  Add login ".into(), head: "feature/login".into(), base: "main".into(), body: "b".into(), draft: true };
        let row = create_pull(&api, "acme", "app", &req).await.unwrap();
        assert_eq!(row.number, 9);
        let sent = api.sent();
        assert_eq!(sent[0].1.as_ref().unwrap()["title"], "Add login");
        assert_eq!(sent[0].1.as_ref().unwrap()["draft"], true);
    }

    #[tokio::test]
    async fn branch_on_remote_is_false_for_404_and_true_for_200() {
        let api = FakeGithubApi::new()
            .route("GET /repos/acme/app/branches/gone", 404, json!({"message": "Branch not found"}))
            .route("GET /repos/acme/app/branches/feature/login", 200, json!({"name": "feature/login"}));
        assert!(!branch_on_remote(&api, "acme", "app", "gone").await.unwrap());
        assert!(branch_on_remote(&api, "acme", "app", "feature/login").await.unwrap());
    }

    #[tokio::test]
    async fn branch_on_remote_reports_other_failures() {
        let api = FakeGithubApi::new()
            .route("GET /repos/acme/app/branches/x", 500, json!({"message": "boom"}));
        assert!(branch_on_remote(&api, "acme", "app", "x").await.is_err());
    }
}
