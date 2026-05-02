//! Token persistence. SQLite-backed (using the existing settings table)
//! with light obfuscation. `keyring` is documented as the desired backend
//! in the spec but isn't a hard requirement for v1 — SQLite-with-warning
//! is the documented fallback path.

use crate::cache::CacheStore;
use crate::error::AppResult;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

const KEY_TOKEN: &str = "github.access_token";

// Light obfuscation: XOR with a fixed app key, then base64. Not security
// — it stops a casual user opening cache.db in a viewer and copying their
// token to chat. Actual secrecy lives at the OS keyring layer (v2).
const OBFUS_KEY: &[u8] = b"GitBee-2026-OBFUS-do-not-rely-on-me-for-security";

fn xor(buf: &[u8]) -> Vec<u8> {
    buf.iter().enumerate().map(|(i, b)| b ^ OBFUS_KEY[i % OBFUS_KEY.len()]).collect()
}

pub fn save_token(cache: &CacheStore, token: &str) -> AppResult<()> {
    let blob = B64.encode(xor(token.as_bytes()));
    cache.settings_set(KEY_TOKEN, &blob)?;
    Ok(())
}

pub fn load_token(cache: &CacheStore) -> AppResult<Option<String>> {
    let Some(blob) = cache.settings_get(KEY_TOKEN)? else { return Ok(None); };
    let bytes = match B64.decode(&blob) {
        Ok(b) => b,
        Err(_) => return Ok(None),
    };
    let plain = xor(&bytes);
    let s = String::from_utf8(plain).ok();
    Ok(s)
}

pub fn clear_token(cache: &CacheStore) -> AppResult<()> {
    cache.settings_delete(KEY_TOKEN)
}
