//! One draft: build the prompt, ask the generator, clean the reply. Generic over
//! the generator so tests drive it with `FakeGenerator` and production with
//! `AnthropicGenerator`.

use crate::ai::generator::MessageGenerator;
use crate::ai::prompt::{build_user_message, DraftInput, SYSTEM_PROMPT};
use crate::error::{AppError, AppResult};

/// Asks `gen` for a commit message for `input` and returns it trimmed and
/// without a code fence. An empty answer is an error, so the UI never
/// overwrites the user's text with nothing.
pub async fn draft_message<G: MessageGenerator + Sync>(
    gen: &G,
    input: &DraftInput<'_>,
) -> AppResult<String> {
    let user = build_user_message(input);
    let raw = gen.generate(SYSTEM_PROMPT, &user).await?;
    finish_message(&raw)
}

/// Cleans a raw reply. The fence strip is a fallback: the system prompt forbids
/// fences, and if one still arrives it is removed rather than committed.
pub fn finish_message(raw: &str) -> AppResult<String> {
    let text = strip_code_fence(raw.trim()).trim();
    if text.is_empty() {
        return Err(AppError::Ai("The model returned an empty message".into()));
    }
    Ok(text.to_string())
}

/// Removes one wrapping ``` fence, with or without an info string such as
/// `text`. Text that does not start with a fence is returned unchanged.
pub fn strip_code_fence(text: &str) -> &str {
    let Some(after_open) = text.strip_prefix("```") else {
        return text;
    };
    let body = after_open.split_once('\n').map_or("", |(_, rest)| rest);
    match body.trim_end().strip_suffix("```") {
        Some(inner) => inner.trim_end(),
        None => body,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::generator::FakeGenerator;

    fn input<'a>(subjects: &'a [String]) -> DraftInput<'a> {
        DraftInput { stat: " a.rs | 1 +", diff: Some("+one"), recent_subjects: subjects }
    }

    #[tokio::test]
    async fn sends_the_system_prompt_and_the_built_user_message() {
        let fake = FakeGenerator::replying("fix: a");
        draft_message(&fake, &input(&[])).await.unwrap();
        let calls = fake.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, SYSTEM_PROMPT);
        assert!(calls[0].1.contains("+one"));
    }

    #[tokio::test]
    async fn returns_the_generated_message() {
        let fake = FakeGenerator::replying("  fix: null check\n\nBody.  \n");
        let msg = draft_message(&fake, &input(&[])).await.unwrap();
        assert_eq!(msg, "fix: null check\n\nBody.");
    }

    #[tokio::test]
    async fn a_generator_error_passes_through_unchanged() {
        let fake = FakeGenerator::failing("Invalid Anthropic API key");
        match draft_message(&fake, &input(&[])).await {
            Err(AppError::Ai(msg)) => assert_eq!(msg, "Invalid Anthropic API key"),
            other => panic!("expected the generator error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn an_empty_reply_is_an_error_not_a_blank_message() {
        let fake = FakeGenerator::replying("   ");
        assert!(draft_message(&fake, &input(&[])).await.is_err());
    }

    #[test]
    fn strips_a_fence_with_an_info_string() {
        assert_eq!(strip_code_fence("```text\nfix: x\n\nbody\n```"), "fix: x\n\nbody");
    }

    #[test]
    fn strips_a_bare_fence() {
        assert_eq!(strip_code_fence("```\nfix: x\n```"), "fix: x");
    }

    #[test]
    fn leaves_unfenced_text_alone() {
        assert_eq!(strip_code_fence("fix: x"), "fix: x");
    }

    #[test]
    fn an_unclosed_fence_loses_only_the_opening_line() {
        assert_eq!(strip_code_fence("```\nfix: x"), "fix: x");
    }

    #[test]
    fn finish_message_rejects_only_whitespace() {
        assert!(finish_message("```\n```").is_err());
    }
}
