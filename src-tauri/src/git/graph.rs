use crate::git::types::Commit;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize)]
pub struct GraphNode {
    pub sha: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub subject: String,
    pub lane: u32,
    pub row: u32,
    pub parent_lanes: Vec<u32>,
}

/// Assign lanes to commits in display order (newest first).
///
/// Algorithm:
/// - Pre-pass walks parents from `head_sha` to mark every commit on the
///   HEAD chain. Those commits are pinned to lane 0 so the active branch
///   stays visually leftmost (GitKraken-style), even if its tip is older
///   than other branches' tips. Without this, `git log --all` ordering
///   could place an unrelated tip on lane 0 first and push HEAD outward.
/// - Maintain a vector of "open lanes". Each slot is either free or
///   waiting for a specific SHA (the next commit expected on that lane).
/// - Process commits top-to-bottom (newer to older, as `git log` returns).
/// - For each commit:
///   - If any lanes are waiting for this commit's SHA, the leftmost wins
///     and becomes the commit's lane. Other waiting lanes converge here
///     (a merge into the kept lane) and are freed.
///   - Otherwise (a new tip): if commit is on HEAD chain, claim lane 0
///     (booting any non-HEAD tenant out into a new lane). Else allocate
///     leftmost free lane skipping lane 0 when it's reserved for HEAD.
///   - Replace the chosen lane's awaited SHA with the commit's first parent.
///   - Any additional parents (merge commits) get newly allocated lanes.
pub fn assign_lanes(commits: Vec<Commit>, head_sha: Option<&str>) -> Vec<GraphNode> {
    let head_chain = build_head_chain(&commits, head_sha);
    let head_chain_active = !head_chain.is_empty();

    let mut lanes: Vec<Option<String>> = Vec::new();
    let mut nodes: Vec<GraphNode> = Vec::with_capacity(commits.len());

    for (row, c) in commits.into_iter().enumerate() {
        let on_head = head_chain.contains(&c.sha);
        let waiting: Vec<usize> = lanes
            .iter()
            .enumerate()
            .filter_map(|(i, l)| (l.as_deref() == Some(c.sha.as_str())).then_some(i))
            .collect();

        let my_lane = if waiting.is_empty() {
            allocate_lane(&mut lanes, on_head, head_chain_active)
        } else if on_head && waiting[0] != 0 {
            // HEAD chain commit but its waiting lane isn't 0. If lane 0
            // is free, pull it down to lane 0 and free the side lanes.
            // This keeps the HEAD column straight even when a parent
            // was speculatively parked on a higher lane.
            for &idx in &waiting {
                lanes[idx] = None;
            }
            ensure_lane(&mut lanes, 0);
            0
        } else {
            for &idx in &waiting[1..] {
                lanes[idx] = None;
            }
            waiting[0]
        };

        let mut parent_lanes: Vec<u32> = Vec::with_capacity(c.parents.len());
        if c.parents.is_empty() {
            lanes[my_lane] = None;
        } else {
            lanes[my_lane] = Some(c.parents[0].clone());
            parent_lanes.push(my_lane as u32);
            for parent in &c.parents[1..] {
                // Side parents of a HEAD-chain merge are NOT on HEAD
                // themselves — they get an outer lane.
                let new_lane = allocate_lane(&mut lanes, false, head_chain_active);
                lanes[new_lane] = Some(parent.clone());
                parent_lanes.push(new_lane as u32);
            }
        }

        nodes.push(GraphNode {
            sha: c.sha,
            parents: c.parents,
            author_name: c.author_name,
            author_email: c.author_email,
            timestamp: c.timestamp,
            subject: c.subject,
            lane: my_lane as u32,
            row: row as u32,
            parent_lanes,
        });
    }

    compact_lanes_by_first_use(&mut nodes, head_chain_active);
    nodes
}

/// Walk parent links from HEAD to collect every commit on the HEAD chain
/// within the loaded slice. Returns empty if HEAD is unknown or its sha
/// isn't present in the slice. We restrict the walk to the slice so
/// out-of-range parents never throw off lane assignment.
fn build_head_chain(commits: &[Commit], head_sha: Option<&str>) -> HashSet<String> {
    let head = match head_sha {
        Some(h) if !h.is_empty() => h,
        _ => return HashSet::new(),
    };
    let by_sha: HashMap<&str, &Commit> = commits.iter().map(|c| (c.sha.as_str(), c)).collect();
    if !by_sha.contains_key(head) {
        return HashSet::new();
    }
    let mut chain = HashSet::new();
    let mut cur = head.to_string();
    loop {
        if !chain.insert(cur.clone()) { break; }
        let next = match by_sha.get(cur.as_str()) {
            Some(c) if !c.parents.is_empty() => c.parents[0].clone(),
            _ => break,
        };
        cur = next;
    }
    chain
}

/// Pick a free lane. When `for_head_chain` is true, prefer lane 0 even
/// if it's "available". When false and lane 0 is reserved for HEAD,
/// skip it — non-HEAD tips never claim the leftmost column.
fn allocate_lane(
    lanes: &mut Vec<Option<String>>,
    for_head_chain: bool,
    head_chain_active: bool,
) -> usize {
    if for_head_chain {
        ensure_lane(lanes, 0);
        return 0;
    }
    let start = if head_chain_active { 1 } else { 0 };
    if let Some((idx, _)) = lanes.iter().enumerate().skip(start).find(|(_, l)| l.is_none()) {
        return idx;
    }
    lanes.push(None);
    lanes.len() - 1
}

/// Grow `lanes` to ensure index `idx` exists, then clear it.
fn ensure_lane(lanes: &mut Vec<Option<String>>, idx: usize) {
    while lanes.len() <= idx {
        lanes.push(None);
    }
    lanes[idx] = None;
}

/// Remap lane indices so newer branches (those that first appear in
/// earlier rows under `--date-order`) get lower lane numbers. Without
/// this, lane 5 might host a newer tip than lane 2 just because lane 2
/// was reused after another branch terminated. The active-branch lane 0
/// (HEAD chain) is preserved when present.
fn compact_lanes_by_first_use(nodes: &mut [GraphNode], head_chain_active: bool) {
    if nodes.is_empty() { return; }
    // First-use row for each lane (across both the commit's own lane
    // and any side parent lanes spawned at this commit).
    let mut first_seen: HashMap<u32, u32> = HashMap::new();
    for n in nodes.iter() {
        first_seen.entry(n.lane).or_insert(n.row);
        for &pl in &n.parent_lanes {
            first_seen.entry(pl).or_insert(n.row);
        }
    }
    let mut order: Vec<(u32, u32)> = first_seen.into_iter().collect();
    // Sort by first-seen row asc → newest tips earliest in --date-order.
    // Lane 0 is pinned when a HEAD chain reservation is in effect so
    // the active branch column never shifts under the user.
    order.sort_by_key(|(lane, row)| {
        let pin = head_chain_active && *lane == 0;
        (if pin { 0 } else { 1 }, *row, *lane)
    });
    let mut remap: HashMap<u32, u32> = HashMap::with_capacity(order.len());
    for (new_idx, (old_lane, _)) in order.into_iter().enumerate() {
        remap.insert(old_lane, new_idx as u32);
    }
    for n in nodes.iter_mut() {
        if let Some(&new_lane) = remap.get(&n.lane) { n.lane = new_lane; }
        for pl in n.parent_lanes.iter_mut() {
            if let Some(&new) = remap.get(pl) { *pl = new; }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(sha: &str, parents: &[&str]) -> Commit {
        Commit {
            sha: sha.into(),
            parents: parents.iter().map(|s| s.to_string()).collect(),
            author_name: "a".into(),
            author_email: "a@x".into(),
            timestamp: 0,
            subject: sha.into(),
        }
    }

    #[test]
    fn linear_history_single_lane() {
        let nodes = assign_lanes(vec![c("c", &["b"]), c("b", &["a"]), c("a", &[])], None);
        assert_eq!(nodes.iter().map(|n| n.lane).collect::<Vec<_>>(), vec![0, 0, 0]);
    }

    #[test]
    fn merge_commit_allocates_second_lane() {
        // m has two parents; after m, parent1 stays in lane0, parent2 gets lane1
        let nodes = assign_lanes(vec![
            c("m", &["p1", "p2"]),
            c("p1", &["base"]),
            c("p2", &["base"]),
            c("base", &[]),
        ], None);
        assert_eq!(nodes[0].lane, 0);
        assert_eq!(nodes[0].parent_lanes, vec![0, 1]);
        assert_eq!(nodes[1].lane, 0);
        assert_eq!(nodes[2].lane, 1);
        // both lanes converge into base
        assert_eq!(nodes[3].lane, 0);
    }

    #[test]
    fn diverged_branches_use_different_lanes() {
        // tip2 is unrelated, allocates lane1
        let nodes = assign_lanes(vec![
            c("tip1", &["base"]),
            c("tip2", &["base"]),
            c("base", &[]),
        ], None);
        assert_eq!(nodes[0].lane, 0);
        assert_eq!(nodes[1].lane, 1);
        assert_eq!(nodes[2].lane, 0);
    }
}
