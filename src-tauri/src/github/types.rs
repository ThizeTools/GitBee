use serde::{Deserialize, Serialize};

/// Public user identity returned from `/user`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub login: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    pub avatar_url: String,
}

/// Repo entry shown in the picker. Serialized to TS as-is.
#[derive(Debug, Clone, Serialize)]
pub struct GhRepo {
    pub owner: String,
    pub owner_avatar: String,
    pub name: String,
    pub clone_url: String,
    pub ssh_url: String,
    pub private: bool,
    pub description: Option<String>,
    pub default_branch: Option<String>,
    pub pushed_at: i64,
}

/// Owner the user can create repos under: their personal account, or
/// any org where they have repo-create permission.
#[derive(Debug, Clone, Serialize)]
pub struct GhOwner {
    pub login: String,
    pub avatar_url: String,
    pub kind: OwnerKind,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OwnerKind {
    User,
    Organization,
}

/// Request body for `github_create_repo` / `github_publish_local`. The
/// fields with `#[serde(default)]` are optional from TS callers that
/// only care about the simple case (e.g. publish-existing doesn't pass
/// `dest_folder`; create-on-github does).
#[derive(Debug, Clone, Deserialize)]
pub struct CreateRepoReq {
    pub owner: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub private: bool,
    #[serde(default)]
    pub auto_init: bool,
    pub default_branch: String,
    #[serde(default)]
    pub dest_folder: Option<String>,
}

/// Result of a successful create flow. `local_path` is whatever ended
/// up on disk (the destination folder for create, the existing repo
/// path for publish).
#[derive(Debug, Clone, Serialize)]
pub struct GhRepoCreated {
    pub clone_url: String,
    pub ssh_url: String,
    pub html_url: String,
    pub default_branch: String,
    pub local_path: String,
}

