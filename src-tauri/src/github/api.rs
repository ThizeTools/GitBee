//! Thin reqwest wrappers over GitHub REST + GraphQL.

use crate::error::{AppError, AppResult};
use crate::github::types::{GhRepo, UserInfo};
use serde_json::json;

const USER_AGENT: &str = "gitbee/0.1";
const API_BASE: &str = "https://api.github.com";
const GQL_URL: &str = "https://api.github.com/graphql";

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .expect("reqwest client")
}

pub async fn fetch_user(token: &str) -> AppResult<UserInfo> {
    let resp = client()
        .get(format!("{API_BASE}/user"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send().await
        .map_err(|e| AppError::GitHub(format!("fetch user: {e}")))?;
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::GitHub("token unauthorized (401)".into()));
    }
    if !status.is_success() {
        return Err(AppError::GitHub(format!("/user returned {status}")));
    }
    let v: serde_json::Value = resp.json().await
        .map_err(|e| AppError::GitHub(format!("user json: {e}")))?;
    Ok(UserInfo {
        login: v["login"].as_str().unwrap_or_default().into(),
        name: v["name"].as_str().map(String::from),
        email: v["email"].as_str().map(String::from),
        avatar_url: v["avatar_url"].as_str().unwrap_or_default().into(),
    })
}

/// One-shot list of every repo the user can see across their personal
/// account AND their orgs. Optimized for the common case (few orgs, low
/// hundreds of repos) by issuing a single combined GraphQL query that
/// fetches viewer repos + each org's repos in one roundtrip. Falls back
/// to per-org paginated queries only when an org has more than 100 repos.
///
/// De-duplicated by `(owner, name)`. Hard cap 1500.
pub async fn list_repos(token: &str) -> AppResult<Vec<GhRepo>> {
    let mut out: Vec<GhRepo> = Vec::new();
    let mut seen: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();

    // Combined query: viewer's affiliated repos + viewer's orgs (with
    // first 100 repos each). One roundtrip covers most users.
    let combined = r#"
        query($vCursor: String) {
          viewer {
            repositories(
              first: 100,
              after: $vCursor,
              affiliations: [OWNER, COLLABORATOR],
              orderBy: {field: PUSHED_AT, direction: DESC}
            ) {
              nodes {
                name
                owner { login avatarUrl }
                isPrivate description sshUrl url
                defaultBranchRef { name }
                pushedAt
              }
              pageInfo { hasNextPage endCursor }
            }
            organizations(first: 50) {
              nodes {
                login
                repositories(first: 100, orderBy: {field: PUSHED_AT, direction: DESC}) {
                  nodes {
                    name
                    owner { login avatarUrl }
                    isPrivate description sshUrl url
                    defaultBranchRef { name }
                    pushedAt
                  }
                  pageInfo { hasNextPage endCursor }
                }
              }
            }
          }
        }
    "#;

    let body = json!({ "query": combined, "variables": { "vCursor": null } });
    let v = post_graphql(token, &body).await?;
    let viewer = &v["data"]["viewer"];

    // Viewer's own affiliated repos.
    let viewer_page = &viewer["repositories"];
    collect_repo_nodes(viewer_page, &mut out, &mut seen);
    let viewer_has_next = viewer_page["pageInfo"]["hasNextPage"].as_bool().unwrap_or(false);
    let viewer_cursor = viewer_page["pageInfo"]["endCursor"].as_str().map(String::from);

    // Per-org pages embedded in the same response.
    let mut orgs_to_paginate: Vec<(String, String)> = Vec::new(); // (login, endCursor)
    if let Some(org_nodes) = viewer["organizations"]["nodes"].as_array() {
        for org in org_nodes {
            let login = org["login"].as_str().unwrap_or_default().to_string();
            if login.is_empty() { continue; }
            let page = &org["repositories"];
            collect_repo_nodes(page, &mut out, &mut seen);
            if page["pageInfo"]["hasNextPage"].as_bool().unwrap_or(false) {
                if let Some(cur) = page["pageInfo"]["endCursor"].as_str() {
                    orgs_to_paginate.push((login, cur.to_string()));
                }
            }
        }
    }

    // Tail-paginate viewer + any orgs that overflowed the first page, in
    // parallel. Most users will skip this entirely.
    let token = token.to_string();
    let mut tasks = Vec::new();

    if viewer_has_next {
        let t = token.clone();
        let cursor = viewer_cursor;
        tasks.push(tokio::spawn(async move { tail_viewer(&t, cursor).await }));
    }
    for (org, cursor) in orgs_to_paginate {
        let t = token.clone();
        tasks.push(tokio::spawn(async move { tail_org(&t, &org, Some(cursor)).await }));
    }
    for task in tasks {
        if let Ok(Ok(extra)) = task.await {
            for r in extra {
                let key = (r.owner.clone(), r.name.clone());
                if seen.insert(key) {
                    out.push(r);
                    if out.len() >= 1500 { break; }
                }
            }
        }
    }

    out.sort_by(|a, b| b.pushed_at.cmp(&a.pushed_at));
    Ok(out)
}

async fn tail_viewer(token: &str, mut cursor: Option<String>) -> AppResult<Vec<GhRepo>> {
    let query = r#"
        query($cursor: String) {
          viewer {
            repositories(
              first: 100, after: $cursor,
              affiliations: [OWNER, COLLABORATOR],
              orderBy: {field: PUSHED_AT, direction: DESC}
            ) {
              nodes {
                name owner { login avatarUrl }
                isPrivate description sshUrl url
                defaultBranchRef { name } pushedAt
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
    "#;
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for _ in 0..14 {
        let body = json!({ "query": query, "variables": { "cursor": cursor } });
        let v = post_graphql(token, &body).await?;
        let page = &v["data"]["viewer"]["repositories"];
        collect_repo_nodes(page, &mut out, &mut seen);
        if !page["pageInfo"]["hasNextPage"].as_bool().unwrap_or(false) { break; }
        cursor = page["pageInfo"]["endCursor"].as_str().map(String::from);
    }
    Ok(out)
}

async fn tail_org(token: &str, org: &str, mut cursor: Option<String>) -> AppResult<Vec<GhRepo>> {
    let query = r#"
        query($org: String!, $cursor: String) {
          organization(login: $org) {
            repositories(
              first: 100, after: $cursor,
              orderBy: {field: PUSHED_AT, direction: DESC}
            ) {
              nodes {
                name owner { login avatarUrl }
                isPrivate description sshUrl url
                defaultBranchRef { name } pushedAt
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
    "#;
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for _ in 0..14 {
        let body = json!({
            "query": query,
            "variables": { "org": org, "cursor": cursor }
        });
        let v = match post_graphql(token, &body).await {
            Ok(v) => v,
            Err(e) => { tracing::warn!("tail_org {org}: {e}"); break; }
        };
        let page = &v["data"]["organization"]["repositories"];
        collect_repo_nodes(page, &mut out, &mut seen);
        if !page["pageInfo"]["hasNextPage"].as_bool().unwrap_or(false) { break; }
        cursor = page["pageInfo"]["endCursor"].as_str().map(String::from);
    }
    Ok(out)
}

fn collect_repo_nodes(
    page: &serde_json::Value,
    out: &mut Vec<GhRepo>,
    seen: &mut std::collections::HashSet<(String, String)>,
) {
    let nodes = page["nodes"].as_array().cloned().unwrap_or_default();
    for n in nodes {
        let owner = n["owner"]["login"].as_str().unwrap_or_default().to_string();
        let name = n["name"].as_str().unwrap_or_default().to_string();
        if owner.is_empty() || name.is_empty() { continue; }
        let key = (owner.clone(), name.clone());
        if !seen.insert(key) { continue; }
        let owner_avatar = n["owner"]["avatarUrl"].as_str().unwrap_or_default().to_string();
        let url = n["url"].as_str().unwrap_or_default().to_string();
        let ssh_url = n["sshUrl"].as_str().unwrap_or_default().to_string();
        let private = n["isPrivate"].as_bool().unwrap_or(false);
        let description = n["description"].as_str().map(String::from);
        let default_branch = n["defaultBranchRef"]["name"].as_str().map(String::from);
        let pushed_at = n["pushedAt"].as_str()
            .and_then(|s| chrono_iso_to_unix(s)).unwrap_or(0);
        let clone_url = format!("{url}.git");
        out.push(GhRepo {
            owner, owner_avatar, name, clone_url, ssh_url,
            private, description, default_branch, pushed_at,
        });
    }
}

async fn post_graphql(token: &str, body: &serde_json::Value) -> AppResult<serde_json::Value> {
    let resp = client()
        .post(GQL_URL)
        .bearer_auth(token)
        .json(body)
        .send().await
        .map_err(|e| AppError::GitHub(format!("graphql request: {e}")))?;
    let status = resp.status();
    if !status.is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(AppError::GitHub(format!("graphql {status}: {txt}")));
    }
    let v: serde_json::Value = resp.json().await
        .map_err(|e| AppError::GitHub(format!("graphql json: {e}")))?;
    if let Some(errs) = v.get("errors") {
        // Promote insufficient-scope errors to a sentinel string the
        // command layer can recognize and act on (clear stored token,
        // ask user to sign in again with the new scope set).
        let txt = errs.to_string();
        if txt.contains("INSUFFICIENT_SCOPES") {
            return Err(AppError::GitHub("INSUFFICIENT_SCOPES: token missing required scopes — sign out and sign in again to grant them".into()));
        }
        return Err(AppError::GitHub(format!("graphql errors: {errs}")));
    }
    Ok(v)
}

/// Build an HTTPS clone URL with the access token embedded so a one-shot
/// `git clone` works without touching the OS credential helper or git
/// config. The URL never leaks past the spawned git process — we don't
/// log it and git itself doesn't write it to .git/config (the saved
/// remote URL has the token stripped automatically by recent git, but
/// to be safe callers should rewrite the remote after clone).
pub fn authed_clone_url(clone_url: &str, token: &str) -> String {
    // clone_url looks like https://github.com/owner/repo.git
    if let Some(rest) = clone_url.strip_prefix("https://") {
        format!("https://x-access-token:{token}@{rest}")
    } else {
        clone_url.to_string()
    }
}

/// Convert "2024-04-30T12:34:56Z" → unix seconds. Returns None on parse
/// failure. Hand-rolled to avoid a chrono dep just for one timestamp.
fn chrono_iso_to_unix(s: &str) -> Option<i64> {
    // Format: YYYY-MM-DDTHH:MM:SSZ
    if s.len() < 20 { return None; }
    let y: i32 = s[0..4].parse().ok()?;
    let m: u32 = s[5..7].parse().ok()?;
    let d: u32 = s[8..10].parse().ok()?;
    let hh: u32 = s[11..13].parse().ok()?;
    let mm: u32 = s[14..16].parse().ok()?;
    let ss: u32 = s[17..19].parse().ok()?;
    Some(days_from_civil(y, m, d) * 86400 + (hh as i64) * 3600 + (mm as i64) * 60 + (ss as i64))
}

// Howard Hinnant's algorithm — civil date to days since 1970-01-01.
fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as i64;
    let doy: i64 = ((153 * (if m > 2 { m - 3 } else { m + 9 }) as i64 + 2) / 5)
        + (d as i64) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era as i64) * 146097 + doe - 719468
}
