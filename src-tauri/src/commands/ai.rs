//! Tauri commands for AI commit messages. Spec: docs/specs/ai-commit-message.md.
//! Each command gathers staged git output, checks the key, and hands both to
//! `ai::draft`. The key is read here and never returned to the frontend.

use crate::ai::anthropic::AnthropicGenerator;
use crate::ai::draft::draft_message;
use crate::ai::key;
use crate::ai::limits::check_diff_size;
use crate::ai::prompt::DraftInput;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::State;

/// `--no-ext-diff` stops a user's `diff.external` tool from replacing the text
/// the model reads. `--no-color` keeps escape codes out of the prompt.
const STAT_ARGS: [&str; 5] = ["diff", "--cached", "--no-color", "--no-ext-diff", "--stat"];
const DIFF_ARGS: [&str; 6] = ["diff", "--cached", "--no-color", "--no-ext-diff", "-U3", "--"];
const RECENT_LOG_ARGS: [&str; 3] = ["log", "-10", "--format=%s"];
const RECENT_SUBJECT_COUNT: usize = 10;

#[tauri::command]
pub async fn ai_commit_message(path: String, state: State<'_, AppState>) -> AppResult<String> {
    let gen = anthropic_generator()?;
    let repo = PathBuf::from(&path);
    let stat = staged_stat(&state, &repo).await?;
    let diff = staged_text(&state, &repo, &DIFF_ARGS).await?;
    if diff.trim().is_empty() {
        return Err(AppError::Ai("Stage changes first".into()));
    }
    check_diff_size(diff.len())?;
    let subjects = recent_subjects(&state, &repo).await;
    tracing::info!(bytes = diff.len(), mode = "diff", "ai commit message requested");
    let input = DraftInput { stat: &stat, diff: Some(&diff), recent_subjects: &subjects };
    draft_message(&gen, &input).await
}

/// The "file summary only" path the UI offers when the full diff is too large.
/// Sends `--stat` only, which names every changed file and its size, and never
/// the patch text.
#[tauri::command]
pub async fn ai_commit_message_from_stat(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let gen = anthropic_generator()?;
    let repo = PathBuf::from(&path);
    let stat = staged_stat(&state, &repo).await?;
    let subjects = recent_subjects(&state, &repo).await;
    tracing::info!(mode = "stat", "ai commit message requested");
    let input = DraftInput { stat: &stat, diff: None, recent_subjects: &subjects };
    draft_message(&gen, &input).await
}

#[tauri::command]
pub async fn ai_key_status() -> AppResult<bool> {
    key::status(&key::os_store())
}

/// Saves the key in the OS store. The value is never logged, and a failure
/// message does not echo it (`ai::key::save`).
#[tauri::command]
pub async fn ai_key_save(key: String) -> AppResult<()> {
    key::save(&key::os_store(), &key)
}

#[tauri::command]
pub async fn ai_key_clear() -> AppResult<()> {
    key::clear(&key::os_store())
}

fn anthropic_generator() -> AppResult<AnthropicGenerator> {
    AnthropicGenerator::new(key::load(&key::os_store())?)
}

async fn staged_stat(state: &AppState, repo: &Path) -> AppResult<String> {
    staged_text(state, repo, &STAT_ARGS).await
}

/// Staged git output that must be non-empty. An empty result means nothing is
/// staged, which the user fixes by staging, so it is an error and not a
/// blank message.
async fn staged_text(state: &AppState, repo: &Path, args: &[&str]) -> AppResult<String> {
    let text = state.git.run_text_lossy(repo, args).await?;
    if text.trim().is_empty() {
        return Err(AppError::Ai("Stage changes first".into()));
    }
    Ok(text)
}

/// Last subjects, as style examples. Best effort: an unborn branch or a git
/// failure gives none, and the message still works without them.
async fn recent_subjects(state: &AppState, repo: &Path) -> Vec<String> {
    let log = state
        .git
        .run_text_lossy(repo, RECENT_LOG_ARGS)
        .await
        .unwrap_or_default();
    log.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(RECENT_SUBJECT_COUNT)
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diff_args_never_use_an_external_diff_tool() {
        assert!(DIFF_ARGS.contains(&"--no-ext-diff"));
        assert!(STAT_ARGS.contains(&"--no-ext-diff"));
    }

    #[test]
    fn diff_args_ask_for_three_lines_of_context_and_no_color() {
        assert!(DIFF_ARGS.contains(&"-U3"));
        assert!(DIFF_ARGS.contains(&"--no-color"));
    }

    #[test]
    fn diff_args_end_with_a_separator_so_a_path_cannot_be_an_option() {
        assert_eq!(DIFF_ARGS.last(), Some(&"--"));
    }

    #[test]
    fn stat_args_read_the_index_and_nothing_else() {
        assert!(STAT_ARGS.contains(&"--cached"));
        assert!(STAT_ARGS.contains(&"--stat"));
        assert!(!STAT_ARGS.contains(&"-U3"));
    }

    #[test]
    fn recent_log_asks_for_ten_subjects_only() {
        assert_eq!(RECENT_LOG_ARGS, ["log", "-10", "--format=%s"]);
        assert_eq!(RECENT_SUBJECT_COUNT, 10);
    }
}
