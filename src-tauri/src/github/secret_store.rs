//! Project-owned seam over the OS credential store (Windows Credential
//! Manager, macOS Keychain, Linux Secret Service). Only this file names the
//! `keyring` crate, so a different backend is a one-file change. Why the OS
//! store at all: docs/specs/github-integration.md "Token storage".

use crate::error::{AppError, AppResult};

/// Service and account of the GitHub token entry. Changing either orphans the
/// token already stored on users' machines, so treat them as a storage format.
const SERVICE: &str = "GitBee";
const ACCOUNT: &str = "github-token";

/// One secret, read and written whole. An unavailable store is `Err`, never
/// `Ok(None)`: `Ok(None)` means "nothing stored", which triggers migration.
pub trait SecretStore {
    fn get(&self) -> AppResult<Option<String>>;
    fn set(&self, value: &str) -> AppResult<()>;
    fn delete(&self) -> AppResult<()>;
}

/// The OS credential store. Stateless: each call opens the entry again, so a
/// store that comes up after launch (Secret Service started late) is used
/// without a restart.
pub struct KeyringSecretStore;

impl KeyringSecretStore {
    fn entry(&self) -> AppResult<keyring::Entry> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| store_error("open", e))
    }
}

impl SecretStore for KeyringSecretStore {
    fn get(&self) -> AppResult<Option<String>> {
        match self.entry()?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(store_error("read", e)),
        }
    }

    fn set(&self, value: &str) -> AppResult<()> {
        self.entry()?.set_password(value).map_err(|e| store_error("write", e))
    }

    fn delete(&self) -> AppResult<()> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(store_error("delete", e)),
        }
    }
}

// Names the operation and the entry, so the log says which store call failed.
fn store_error(op: &str, e: keyring::Error) -> AppError {
    AppError::Other(format!(
        "OS credential store {op} failed (service {SERVICE:?}, account {ACCOUNT:?}): {e}"
    ))
}

/// How `FakeSecretStore` misbehaves. `Unavailable` fails every call, as a
/// locked or missing Secret Service does. `WritesFail` fails only `set`, to
/// exercise the write-side fallback while reads and deletes still work.
#[cfg(test)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FakeMode {
    Working,
    Unavailable,
    WritesFail,
}

/// In-memory `SecretStore` for tests of the token policy in `storage.rs`.
#[cfg(test)]
pub struct FakeSecretStore {
    value: std::cell::RefCell<Option<String>>,
    mode: FakeMode,
}

#[cfg(test)]
impl FakeSecretStore {
    pub fn new(value: Option<&str>, mode: FakeMode) -> Self {
        Self { value: std::cell::RefCell::new(value.map(str::to_string)), mode }
    }

    pub fn stored(&self) -> Option<String> {
        self.value.borrow().clone()
    }

    fn fail_if_unavailable(&self) -> AppResult<()> {
        match self.mode {
            FakeMode::Unavailable => Err(AppError::Other("fake keyring unavailable".into())),
            FakeMode::Working | FakeMode::WritesFail => Ok(()),
        }
    }
}

#[cfg(test)]
impl SecretStore for FakeSecretStore {
    fn get(&self) -> AppResult<Option<String>> {
        self.fail_if_unavailable()?;
        Ok(self.value.borrow().clone())
    }

    fn set(&self, value: &str) -> AppResult<()> {
        self.fail_if_unavailable()?;
        if self.mode == FakeMode::WritesFail {
            return Err(AppError::Other("fake keyring write failed".into()));
        }
        *self.value.borrow_mut() = Some(value.to_string());
        Ok(())
    }

    fn delete(&self) -> AppResult<()> {
        self.fail_if_unavailable()?;
        *self.value.borrow_mut() = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_error_names_the_operation_and_the_entry() {
        let msg = store_error("read", keyring::Error::NoEntry).to_string();
        assert!(msg.contains("read"));
        assert!(msg.contains("GitBee"));
        assert!(msg.contains("github-token"));
    }
}
