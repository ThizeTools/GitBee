//! Device Flow for GitHub OAuth.
//!
//! Replaces the loopback Authorization Code flow because GitHub OAuth
//! Apps still require `client_secret` for the code-for-token exchange
//! (PKCE alone is not honored), and we don't want to embed a secret in
//! a desktop binary. Device Flow accepts only the public Client ID.
//!
//! UX:
//!   1. Backend POSTs `/login/device/code` → user_code, device_code,
//!      verification_uri, interval.
//!   2. Frontend shows the user_code prominently and opens the
//!      verification URL in the browser.
//!   3. Frontend long-polls `await_token`, which polls
//!      `/login/oauth/access_token` every `interval` seconds until
//!      GitHub returns a token (or the device_code expires).

use crate::error::{AppError, AppResult};
use serde::Deserialize;
use std::time::{Duration, Instant};

/// Hardcoded Client ID for the GitBee OAuth App. Public — checked in
/// intentionally. Device Flow uses Client ID only.
pub const CLIENT_ID: &str = "Ov23li9Byp22UMrMNVdb";

// `read:org` is required to enumerate the viewer's organizations and
// thus list org-owned repos. Without it the list silently misses orgs.
// `gist` is required for "Share as Gist". Tokens issued before it was added
// lack it; those users sign in again (see docs/specs/github-integration.md).
const SCOPES: &str = "repo read:user read:org gist";
const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";

const USER_AGENT: &str = "gitbee/0.1";

/// State that the OAuthRegistry holds between `start_flow` and
/// `await_token`. Just the device_code + polling cadence.
pub struct StartedFlow {
    pub user_code: String,
    pub verification_uri: String,
    pub device_code: String,
    pub interval: u64,
    pub expires_at: Instant,
}

/// Subset of /login/device/code response we care about.
#[derive(Debug, Deserialize)]
struct DeviceCodeResp {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

pub async fn start_flow() -> AppResult<StartedFlow> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| AppError::GitHub(format!("client: {e}")))?;
    let resp = client
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .form(&[("client_id", CLIENT_ID), ("scope", SCOPES)])
        .send().await
        .map_err(|e| AppError::GitHub(format!("device code request: {e}")))?;
    let status = resp.status();
    if !status.is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(AppError::GitHub(format!("device code {status}: {txt}")));
    }
    let body: DeviceCodeResp = resp.json().await
        .map_err(|e| AppError::GitHub(format!("device code json: {e}")))?;
    Ok(StartedFlow {
        user_code: body.user_code,
        verification_uri: body.verification_uri,
        device_code: body.device_code,
        interval: body.interval.max(1),
        expires_at: Instant::now() + Duration::from_secs(body.expires_in),
    })
}

#[derive(Debug, Deserialize)]
struct PollResp {
    #[serde(default)] access_token: Option<String>,
    #[serde(default)] error: Option<String>,
    #[serde(default)] error_description: Option<String>,
    #[serde(default)] interval: Option<u64>,
}

/// Block until GitHub authorizes the device or the device_code expires.
/// Returns the access token on success.
pub async fn await_token(mut flow: StartedFlow) -> AppResult<String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| AppError::GitHub(format!("client: {e}")))?;

    let mut interval = flow.interval;
    loop {
        if Instant::now() >= flow.expires_at {
            return Err(AppError::GitHub("device code expired (15 min)".into()));
        }
        tokio::time::sleep(Duration::from_secs(interval)).await;

        let resp = client
            .post(TOKEN_URL)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", CLIENT_ID),
                ("device_code", flow.device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send().await
            .map_err(|e| AppError::GitHub(format!("token poll: {e}")))?;

        let body: PollResp = resp.json().await
            .map_err(|e| AppError::GitHub(format!("token poll json: {e}")))?;

        if let Some(tok) = body.access_token { return Ok(tok); }

        match body.error.as_deref() {
            Some("authorization_pending") => continue,
            Some("slow_down") => {
                // Server tells us to back off — bump interval by 5s as
                // the spec recommends, plus honor any new interval the
                // server returned.
                interval = body.interval.unwrap_or(interval) + 5;
                flow.interval = interval;
                continue;
            }
            Some("expired_token") => return Err(AppError::GitHub("device code expired".into())),
            Some("access_denied") => return Err(AppError::GitHub("authorization denied by user".into())),
            Some(other) => {
                let desc = body.error_description.unwrap_or_default();
                return Err(AppError::GitHub(format!("github: {other} {desc}")));
            }
            None => return Err(AppError::GitHub("token poll returned no token and no error".into())),
        }
    }
}
