use crate::error::{AppError, AppResult};
use crate::github::api;
use crate::github::types::{CreateRepoReq, GhOwner, OwnerKind};
use serde_json::json;
use super::validate::validate_name;

const USER_AGENT: &str = "gitbee/0.1";
const API_BASE: &str = "https://api.github.com";

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .expect("reqwest client")
}

/// `GET /repos/{owner}/{name}` — 404 means the name is free, 200 means
/// taken. Used by the modal's debounced availability indicator.
pub async fn check_name_available(token: &str, owner: &str, name: &str) -> AppResult<bool> {
    validate_name(name)?;
    let resp = client()
        .get(format!("{API_BASE}/repos/{owner}/{name}"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::GitHub(format!("check name: {e}")))?;
    match resp.status().as_u16() {
        200 => Ok(false),
        404 => Ok(true),
        401 => Err(AppError::GitHub("INSUFFICIENT_SCOPES: 401 from /repos check".into())),
        s => Err(AppError::GitHub(format!("/repos/{owner}/{name} returned {s}"))),
    }
}

/// List orgs the signed-in user can create repos in, plus the user
/// themselves. Filters out orgs where the user lacks repo-create
/// permission so the UI dropdown never offers a guaranteed 403.
pub async fn list_create_owners(token: &str) -> AppResult<Vec<GhOwner>> {
    let user = api::fetch_user(token).await?;
    let mut out = vec![GhOwner {
        login: user.login.clone(),
        avatar_url: user.avatar_url.clone(),
        kind: OwnerKind::User,
    }];
    let resp = client()
        .get(format!("{API_BASE}/user/orgs"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::GitHub(format!("list orgs: {e}")))?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::GitHub("INSUFFICIENT_SCOPES: /user/orgs 401".into()));
    }
    if !resp.status().is_success() {
        // Don't fail the whole listing for an org-listing hiccup — the
        // user can still create on their personal account.
        tracing::warn!("/user/orgs returned {}", resp.status());
        return Ok(out);
    }
    let orgs: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::GitHub(format!("orgs json: {e}")))?;
    let Some(arr) = orgs.as_array() else { return Ok(out); };
    for o in arr {
        let login = o["login"].as_str().unwrap_or_default().to_string();
        if login.is_empty() { continue; }
        let avatar_url = o["avatar_url"].as_str().unwrap_or_default().to_string();
        // Only include orgs where the user can actually create repos.
        // `members_can_create_repositories` on the org metadata is the
        // common gate; combined with admin role this is enough for v1.
        if can_create_in_org(token, &login, &user.login).await {
            out.push(GhOwner { login, avatar_url, kind: OwnerKind::Organization });
        }
    }
    Ok(out)
}

async fn can_create_in_org(token: &str, org: &str, user_login: &str) -> bool {
    // Admin members can always create.
    let role_url = format!("{API_BASE}/orgs/{org}/memberships/{user_login}");
    let role_resp = client()
        .get(&role_url)
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send().await;
    if let Ok(r) = role_resp {
        if r.status().is_success() {
            if let Ok(v) = r.json::<serde_json::Value>().await {
                if v["role"].as_str() == Some("admin") { return true; }
            }
        }
    }
    // Otherwise check the org-wide flag.
    let org_url = format!("{API_BASE}/orgs/{org}");
    let org_resp = client()
        .get(&org_url)
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send().await;
    if let Ok(r) = org_resp {
        if r.status().is_success() {
            if let Ok(v) = r.json::<serde_json::Value>().await {
                return v["members_can_create_repositories"].as_bool().unwrap_or(false);
            }
        }
    }
    false
}

#[derive(Debug, Clone)]
pub(super) struct CreateApiResp {
    pub(super) clone_url: String,
    pub(super) ssh_url: String,
    pub(super) html_url: String,
    pub(super) default_branch: String,
}

/// Call `POST /user/repos` (personal account) or `POST /orgs/{org}/repos`
/// (organization). Maps GitHub's error envelope to our sentinel
/// substrings (NAME_TAKEN / NAME_INVALID / INSUFFICIENT_SCOPES) so the
/// frontend can render targeted messages.
pub(super) async fn create_remote_repo(
    token: &str,
    req: &CreateRepoReq,
    owner_is_user: bool,
    auth_user_login: &str,
) -> AppResult<CreateApiResp> {
    validate_name(&req.name)?;
    let url = if owner_is_user {
        format!("{API_BASE}/user/repos")
    } else {
        format!("{API_BASE}/orgs/{}/repos", req.owner)
    };
    let body = json!({
        "name": req.name,
        "description": req.description.clone().unwrap_or_default(),
        "private": req.private,
        "auto_init": req.auto_init,
        "default_branch": req.default_branch,
    });
    let resp = client()
        .post(&url)
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::GitHub(format!("create repo: {e}")))?;
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::GitHub("INSUFFICIENT_SCOPES: 401 from create".into()));
    }
    if status == reqwest::StatusCode::FORBIDDEN {
        return Err(AppError::GitHub(format!(
            "INSUFFICIENT_SCOPES: 403 — token cannot create in '{}'",
            req.owner
        )));
    }
    if status == reqwest::StatusCode::UNPROCESSABLE_ENTITY {
        let txt = resp.text().await.unwrap_or_default();
        if txt.contains("name already exists on this account") || txt.contains("already exists") {
            return Err(AppError::GitHub(format!(
                "NAME_TAKEN: '{}/{}' already exists",
                req.owner, req.name
            )));
        }
        return Err(AppError::GitHub(format!(
            "NAME_INVALID: 422 from create '{}/{}': {}",
            req.owner, req.name, txt
        )));
    }
    if !status.is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(AppError::GitHub(format!("create repo {status}: {txt}")));
    }
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::GitHub(format!("create json: {e}")))?;
    // Sanity check: GitHub puts the repo under `owner.login` in the
    // response. If the user typed an org login that resolved to their
    // personal account silently, surface it.
    let returned_owner = v["owner"]["login"].as_str().unwrap_or_default();
    if !returned_owner.is_empty() && returned_owner != req.owner {
        tracing::warn!(
            "create returned owner '{}' but caller asked for '{}' (auth user: {})",
            returned_owner, req.owner, auth_user_login
        );
    }
    Ok(CreateApiResp {
        clone_url: v["clone_url"].as_str().unwrap_or_default().to_string(),
        ssh_url: v["ssh_url"].as_str().unwrap_or_default().to_string(),
        html_url: v["html_url"].as_str().unwrap_or_default().to_string(),
        default_branch: v["default_branch"]
            .as_str()
            .unwrap_or(&req.default_branch)
            .to_string(),
    })
}
