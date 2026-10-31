//! GitHub integration — auth, repo listing, avatars, pull requests, gists.
//! See `docs/specs/github-integration.md` and `docs/specs/github-pull-requests.md`.

pub mod api;
pub mod avatars;
pub mod create;
pub mod gists;
pub mod oauth;
pub mod pull_parse;
pub mod pull_types;
pub mod pulls;
pub mod secret_store;
pub mod storage;
pub mod types;
#[cfg(test)]
pub mod fake_api;

pub use types::*;
