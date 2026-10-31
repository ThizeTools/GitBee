//! GitHub token persistence. The token lives in the OS credential store behind
//! `SecretStore`. A token from before that move (XOR+base64 in the `settings`
//! table) is moved on first read. Rules and reasons: docs/specs/github-integration.md
//! "Token storage".

use crate::cache::CacheStore;
use crate::error::{AppError, AppResult};
use crate::github::secret_store::{KeyringSecretStore, SecretStore};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

const KEY_TOKEN: &str = "github.access_token";

// XOR with a fixed app key, then base64. This is obfuscation, not encryption:
// the key ships in the binary, so anyone with the app can recover the token.
// It is kept only to read legacy rows and for the fallback when the OS store
// is unavailable.
const OBFUS_KEY: &[u8] = b"GitBee-2026-OBFUS-do-not-rely-on-me-for-security";

/// The SQLite settings row that held the token before the OS store. Read to
/// migrate, and written only when the OS store is unavailable. A trait so the
/// policy below runs against a fake in tests.
pub trait LegacyBlobStore {
    fn read_blob(&self) -> AppResult<Option<String>>;
    fn write_blob(&self, blob: &str) -> AppResult<()>;
    fn clear_blob(&self) -> AppResult<()>;
}

impl LegacyBlobStore for CacheStore {
    fn read_blob(&self) -> AppResult<Option<String>> {
        self.settings_get(KEY_TOKEN)
    }

    fn write_blob(&self, blob: &str) -> AppResult<()> {
        self.settings_set(KEY_TOKEN, blob)
    }

    fn clear_blob(&self) -> AppResult<()> {
        self.settings_delete(KEY_TOKEN)
    }
}

pub fn save_token(cache: &CacheStore, token: &str) -> AppResult<()> {
    save_with(&KeyringSecretStore::github(), cache, token)
}

pub fn load_token(cache: &CacheStore) -> AppResult<Option<String>> {
    load_with(&KeyringSecretStore::github(), cache)
}

pub fn clear_token(cache: &CacheStore) -> AppResult<()> {
    clear_with(&KeyringSecretStore::github(), cache)
}

/// Writes to the OS store. If that fails, the token goes to the SQLite row so
/// login still works. An older copy in the OS store is removed first, so it
/// cannot win over the fallback row on the next read.
fn save_with(
    secrets: &dyn SecretStore,
    legacy: &dyn LegacyBlobStore,
    token: &str,
) -> AppResult<()> {
    match secrets.set(token) {
        Ok(()) => {
            clear_legacy(legacy);
            Ok(())
        }
        Err(e) => {
            warn_store_failure("write", &e);
            if let Err(delete_err) = secrets.delete() {
                warn_store_failure("delete", &delete_err);
            }
            legacy.write_blob(&encode_legacy(token))
        }
    }
}

/// The OS store is read first. A missing entry triggers the one-time
/// migration. An unavailable store reads the SQLite row, so login survives a
/// broken keyring.
fn load_with(
    secrets: &dyn SecretStore,
    legacy: &dyn LegacyBlobStore,
) -> AppResult<Option<String>> {
    match secrets.get() {
        Ok(Some(token)) => Ok(Some(token)),
        Ok(None) => migrate_legacy(secrets, legacy),
        Err(e) => {
            warn_store_failure("read", &e);
            read_legacy(legacy)
        }
    }
}

/// Moves a legacy token into the OS store. The SQLite row is cleared only after
/// the OS write succeeds, so a failed write keeps the token and the next read
/// retries the move.
fn migrate_legacy(
    secrets: &dyn SecretStore,
    legacy: &dyn LegacyBlobStore,
) -> AppResult<Option<String>> {
    let Some(token) = read_legacy(legacy)? else { return Ok(None); };
    match secrets.set(&token) {
        Ok(()) => {
            tracing::info!(store = "os-keyring", "migrated GitHub token out of the SQLite row");
            clear_legacy(legacy);
        }
        Err(e) => warn_store_failure("write", &e),
    }
    Ok(Some(token))
}

/// Logout. The SQLite row is cleared and an error there is returned. An
/// OS-store delete failure is logged, not returned: when that store is
/// unavailable the SQLite row is the only copy, so logout must still succeed.
fn clear_with(secrets: &dyn SecretStore, legacy: &dyn LegacyBlobStore) -> AppResult<()> {
    legacy.clear_blob()?;
    if let Err(e) = secrets.delete() {
        warn_store_failure("delete", &e);
    }
    Ok(())
}

fn read_legacy(legacy: &dyn LegacyBlobStore) -> AppResult<Option<String>> {
    let Some(blob) = legacy.read_blob()? else { return Ok(None); };
    Ok(decode_legacy(&blob))
}

// A failed clear leaves the row behind. That is harmless while a token sits in
// the OS store, because the OS store is read first.
fn clear_legacy(legacy: &dyn LegacyBlobStore) {
    if let Err(e) = legacy.clear_blob() {
        tracing::warn!(error = %e, "could not delete the legacy GitHub token row");
    }
}

fn warn_store_failure(op: &str, error: &AppError) {
    tracing::warn!(
        store = "os-keyring",
        operation = op,
        error = %error,
        "OS credential store operation failed; falling back to the SQLite row"
    );
}

/// Legacy row format: XOR with `OBFUS_KEY`, then base64.
fn encode_legacy(token: &str) -> String {
    B64.encode(xor(token.as_bytes()))
}

/// `None` for a row that is not valid base64 or UTF-8, which reads as signed
/// out, as it did before the migration.
fn decode_legacy(blob: &str) -> Option<String> {
    let bytes = B64.decode(blob).ok()?;
    String::from_utf8(xor(&bytes)).ok()
}

fn xor(buf: &[u8]) -> Vec<u8> {
    buf.iter().enumerate().map(|(i, b)| b ^ OBFUS_KEY[i % OBFUS_KEY.len()]).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::secret_store::{FakeMode, FakeSecretStore};
    use std::cell::RefCell;

    /// In-memory stand-in for the SQLite settings row.
    struct FakeLegacyBlobStore {
        blob: RefCell<Option<String>>,
    }

    impl FakeLegacyBlobStore {
        fn new(blob: Option<String>) -> Self {
            Self { blob: RefCell::new(blob) }
        }

        fn holding(token: &str) -> Self {
            Self::new(Some(encode_legacy(token)))
        }

        fn stored(&self) -> Option<String> {
            self.blob.borrow().clone()
        }
    }

    impl LegacyBlobStore for FakeLegacyBlobStore {
        fn read_blob(&self) -> AppResult<Option<String>> {
            Ok(self.blob.borrow().clone())
        }

        fn write_blob(&self, blob: &str) -> AppResult<()> {
            *self.blob.borrow_mut() = Some(blob.to_string());
            Ok(())
        }

        fn clear_blob(&self) -> AppResult<()> {
            *self.blob.borrow_mut() = None;
            Ok(())
        }
    }

    #[test]
    fn migration_moves_the_legacy_token_into_the_os_store_and_clears_the_row() {
        let secrets = FakeSecretStore::new(None, FakeMode::Working);
        let legacy = FakeLegacyBlobStore::holding("ghp_old");
        let token = load_with(&secrets, &legacy).unwrap();
        assert_eq!(token.as_deref(), Some("ghp_old"));
        assert_eq!(secrets.stored().as_deref(), Some("ghp_old"));
        assert_eq!(legacy.stored(), None);
    }

    #[test]
    fn load_prefers_the_os_store_and_leaves_the_row_alone() {
        let secrets = FakeSecretStore::new(Some("ghp_new"), FakeMode::Working);
        let legacy = FakeLegacyBlobStore::holding("ghp_old");
        assert_eq!(load_with(&secrets, &legacy).unwrap().as_deref(), Some("ghp_new"));
        assert_eq!(legacy.stored(), Some(encode_legacy("ghp_old")));
    }

    #[test]
    fn failed_migration_write_keeps_the_row_so_the_next_read_retries() {
        let secrets = FakeSecretStore::new(None, FakeMode::WritesFail);
        let legacy = FakeLegacyBlobStore::holding("ghp_old");
        assert_eq!(load_with(&secrets, &legacy).unwrap().as_deref(), Some("ghp_old"));
        assert_eq!(legacy.stored(), Some(encode_legacy("ghp_old")));
        assert_eq!(secrets.stored(), None);
    }

    #[test]
    fn unavailable_os_store_on_read_falls_back_to_the_row() {
        let secrets = FakeSecretStore::new(None, FakeMode::Unavailable);
        let legacy = FakeLegacyBlobStore::holding("ghp_old");
        assert_eq!(load_with(&secrets, &legacy).unwrap().as_deref(), Some("ghp_old"));
        assert_eq!(legacy.stored(), Some(encode_legacy("ghp_old")));
    }

    #[test]
    fn save_writes_the_os_store_and_clears_the_row() {
        let secrets = FakeSecretStore::new(None, FakeMode::Working);
        let legacy = FakeLegacyBlobStore::holding("ghp_old");
        save_with(&secrets, &legacy, "ghp_new").unwrap();
        assert_eq!(secrets.stored().as_deref(), Some("ghp_new"));
        assert_eq!(legacy.stored(), None);
    }

    #[test]
    fn save_falls_back_to_the_row_when_the_os_store_is_unavailable() {
        let secrets = FakeSecretStore::new(None, FakeMode::Unavailable);
        let legacy = FakeLegacyBlobStore::new(None);
        save_with(&secrets, &legacy, "ghp_new").unwrap();
        assert_eq!(decode_legacy(&legacy.stored().unwrap()).as_deref(), Some("ghp_new"));
        assert_eq!(load_with(&secrets, &legacy).unwrap().as_deref(), Some("ghp_new"));
    }

    // Regression: a failed OS write used to leave the previous account's token
    // in the OS store, where it would win over the newly saved fallback row.
    #[test]
    fn failed_os_write_removes_the_stale_os_token_before_falling_back() {
        let secrets = FakeSecretStore::new(Some("ghp_stale"), FakeMode::WritesFail);
        let legacy = FakeLegacyBlobStore::new(None);
        save_with(&secrets, &legacy, "ghp_new").unwrap();
        assert_eq!(secrets.stored(), None);
        assert_eq!(load_with(&secrets, &legacy).unwrap().as_deref(), Some("ghp_new"));
    }

    #[test]
    fn clear_removes_the_token_from_both_stores() {
        let secrets = FakeSecretStore::new(Some("ghp_new"), FakeMode::Working);
        let legacy = FakeLegacyBlobStore::holding("ghp_old");
        clear_with(&secrets, &legacy).unwrap();
        assert_eq!(secrets.stored(), None);
        assert_eq!(legacy.stored(), None);
    }

    #[test]
    fn clear_succeeds_when_the_os_store_is_unavailable() {
        let secrets = FakeSecretStore::new(None, FakeMode::Unavailable);
        let legacy = FakeLegacyBlobStore::holding("ghp_old");
        clear_with(&secrets, &legacy).unwrap();
        assert_eq!(legacy.stored(), None);
    }

    #[test]
    fn legacy_blob_round_trips_and_a_corrupt_row_reads_as_signed_out() {
        assert_eq!(decode_legacy(&encode_legacy("ghp_x")).as_deref(), Some("ghp_x"));
        assert_eq!(decode_legacy("%%% not base64"), None);
    }
}
