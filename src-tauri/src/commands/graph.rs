use crate::error::AppResult;
use crate::git::graph::{assign_lanes, GraphNode};
use crate::git::log_parser::{parse_log_z, LOG_FORMAT};
use crate::git::refs::{parse_refs, REF_FORMAT};
use crate::git::types::CommitRef;
use crate::git::GitRunner;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct GraphLoadOpts {
    pub path: String,
    pub limit: Option<usize>,
    pub all_branches: Option<bool>,
    /// The `fingerprint` of the graph the caller already holds. Equal to the
    /// current fingerprint means `git log` is skipped (see graph-loading.md).
    pub known_fingerprint: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GraphPage {
    pub nodes: Vec<GraphNode>,
    pub refs: Vec<CommitRef>,
    pub head_sha: Option<String>,
    pub head_branch: Option<String>,
    /// Hash of every input that decides the graph (16 hex chars).
    pub fingerprint: String,
    /// True when `known_fingerprint` matched; `nodes` and `refs` are then empty.
    pub unchanged: bool,
    /// `git log` returned `limit` commits, so older commits may exist.
    pub has_more: bool,
}

/// The ref-side inputs of `git log`, loaded together so one fingerprint
/// covers all of them.
struct RefState {
    ref_bytes: Vec<u8>,
    head_sha: String,
    head_branch: String,
    stash_shas: Vec<String>,
}

#[tauri::command]
pub async fn graph_load(
    opts: GraphLoadOpts,
    state: State<'_, AppState>,
) -> AppResult<GraphPage> {
    let cwd = PathBuf::from(&opts.path);
    let limit = opts.limit.unwrap_or(2000);
    let all_branches = opts.all_branches.unwrap_or(true);
    let refs_state = load_ref_state(&state.git, &cwd).await;
    let fingerprint = graph_fingerprint(limit, all_branches, &refs_state);
    let head_sha = (!refs_state.head_sha.is_empty()).then(|| refs_state.head_sha.clone());
    let head_branch = head_branch_name(&refs_state.head_branch);
    if opts.known_fingerprint.as_deref() == Some(fingerprint.as_str()) {
        return Ok(unchanged_page(head_sha, head_branch, fingerprint));
    }
    let log_args = build_log_args(limit, all_branches, &refs_state.stash_shas);
    let log_bytes = state.git.run(&cwd, log_args).await.unwrap_or_default();
    let commits = parse_log_z(&log_bytes).unwrap_or_default();
    let has_more = commits.len() >= limit;
    let nodes = assign_lanes(commits, head_sha.as_deref());
    let refs = parse_refs(&refs_state.ref_bytes).unwrap_or_default();
    Ok(GraphPage {
        nodes,
        refs,
        head_sha,
        head_branch,
        fingerprint,
        unchanged: false,
        has_more,
    })
}

fn unchanged_page(
    head_sha: Option<String>,
    head_branch: Option<String>,
    fingerprint: String,
) -> GraphPage {
    GraphPage {
        nodes: Vec::new(),
        refs: Vec::new(),
        head_sha,
        head_branch,
        fingerprint,
        unchanged: true,
        has_more: false,
    }
}

async fn load_ref_state(git: &GitRunner, cwd: &Path) -> RefState {
    let ref_format_arg = format!("--format={REF_FORMAT}");
    // A freshly-cloned-but-empty repo (no commits yet) makes both
    // `rev-parse HEAD` and `git log` fail with "ambiguous argument
    // 'HEAD'". `for-each-ref` and the rev-parse calls below are
    // tolerated independently — if any errors out, we fall back to
    // empty/None so the UI still opens with a clean "no commits" graph
    // instead of throwing in the user's face.
    let (stash_res, ref_res, head_sha_res, head_branch_res) = tokio::join!(
        git.run_text(cwd, ["stash", "list", "--format=%H"]),
        git.run(cwd, ["for-each-ref", ref_format_arg.as_str()]),
        git.run_text(cwd, ["rev-parse", "HEAD"]),
        git.run_text(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    );
    // Older stashes (stash@{1}, stash@{2}, …) are reflog entries, not refs,
    // so --glob doesn't reach them. Their SHAs are appended to the log args.
    let stash_shas: Vec<String> = stash_res
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();
    RefState {
        ref_bytes: ref_res.unwrap_or_default(),
        head_sha: head_sha_res.unwrap_or_default().trim().to_string(),
        head_branch: head_branch_res.unwrap_or_default().trim().to_string(),
        stash_shas,
    }
}

fn build_log_args(limit: usize, all_branches: bool, stash_shas: &[String]) -> Vec<String> {
    let mut log_args: Vec<String> = vec![
        "log".into(),
        "-z".into(),
        format!("--format={LOG_FORMAT}"),
        format!("-n{limit}"),
        // Strict reverse-chronological order. Topo-order grouped commits
        // by branch but produced an out-of-date display when branches
        // interleaved chronologically — users expect "newest first" to
        // mean exactly that. Lane assignment compensates by reserving
        // lane 0 for HEAD so the active chain stays leftmost.
        "--date-order".into(),
    ];
    if all_branches {
        log_args.push("--all".into());
        // refs/stash is not part of --all; pull it in explicitly.
        log_args.push("--glob=refs/stash".into());
    }
    log_args.extend_from_slice(stash_shas);
    log_args
}

/// Refs + HEAD + stashes fully decide `git log` output for a fixed limit,
/// so an equal fingerprint means the graph is unchanged (see
/// docs/specs/graph-loading.md). Example: `graph_fingerprint(2000, true, &s)`.
fn graph_fingerprint(limit: usize, all_branches: bool, s: &RefState) -> String {
    let mut hasher = DefaultHasher::new();
    limit.hash(&mut hasher);
    all_branches.hash(&mut hasher);
    s.ref_bytes.hash(&mut hasher);
    s.head_sha.hash(&mut hasher);
    s.head_branch.hash(&mut hasher);
    s.stash_shas.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// `rev-parse --abbrev-ref HEAD` prints "HEAD" when detached; that and an
/// empty name both mean there is no branch to show. Expects a trimmed name.
fn head_branch_name(raw: &str) -> Option<String> {
    (raw != "HEAD" && !raw.is_empty()).then(|| raw.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_state() -> RefState {
        RefState {
            ref_bytes: b"refs/heads/main\n".to_vec(),
            head_sha: "abc123".into(),
            head_branch: "main".into(),
            stash_shas: vec!["def456".into()],
        }
    }

    #[test]
    fn fingerprint_is_equal_for_identical_inputs() {
        let a = graph_fingerprint(2000, true, &sample_state());
        let b = graph_fingerprint(2000, true, &sample_state());
        assert_eq!(a, b);
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn fingerprint_differs_when_limit_differs() {
        let s = sample_state();
        assert_ne!(
            graph_fingerprint(2000, true, &s),
            graph_fingerprint(4000, true, &s)
        );
    }

    #[test]
    fn fingerprint_differs_when_head_branch_differs() {
        let mut other = sample_state();
        other.head_branch = "feature".into();
        assert_ne!(
            graph_fingerprint(2000, true, &sample_state()),
            graph_fingerprint(2000, true, &other)
        );
    }

    #[test]
    fn fingerprint_differs_when_a_stash_is_added() {
        let mut more = sample_state();
        more.stash_shas.push("789abc".into());
        assert_ne!(
            graph_fingerprint(2000, true, &sample_state()),
            graph_fingerprint(2000, true, &more)
        );
    }

    #[test]
    fn log_args_include_all_refs_and_stashes_when_all_branches() {
        let stashes = vec!["def456".to_string()];
        let args = build_log_args(2000, true, &stashes);
        assert!(args.contains(&"--all".to_string()));
        assert!(args.contains(&"--glob=refs/stash".to_string()));
        assert!(args.ends_with(&stashes));
    }

    #[test]
    fn log_args_omit_ref_flags_when_not_all_branches() {
        let args = build_log_args(2000, false, &[]);
        assert!(!args.contains(&"--all".to_string()));
        assert!(!args.contains(&"--glob=refs/stash".to_string()));
    }

    #[test]
    fn unchanged_page_carries_no_graph() {
        let page = unchanged_page(Some("abc".into()), None, "f00".into());
        assert!(page.unchanged);
        assert!(!page.has_more);
        assert!(page.nodes.is_empty());
        assert!(page.refs.is_empty());
        assert_eq!(page.head_sha.as_deref(), Some("abc"));
        assert_eq!(page.fingerprint, "f00");
    }

    #[test]
    fn head_branch_name_is_none_for_detached_or_empty() {
        assert_eq!(head_branch_name("HEAD"), None);
        assert_eq!(head_branch_name(""), None);
        assert_eq!(head_branch_name("main"), Some("main".to_string()));
    }
}
