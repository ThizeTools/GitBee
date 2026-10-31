//! The Anthropic API key in the OS credential store. The key never goes back to
//! the frontend: the UI only learns whether one is saved. Spec:
//! docs/specs/ai-commit-message.md "Invariants". The policy takes a
//! `SecretStore`, so tests run it on the fake.

use crate::error::{AppError, AppResult};
use crate::github::secret_store::{KeyringSecretStore, SecretStore};

/// Account of the Anthropic key entry. Changing it orphans a saved key, so
/// treat it as a storage format.
pub const ANTHROPIC_ACCOUNT: &str = "anthropic-api-key";

/// The OS-store entry for the Anthropic key.
pub fn os_store() -> KeyringSecretStore {
    KeyringSecretStore::new(ANTHROPIC_ACCOUNT)
}

/// Whether a non-empty key is saved. An unavailable store is an error, not
/// "no key", so the UI does not offer to overwrite a key it could not read.
pub fn status(store: &dyn SecretStore) -> AppResult<bool> {
    Ok(store.get()?.is_some_and(|key| !key.is_empty()))
}

/// Stores the key after trimming it. A key with inner whitespace cannot be a
/// header value, so it is refused here with the expected shape, and the
/// refusal does not echo the key back.
pub fn save(store: &dyn SecretStore, key: &str) -> AppResult<()> {
    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::Ai("The API key is empty. Paste a key that starts with sk-ant-.".into()));
    }
    if key.chars().any(char::is_whitespace) {
        return Err(AppError::Ai(
            "The API key contains spaces or line breaks. Expected one token that starts with sk-ant-.".into(),
        ));
    }
    store.set(key)
}

/// The saved key, for one generation. Missing is an error the UI turns into
/// the settings dialog.
pub fn load(store: &dyn SecretStore) -> AppResult<String> {
    match store.get()? {
        Some(key) if !key.is_empty() => Ok(key),
        _ => Err(AppError::Ai(
            "No Anthropic API key saved. Add one in the AI settings.".into(),
        )),
    }
}

pub fn clear(store: &dyn SecretStore) -> AppResult<()> {
    store.delete()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::secret_store::{FakeMode, FakeSecretStore};

    #[test]
    fn status_is_false_when_nothing_is_stored() {
        let store = FakeSecretStore::new(None, FakeMode::Working);
        assert!(!status(&store).unwrap());
    }

    #[test]
    fn status_is_false_for_an_empty_stored_value() {
        let store = FakeSecretStore::new(Some(""), FakeMode::Working);
        assert!(!status(&store).unwrap());
    }

    #[test]
    fn status_is_an_error_when_the_store_is_unavailable() {
        let store = FakeSecretStore::new(Some("sk-ant-x"), FakeMode::Unavailable);
        assert!(status(&store).is_err());
    }

    #[test]
    fn save_trims_and_stores_the_key() {
        let store = FakeSecretStore::new(None, FakeMode::Working);
        save(&store, "  sk-ant-abc  \n").unwrap();
        assert_eq!(store.stored().as_deref(), Some("sk-ant-abc"));
        assert!(status(&store).unwrap());
    }

    #[test]
    fn save_refuses_an_empty_key_and_keeps_the_old_one() {
        let store = FakeSecretStore::new(Some("sk-ant-old"), FakeMode::Working);
        assert!(save(&store, "   ").is_err());
        assert_eq!(store.stored().as_deref(), Some("sk-ant-old"));
    }

    #[test]
    fn save_refuses_a_key_with_inner_whitespace() {
        let store = FakeSecretStore::new(None, FakeMode::Working);
        assert!(save(&store, "sk-ant-a b").is_err());
        assert_eq!(store.stored(), None);
    }

    #[test]
    fn a_save_failure_does_not_echo_the_key() {
        let store = FakeSecretStore::new(None, FakeMode::WritesFail);
        let msg = save(&store, "sk-ant-secret").unwrap_err().to_string();
        assert!(!msg.contains("sk-ant-secret"));
    }

    #[test]
    fn load_returns_the_saved_key() {
        let store = FakeSecretStore::new(Some("sk-ant-k"), FakeMode::Working);
        assert_eq!(load(&store).unwrap(), "sk-ant-k");
    }

    #[test]
    fn load_without_a_key_asks_for_one() {
        let store = FakeSecretStore::new(None, FakeMode::Working);
        let msg = load(&store).unwrap_err().to_string();
        assert!(msg.contains("No Anthropic API key saved"));
    }

    #[test]
    fn clear_removes_the_key() {
        let store = FakeSecretStore::new(Some("sk-ant-k"), FakeMode::Working);
        clear(&store).unwrap();
        assert!(!status(&store).unwrap());
    }
}
