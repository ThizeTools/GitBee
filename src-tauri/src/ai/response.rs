//! Turns one Messages API reply into the text GitBee shows, or into the error
//! the user should read. Pure: the status and stop-reason rules are tested on
//! JSON fixtures, never the network. Error shapes come from the API's
//! `{ "type": "error", "error": { "type", "message" } }` envelope.

use crate::error::{AppError, AppResult};
use serde_json::Value;

/// Returns the reply's text for a 2xx status, or the mapped error otherwise.
/// `body` is the raw response text, so a non-JSON body still yields a useful
/// error instead of a parser panic.
pub fn parse_api_response(status: u16, body: &str) -> AppResult<String> {
    if (200..300).contains(&status) {
        return parse_success(body);
    }
    Err(http_error(status, body))
}

fn parse_success(body: &str) -> AppResult<String> {
    let v: Value = serde_json::from_str(body).map_err(|e| {
        AppError::Ai(format!(
            "Anthropic's reply is not JSON ({e}); expected a Messages API object"
        ))
    })?;
    match v["stop_reason"].as_str() {
        Some("refusal") => Err(AppError::Ai(format!(
            "The model declined: {}",
            refusal_reason(&v)
        ))),
        // WHY a retry prompt, not a partial message: a cut-off message would
        // read as finished and could be committed by mistake.
        Some("max_tokens") => Err(AppError::Ai(
            "The message was cut off at the length limit. Try again.".into(),
        )),
        _ => text_of(&v),
    }
}

fn refusal_reason(v: &Value) -> String {
    let details = &v["stop_details"];
    details["explanation"]
        .as_str()
        .or_else(|| details["category"].as_str())
        .unwrap_or("no reason given")
        .to_string()
}

/// Joins the `text` blocks in order. Other block types (thinking, tool use)
/// are not part of the message.
fn text_of(v: &Value) -> AppResult<String> {
    let blocks = v["content"].as_array().ok_or_else(|| {
        AppError::Ai("Anthropic's reply has no content list; expected a content array".into())
    })?;
    let text: String = blocks
        .iter()
        .filter(|b| b["type"] == "text")
        .filter_map(|b| b["text"].as_str())
        .collect();
    if text.trim().is_empty() {
        return Err(AppError::Ai("The model returned no text".into()));
    }
    Ok(text)
}

fn http_error(status: u16, body: &str) -> AppError {
    match status {
        401 => AppError::Ai("Invalid Anthropic API key".into()),
        429 | 529 => AppError::Ai("Rate limited / overloaded, try again".into()),
        _ => AppError::Ai(
            error_message(body).unwrap_or_else(|| format!("Anthropic API returned HTTP {status}")),
        ),
    }
}

fn error_message(body: &str) -> Option<String> {
    let v: Value = serde_json::from_str(body).ok()?;
    v["error"]["message"].as_str().map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ai_message(result: AppResult<String>) -> String {
        match result {
            Err(AppError::Ai(msg)) => msg,
            other => panic!("expected an Ai error, got {other:?}"),
        }
    }

    #[test]
    fn joins_text_blocks_and_skips_other_block_types() {
        let body = r#"{"stop_reason":"end_turn","content":[
            {"type":"thinking","thinking":"hmm"},
            {"type":"text","text":"fix: null check"},
            {"type":"text","text":"\n\nBody line."}]}"#;
        assert_eq!(parse_api_response(200, body).unwrap(), "fix: null check\n\nBody line.");
    }

    #[test]
    fn empty_text_is_an_error() {
        let body = r#"{"stop_reason":"end_turn","content":[{"type":"text","text":"  "}]}"#;
        assert_eq!(ai_message(parse_api_response(200, body)), "The model returned no text");
    }

    #[test]
    fn refusal_names_the_explanation() {
        let body = r#"{"stop_reason":"refusal","stop_details":{"category":"x","explanation":"unsafe content"},"content":[]}"#;
        assert_eq!(
            ai_message(parse_api_response(200, body)),
            "The model declined: unsafe content"
        );
    }

    #[test]
    fn refusal_falls_back_to_the_category() {
        let body = r#"{"stop_reason":"refusal","stop_details":{"category":"policy"},"content":[]}"#;
        assert_eq!(ai_message(parse_api_response(200, body)), "The model declined: policy");
    }

    #[test]
    fn refusal_without_details_says_no_reason_given() {
        let body = r#"{"stop_reason":"refusal","content":[]}"#;
        assert_eq!(
            ai_message(parse_api_response(200, body)),
            "The model declined: no reason given"
        );
    }

    #[test]
    fn max_tokens_asks_for_a_retry() {
        let body = r#"{"stop_reason":"max_tokens","content":[{"type":"text","text":"fix: half"}]}"#;
        assert!(ai_message(parse_api_response(200, body)).contains("Try again"));
    }

    #[test]
    fn unauthorized_is_an_invalid_key_message() {
        let body = r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#;
        assert_eq!(ai_message(parse_api_response(401, body)), "Invalid Anthropic API key");
    }

    #[test]
    fn rate_limit_and_overload_share_one_retry_message() {
        for status in [429, 529] {
            assert_eq!(
                ai_message(parse_api_response(status, "{}")),
                "Rate limited / overloaded, try again"
            );
        }
    }

    #[test]
    fn other_status_shows_the_api_error_message() {
        let body = r#"{"type":"error","error":{"type":"invalid_request_error","message":"model not found"}}"#;
        assert_eq!(ai_message(parse_api_response(404, body)), "model not found");
    }

    #[test]
    fn other_status_without_a_message_names_the_status() {
        assert_eq!(
            ai_message(parse_api_response(500, "not json")),
            "Anthropic API returned HTTP 500"
        );
    }

    #[test]
    fn unreadable_success_body_names_the_expected_shape() {
        let msg = ai_message(parse_api_response(200, "<html>"));
        assert!(msg.contains("not JSON"));
        assert!(msg.contains("Messages API object"));
    }

    #[test]
    fn success_without_content_list_is_an_error() {
        let msg = ai_message(parse_api_response(200, r#"{"stop_reason":"end_turn"}"#));
        assert!(msg.contains("content array"));
    }
}
