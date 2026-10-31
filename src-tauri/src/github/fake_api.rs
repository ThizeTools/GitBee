//! Named test double for `api::GithubApi`. It replays canned replies keyed by
//! "METHOD /path?query" and records every call, so a test asserts both how
//! GitBee handles a reply and what request body it sent. Tests only; the
//! module is compiled out of release builds.

use crate::error::{AppError, AppResult};
use crate::github::api::{GithubApi, RestReply};
use reqwest::{Method, StatusCode};
use serde_json::{json, Value};
use std::sync::Mutex;

/// One recorded call: "METHOD /path" (or "POST /graphql") and its JSON body.
pub type SentCall = (String, Option<Value>);

pub struct FakeGithubApi {
    routes: Vec<(String, u16, Value)>,
    graphql_reply: Value,
    sent: Mutex<Vec<SentCall>>,
}

impl FakeGithubApi {
    pub fn new() -> Self {
        Self {
            routes: Vec::new(),
            graphql_reply: Value::Null,
            sent: Mutex::new(Vec::new()),
        }
    }

    /// Answers REST calls for `key` ("GET /repos/o/r/pulls?state=open") with
    /// `status` and `body`. A call with no route fails the test loudly.
    pub fn route(mut self, key: &str, status: u16, body: Value) -> Self {
        self.routes.push((key.to_string(), status, body));
        self
    }

    /// The reply to every GraphQL call.
    pub fn with_graphql(mut self, body: Value) -> Self {
        self.graphql_reply = body;
        self
    }

    /// Every call made so far, in order.
    pub fn sent(&self) -> Vec<SentCall> {
        self.sent.lock().expect("fake lock").clone()
    }

    fn record(&self, key: String, body: Option<Value>) {
        self.sent.lock().expect("fake lock").push((key, body));
    }
}

impl GithubApi for FakeGithubApi {
    async fn rest(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> AppResult<RestReply> {
        let key = format!("{method} {path}");
        self.record(key.clone(), body.cloned());
        let Some((_, status, reply)) = self.routes.iter().find(|(k, _, _)| *k == key) else {
            return Err(AppError::GitHub(format!("fake: no route for {key}")));
        };
        let status = StatusCode::from_u16(*status)
            .map_err(|e| AppError::GitHub(format!("fake: bad status for {key}: {e}")))?;
        Ok(RestReply { status, body: reply.clone() })
    }

    async fn graphql(&self, body: &Value) -> AppResult<Value> {
        self.record("POST /graphql".to_string(), Some(body.clone()));
        Ok(self.graphql_reply.clone())
    }
}

/// A pull request as the REST API returns it. `head_full` is the head repo's
/// `full_name` (None for a deleted fork). Base is acme/app on branch main.
pub fn pr_json(number: u64, head_full: Option<&str>) -> Value {
    json!({
        "number": number,
        "title": "Add login",
        "state": "open",
        "merged_at": null,
        "draft": true,
        "user": { "login": "octo", "avatar_url": "https://avatars.example/octo" },
        "head": {
            "ref": "feature/login",
            "sha": "0123456789abcdef0123456789abcdef01234567",
            "repo": head_full.map(|f| json!({ "full_name": f })).unwrap_or(Value::Null),
        },
        "base": { "ref": "main", "repo": { "full_name": "acme/app" } },
        "updated_at": "2026-10-30T12:00:00Z",
        "html_url": "https://github.com/acme/app/pull/7",
        "body": "Line one\nLine two",
        "labels": [{ "name": "bug", "color": "d73a4a" }],
        "additions": 12, "deletions": 3, "changed_files": 2,
        "mergeable": true, "mergeable_state": "clean",
    })
}

