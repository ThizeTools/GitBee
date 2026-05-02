//! GitHub integration — auth, repo listing, avatars.
//! See `docs/specs/github-integration.md` for design rationale.

pub mod api;
pub mod avatars;
pub mod oauth;
pub mod storage;
pub mod types;

pub use types::*;
