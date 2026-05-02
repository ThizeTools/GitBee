use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Commit {
    pub sha: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitRef {
    pub name: String,
    pub kind: RefKind,
    pub target_sha: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RefKind {
    LocalBranch,
    RemoteBranch,
    Tag,
    Stash,
    Head,
}
