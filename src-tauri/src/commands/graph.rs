use crate::error::AppResult;
use crate::git::graph::{assign_lanes, GraphNode};
use crate::git::log_parser::{parse_log_z, LOG_FORMAT};
use crate::git::refs::{parse_refs, REF_FORMAT};
use crate::git::types::CommitRef;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct GraphLoadOpts {
    pub path: String,
    pub limit: Option<usize>,
    pub all_branches: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct GraphPage {
    pub nodes: Vec<GraphNode>,
    pub refs: Vec<CommitRef>,
    pub head_sha: Option<String>,
    pub head_branch: Option<String>,
}

#[tauri::command]
pub async fn graph_load(
    opts: GraphLoadOpts,
    state: State<'_, AppState>,
) -> AppResult<GraphPage> {
    let cwd = PathBuf::from(&opts.path);
    let limit = opts.limit.unwrap_or(2000);
    let mut log_args: Vec<String> = vec![
        "log".into(),
        "-z".into(),
        format!("--format={LOG_FORMAT}"),
        format!("-n{limit}"),
    ];
    if opts.all_branches.unwrap_or(true) {
        log_args.push("--all".into());
        // refs/stash is not part of --all; pull it in explicitly.
        log_args.push("--glob=refs/stash".into());
    }
    // Older stashes (stash@{1}, stash@{2}, …) are reflog entries, not refs,
    // so --glob doesn't reach them. Append their SHAs explicitly.
    if let Ok(text) = state.git.run_text(&cwd, ["stash", "list", "--format=%H"]).await {
        for line in text.lines() {
            let s = line.trim();
            if !s.is_empty() { log_args.push(s.to_string()); }
        }
    }

    let ref_format_arg = format!("--format={REF_FORMAT}");
    let ref_args = ["for-each-ref", ref_format_arg.as_str()];

    // A freshly-cloned-but-empty repo (no commits yet) makes both
    // `rev-parse HEAD` and `git log` fail with "ambiguous argument
    // 'HEAD'". `for-each-ref` and the rev-parse calls below are
    // tolerated independently — if any errors out, we fall back to
    // empty/None so the UI still opens with a clean "no commits" graph
    // instead of throwing in the user's face.
    let (log_res, ref_res, head_sha_res, head_branch_res) = tokio::join!(
        state.git.run(&cwd, log_args),
        state.git.run(&cwd, ref_args),
        state.git.run_text(&cwd, ["rev-parse", "HEAD"]),
        state.git.run_text(&cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    );

    let log_bytes = log_res.unwrap_or_default();
    let ref_bytes = ref_res.unwrap_or_default();
    let commits = parse_log_z(&log_bytes).unwrap_or_default();
    let nodes = assign_lanes(commits);
    let refs = parse_refs(&ref_bytes).unwrap_or_default();
    let head_sha_t = head_sha_res.map(|s| s.trim().to_string()).unwrap_or_default();
    let head_branch_t = head_branch_res.map(|s| s.trim().to_string()).unwrap_or_default();
    Ok(GraphPage {
        nodes,
        refs,
        head_sha: (!head_sha_t.is_empty()).then_some(head_sha_t),
        head_branch: (head_branch_t != "HEAD" && !head_branch_t.is_empty())
            .then_some(head_branch_t),
    })
}
