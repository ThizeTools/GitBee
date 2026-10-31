//! Size gate for the staged diff sent to the model. Spec: docs/specs/ai-commit-message.md
//! "Invariants". A diff over the limit is refused with a marked error, never
//! cut short, because a message written from half a diff reads as complete.

use crate::error::{AppError, AppResult};

/// 200 KiB. Above this the full patch is refused and the UI offers the
/// file-summary mode instead.
pub const MAX_DIFF_BYTES: usize = 200 * 1024;

/// Prefix of the refusal message. The frontend finds the size after it, so a
/// rename must change both sides (`commitMsg/aiErrors.ts`).
pub const DIFF_TOO_LARGE_PREFIX: &str = "DIFF_TOO_LARGE:";

/// Accepts a diff of exactly `MAX_DIFF_BYTES` and refuses one byte more. The
/// refusal carries the size so the UI can show it.
pub fn check_diff_size(bytes: usize) -> AppResult<()> {
    if bytes <= MAX_DIFF_BYTES {
        return Ok(());
    }
    Err(AppError::Ai(format!("{DIFF_TOO_LARGE_PREFIX}{bytes}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_diff_at_the_limit_is_accepted() {
        assert!(check_diff_size(MAX_DIFF_BYTES).is_ok());
    }

    #[test]
    fn a_diff_one_byte_over_the_limit_is_refused_with_its_size() {
        match check_diff_size(MAX_DIFF_BYTES + 1) {
            Err(AppError::Ai(msg)) => {
                assert_eq!(msg, format!("DIFF_TOO_LARGE:{}", MAX_DIFF_BYTES + 1));
            }
            other => panic!("expected a DIFF_TOO_LARGE error, got {other:?}"),
        }
    }

    #[test]
    fn limit_is_200_kib() {
        assert_eq!(MAX_DIFF_BYTES, 204_800);
    }
}
