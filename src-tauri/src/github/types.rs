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

