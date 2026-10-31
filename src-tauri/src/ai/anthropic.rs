//! Anthropic Messages API over raw HTTP. The project has no official Rust
//! SDK, so the request and reply shapes are handled here and in `response`.
//! Model and effort choices: docs/specs/ai-commit-message.md "Contract".

use crate::ai::generator::MessageGenerator;
use crate::ai::response::parse_api_response;
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::time::Duration;

pub const ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
pub const MODEL: &str = "claude-opus-5-5";
pub const MAX_TOKENS: u32 = 4096;
const API_VERSION: &str = "2023-06-01";
const BETA: &str = "server-side-fallback-2026-07-01";
/// WHY 60 s: a commit message at low effort returns in seconds. A stalled
/// connection should fail and clear the spinner, not hang it.
const TIMEOUT: Duration = Duration::from_secs(60);

/// Holds the key for one generation. No `Debug` derive, so the key cannot
/// reach a log line by accident.
pub struct AnthropicGenerator {
    api_key: String,
    client: reqwest::Client,
}

impl AnthropicGenerator {
    pub fn new(api_key: String) -> AppResult<Self> {
        let client = reqwest::Client::builder()
            .timeout(TIMEOUT)
            .build()
            .map_err(|e| AppError::Ai(format!("Could not start the HTTP client: {e}")))?;
        Ok(Self { api_key, client })
    }
}

/// The request body. `temperature`, `top_p`, `top_k` and `thinking` are left
/// out on purpose: this model always thinks, and effort "low" keeps that
/// short. Sending sampling params would be rejected or ignored for it.
pub fn build_request_body(system: &str, user: &str) -> Value {
    json!({
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "fallbacks": "default",
        "output_config": { "effort": "low" },
        "system": system,
        "messages": [{ "role": "user", "content": user }],
    })
}

impl MessageGenerator for AnthropicGenerator {
    async fn generate(&self, system: &str, user: &str) -> AppResult<String> {
        let body = build_request_body(system, user);
        let resp = self
            .client
            .post(ENDPOINT)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
            .header("anthropic-beta", BETA)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Ai(format!("Could not reach Anthropic: {e}")))?;
        let status = resp.status().as_u16();
        let text = resp
            .text()
            .await
            .map_err(|e| AppError::Ai(format!("Could not read Anthropic's reply: {e}")))?;
        parse_api_response(status, &text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_uses_the_project_model_and_low_effort() {
        let body = build_request_body("sys", "usr");
        assert_eq!(body["model"], "claude-opus-5-5");
        assert_eq!(body["output_config"]["effort"], "low");
        assert_eq!(body["fallbacks"], "default");
        assert_eq!(body["max_tokens"], MAX_TOKENS);
    }

    #[test]
    fn request_carries_system_and_user_text_as_given() {
        let body = build_request_body("be brief", "diff here");
        assert_eq!(body["system"], "be brief");
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][0]["content"], "diff here");
    }

    #[test]
    fn request_never_sends_sampling_params_or_thinking() {
        let body = build_request_body("s", "u");
        for banned in ["temperature", "top_p", "top_k", "thinking"] {
            assert!(body.get(banned).is_none(), "{banned} must not be sent");
        }
    }
}
