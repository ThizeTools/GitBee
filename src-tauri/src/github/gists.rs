//! "Share commit as gist": one `.patch` file posted to `POST /gists`. The
//! patch text comes from `git format-patch` (see `commands::github`). Spec:
//! `docs/specs/github-integration.md`, section "Gist sharing".

use crate::error::{AppError, AppResult};
use crate::github::api::{self, GithubApi, RestReply};
use reqwest::Method;
use serde_json::{json, Map, Value};

/// Marker in the error text that the command layer and the UI both look for.
/// A token without the `gist` scope cannot create gists.
pub const GIST_SCOPE_MISSING: &str = "GIST_SCOPE_MISSING";

/// The subject part of a file name stops here, so names stay readable.
const SLUG_MAX: usize = 50;

#[derive(Debug, Clone, PartialEq)]
pub struct GistReq {
    pub description: String,
    pub public: bool,
    pub file_name: String,
    pub content: String,
}

/// `<sha7>-<slug>.patch`, eg. `0a1b2c3-fix-login-redirect.patch`.
pub fn gist_file_name(sha: &str, subject: &str) -> String {
    let short: String = sha.chars().take(7).collect();
    format!("{short}-{}.patch", slugify(subject))
}

/// Lower-case ASCII words joined by '-'. Every other character, Unicode
/// included, becomes a separator. An empty result falls back to "commit".
pub fn slugify(subject: &str) -> String {
    let mut out = String::new();
    for c in subject.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let cut: String = out.trim_matches('-').chars().take(SLUG_MAX).collect();
    let cut = cut.trim_end_matches('-');
    if cut.is_empty() { "commit".to_string() } else { cut.to_string() }
}

/// The request for one commit: its patch as one file, named after the sha and
/// the subject. The subject is trimmed, so a trailing newline from git does not
/// reach the description or the file name.
pub fn patch_gist_request(sha: &str, subject: &str, public: bool, patch: &[u8]) -> GistReq {
    let subject = subject.trim();
    GistReq {
        description: subject.to_string(),
        public,
        file_name: gist_file_name(sha, subject),
        content: String::from_utf8_lossy(patch).into_owned(),
    }
}

/// The JSON body of `POST /gists`: one file, keyed by its name.
pub fn gist_body(req: &GistReq) -> Value {
    let mut files = Map::new();
    files.insert(req.file_name.clone(), json!({ "content": req.content }));
    json!({
        "description": req.description,
        "public": req.public,
        "files": files,
    })
}

/// Creates the gist and returns its `html_url`. A 401, 403 or 404 means the
/// token cannot create gists (no `gist` scope, or it was revoked). The error
/// names the scope and keeps GitHub's own answer, so a rate limit is not
/// mistaken for a scope problem.
pub async fn create_gist<A: GithubApi>(api: &A, req: &GistReq) -> AppResult<String> {
    let path = "/gists";
    let reply: RestReply = api.rest(Method::POST, path, Some(&gist_body(req))).await?;
    if matches!(reply.status.as_u16(), 401 | 403 | 404) {
        return Err(AppError::GitHub(format!(
            "{GIST_SCOPE_MISSING}: sign in again to grant gist access (GitHub answered {}: {})",
            reply.status,
            reply.body["message"].as_str().unwrap_or("no message"),
        )));
    }
    api::ensure_success(&Method::POST, path, &reply)?;
    gist_url(&reply.body)
}

fn gist_url(body: &Value) -> AppResult<String> {
    match body["html_url"].as_str() {
        Some(url) if !url.is_empty() => Ok(url.to_string()),
        _ => Err(AppError::GitHub(format!(
            "unexpected GitHub response: expected a gist with \"html_url\", got {}",
            body.to_string().chars().take(160).collect::<String>(),
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::fake_api::FakeGithubApi;

    fn req() -> GistReq {
        GistReq {
            description: "Fix login".into(),
            public: false,
            file_name: "0a1b2c3-fix-login.patch".into(),
            content: "From 0a1b2c3\n".into(),
        }
    }

    #[test]
    fn slugify_lowercases_and_joins_words_with_dashes() {
        assert_eq!(slugify("Fix Login Redirect!"), "fix-login-redirect");
    }

    #[test]
    fn slugify_collapses_runs_and_trims_edges() {
        assert_eq!(slugify("  --a___b//c--  "), "a-b-c");
    }

    #[test]
    fn slugify_falls_back_when_nothing_is_left() {
        assert_eq!(slugify("的 ?? "), "commit");
        assert_eq!(slugify(""), "commit");
    }

    #[test]
    fn slugify_cuts_long_subjects_without_a_trailing_dash() {
        let long = format!("{}-{}", "a".repeat(49), "bb");
        let s = slugify(&long);
        assert!(s.len() <= SLUG_MAX, "{s}");
        assert!(!s.ends_with('-'));
    }

    #[test]
    fn gist_file_name_uses_seven_char_sha_and_patch_suffix() {
        assert_eq!(
            gist_file_name("0a1b2c3d4e5f", "Fix login"),
            "0a1b2c3-fix-login.patch",
        );
    }

    #[test]
    fn gist_body_puts_one_file_under_its_name_with_visibility() {
        let body = gist_body(&req());
        assert_eq!(body["public"], false);
        assert_eq!(body["description"], "Fix login");
        assert_eq!(body["files"]["0a1b2c3-fix-login.patch"]["content"], "From 0a1b2c3\n");
        assert_eq!(body["files"].as_object().unwrap().len(), 1);
    }

    #[test]
    fn patch_gist_request_trims_the_subject_and_names_the_file() {
        let req = patch_gist_request("0a1b2c3d4e5f", "Fix login
", true, b"From 0a1b
");
        assert_eq!(req.description, "Fix login");
        assert_eq!(req.file_name, "0a1b2c3-fix-login.patch");
        assert_eq!(req.content, "From 0a1b
");
        assert!(req.public);
    }

    #[tokio::test]
    async fn create_gist_returns_the_html_url() {
        let api = FakeGithubApi::new().route(
            "POST /gists", 201,
            json!({ "html_url": "https://gist.github.com/octo/abc" }),
        );
        let url = create_gist(&api, &req()).await.unwrap();
        assert_eq!(url, "https://gist.github.com/octo/abc");
    }

    #[tokio::test]
    async fn create_gist_names_the_missing_scope_on_404() {
        let api = FakeGithubApi::new().route("POST /gists", 404, json!({"message": "Not Found"}));
        let err = create_gist(&api, &req()).await.unwrap_err().to_string();
        assert!(err.contains(GIST_SCOPE_MISSING), "{err}");
        assert!(err.contains("sign in again"), "{err}");
        assert!(err.contains("404"), "{err}");
    }

    #[tokio::test]
    async fn create_gist_keeps_rate_limit_text_visible() {
        let api = FakeGithubApi::new().route(
            "POST /gists", 403,
            json!({"message": "API rate limit exceeded"}),
        );
        let err = create_gist(&api, &req()).await.unwrap_err().to_string();
        assert!(err.contains("API rate limit exceeded"), "{err}");
    }

    #[tokio::test]
    async fn create_gist_rejects_a_reply_without_html_url() {
        let api = FakeGithubApi::new().route("POST /gists", 201, json!({"id": "x"}));
        let err = create_gist(&api, &req()).await.unwrap_err().to_string();
        assert!(err.contains("html_url"), "{err}");
    }
}
