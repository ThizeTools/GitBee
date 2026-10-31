use crate::error::{AppError, AppResult};

/// Repo names: ASCII letters/digits, `.`, `_`, `-`. 1–100 chars. No
/// leading dot or dash. Matches GitHub's own validation closely enough
/// to fail fast in the UI.
pub fn validate_name(name: &str) -> AppResult<()> {
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::GitHub(format!(
            "NAME_INVALID: '{name}' length must be 1-100"
        )));
    }
    let bytes = name.as_bytes();
    let first = bytes[0] as char;
    if first == '.' || first == '-' {
        return Err(AppError::GitHub(format!(
            "NAME_INVALID: '{name}' cannot start with '.' or '-'"
        )));
    }
    for c in name.chars() {
        let ok = c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-';
        if !ok {
            return Err(AppError::GitHub(format!(
                "NAME_INVALID: '{name}' contains '{c}' (allowed: A-Z a-z 0-9 . _ -)"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_valid_basic() {
        assert!(validate_name("hello").is_ok());
        assert!(validate_name("hello-world_2.0").is_ok());
        assert!(validate_name("a").is_ok());
    }

    #[test]
    fn name_rejects_leading_dot_or_dash() {
        let e = validate_name(".env").unwrap_err().to_string();
        assert!(e.contains("NAME_INVALID"));
        assert!(validate_name("-foo").is_err());
    }

    #[test]
    fn name_rejects_unicode_and_spaces() {
        assert!(validate_name("hello world").is_err());
        assert!(validate_name("café").is_err());
    }

    #[test]
    fn name_rejects_empty_and_too_long() {
        assert!(validate_name("").is_err());
        assert!(validate_name(&"a".repeat(101)).is_err());
        assert!(validate_name(&"a".repeat(100)).is_ok());
    }
}
