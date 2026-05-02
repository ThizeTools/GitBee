//! Email → avatar URL resolution + on-disk PNG cache.
//!
//! Resolution priority (in order):
//!   1. `<id>+<username>@users.noreply.github.com` → avatars.githubusercontent.com/u/<id>
//!   2. `<username>@users.noreply.github.com` (legacy) → github.com/<username>.png
//!   3. Gravatar with sha256 of the lowercased trimmed email.

use crate::cache::CacheStore;
use crate::error::{AppError, AppResult};
use md5::{Digest, Md5};
use sha1::Sha1;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const GH_NORMALIZE_SIZE: u32 = 96;

pub fn resolve_url(email: &str) -> String {
    let e = email.trim().to_lowercase();
    if let Some(stripped) = e.strip_suffix("@users.noreply.github.com") {
        if let Some((id, _user)) = stripped.split_once('+') {
            if id.chars().all(|c| c.is_ascii_digit()) && !id.is_empty() {
                return format!("https://avatars.githubusercontent.com/u/{id}?s={GH_NORMALIZE_SIZE}");
            }
        }
        if !stripped.is_empty() {
            return format!("https://github.com/{stripped}.png?size={GH_NORMALIZE_SIZE}");
        }
    }
    // Gravatar — historically MD5; SHA-256 is now preferred but MD5 still
    // works and matches more existing accounts. Use MD5 to stay aligned
    // with what most existing tools (GitHub itself, GitKraken, etc) do.
    let mut h = Md5::new();
    h.update(e.as_bytes());
    let hash = hex::encode(h.finalize());
    format!("https://www.gravatar.com/avatar/{hash}?s={GH_NORMALIZE_SIZE}&d=identicon")
}

/// Returns the absolute path to the cached PNG. If absent, fetches it
/// synchronously (the call is async — but we don't queue/dedup; concurrent
/// callers for the same email may both fetch, last write wins, harmless).
pub async fn ensure_cached(cache: &CacheStore, email: &str) -> AppResult<PathBuf> {
    let dir = avatars_dir();
    tokio::fs::create_dir_all(&dir).await
        .map_err(|e| AppError::GitHub(format!("create cache dir: {e}")))?;

    let key = sha1_hex(email.trim().to_lowercase().as_bytes());
    let file = dir.join(format!("{key}.png"));
    if file.exists() { return Ok(file); }

    // Memoize URL resolution in SQLite so subsequent calls don't re-derive.
    let url = match cache.avatar_url_get(email)? {
        Some(u) => u,
        None => {
            let u = resolve_url(email);
            let ts = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
            let _ = cache.avatar_url_put(email, &u, ts);
            u
        }
    };

    let bytes = reqwest::Client::builder()
        .user_agent("gitbee/0.1")
        .build()
        .map_err(|e| AppError::GitHub(format!("client: {e}")))?
        .get(&url)
        .send().await
        .map_err(|e| AppError::GitHub(format!("avatar fetch: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::GitHub(format!("avatar status: {e}")))?
        .bytes().await
        .map_err(|e| AppError::GitHub(format!("avatar body: {e}")))?;

    tokio::fs::write(&file, &bytes).await
        .map_err(|e| AppError::GitHub(format!("avatar write: {e}")))?;
    Ok(file)
}

fn avatars_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("GitBee")
        .join("avatars")
}

fn sha1_hex(bytes: &[u8]) -> String {
    let mut h = Sha1::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

#[allow(dead_code)]
pub fn dir() -> &'static Path {
    // Allow the commands module to expose this if needed for "clear cache".
    Box::leak(avatars_dir().into_boxed_path())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modern_noreply_uses_id_path() {
        let u = resolve_url("12345+octocat@users.noreply.github.com");
        assert!(u.contains("avatars.githubusercontent.com/u/12345"), "got {u}");
    }
    #[test]
    fn legacy_noreply_uses_username() {
        let u = resolve_url("octocat@users.noreply.github.com");
        assert!(u.contains("github.com/octocat.png"), "got {u}");
    }
    #[test]
    fn other_emails_use_gravatar() {
        let u = resolve_url("user@example.com");
        assert!(u.starts_with("https://www.gravatar.com/avatar/"), "got {u}");
    }
}
