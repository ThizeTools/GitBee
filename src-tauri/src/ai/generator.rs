//! The seam between GitBee and a text-generating model. Everything above it
//! (prompt, size limit, the command) runs against this trait, so tests use
//! `FakeGenerator` and never the network. Only Anthropic is wired; see
//! docs/specs/ai-commit-message.md "Out of scope".

use crate::error::AppResult;
use std::future::Future;

pub trait MessageGenerator {
    /// `system` holds the instructions and `user` the data to act on. Returns
    /// the model's text as is; cleanup is the caller's job (see `draft`).
    /// The `+ Send` bound is spelled out, not written as `async fn`, because
    /// a Tauri command future must be `Send` and a trait `async fn` hides
    /// that from every generic caller.
    fn generate(&self, system: &str, user: &str) -> impl Future<Output = AppResult<String>> + Send;
}

/// Returns a canned reply and records every `(system, user)` pair it was
/// given, so tests can check what would have been sent.
#[cfg(test)]
pub struct FakeGenerator {
    reply: Result<String, String>,
    calls: std::sync::Mutex<Vec<(String, String)>>,
}

#[cfg(test)]
impl FakeGenerator {
    pub fn replying(text: &str) -> Self {
        Self { reply: Ok(text.to_string()), calls: std::sync::Mutex::new(Vec::new()) }
    }

    pub fn failing(message: &str) -> Self {
        Self { reply: Err(message.to_string()), calls: std::sync::Mutex::new(Vec::new()) }
    }

    pub fn calls(&self) -> Vec<(String, String)> {
        self.calls.lock().expect("fake generator lock").clone()
    }
}

#[cfg(test)]
impl MessageGenerator for FakeGenerator {
    async fn generate(&self, system: &str, user: &str) -> AppResult<String> {
        self.calls
            .lock()
            .expect("fake generator lock")
            .push((system.to_string(), user.to_string()));
        self.reply.clone().map_err(crate::error::AppError::Ai)
    }
}
