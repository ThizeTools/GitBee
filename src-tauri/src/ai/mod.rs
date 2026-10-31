//! AI commit message generation. Spec: docs/specs/ai-commit-message.md.
//! Layout: `generator` is the seam, `anthropic` the one real provider, and
//! `response`, `prompt`, `limits` and `draft` are pure logic tested without
//! the network. `key` keeps the API key in the OS store.

pub mod anthropic;
pub mod draft;
pub mod generator;
pub mod key;
pub mod limits;
pub mod prompt;
pub mod response;
