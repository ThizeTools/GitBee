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

/// Picks the commit whose first-parent chain takes lane 0: the pinned ref's
/// commit when it is in the loaded slice, otherwise HEAD. Returns None when
/// neither is loaded, so no lane is reserved.
///
/// WHY the slice check: a pinned tip older than the load limit has no chain
/// here, and lane 0 must not stay empty for it. HEAD is the documented fallback
/// (docs/specs/lane-pin.md). Example: `pick_lane0_tip(&commits, Some("p2"), Some("h2"))`.
pub fn pick_lane0_tip<'a>(
    commits: &[Commit],
    pinned: Option<&'a str>,
    head: Option<&'a str>,
) -> Option<&'a str> {
    let loaded = |sha: &str| !sha.is_empty() && commits.iter().any(|c| c.sha == sha);
    match pinned {
        Some(p) if loaded(p) => Some(p),
        _ => head.filter(|h| loaded(h)),
    }
}

/// Assign lanes to commits in display order (newest first).
///
/// `lane0_tip` is the commit whose first-parent chain takes lane 0 (see
/// `pick_lane0_tip`: the pinned ref, else HEAD). Every other lane starts at 1.
/// See docs/specs/lane-pin.md.
///
/// Algorithm:
/// - Pre-pass walks parents from `lane0_tip` to mark every commit on that chain.
///   Those commits are pinned to lane 0 so the active branch stays visually
///   leftmost (GitKraken-style), even if its tip is older than other branches'
///   tips. Without this, `git log --all` ordering could place an unrelated tip
///   on lane 0 first and push the chain outward.
/// - Maintain a vector of "open lanes". Each slot is either free or
///   waiting for a specific SHA (the next commit expected on that lane).
/// - Process commits top-to-bottom (newer to older, as `git log` returns).
/// - For each commit:
///   - If any lanes are waiting for this commit's SHA, the leftmost wins
///     and becomes the commit's lane. Other waiting lanes converge here
///     (a merge into the kept lane) and are freed.
///   - Otherwise (a new tip): if commit is on the lane-0 chain, claim lane 0
///     (booting any non-chain tenant out into a new lane). Else allocate
///     leftmost free lane skipping lane 0 when it's reserved for the chain.
///   - Replace the chosen lane's awaited SHA with the commit's first parent.
///   - Any additional parents (merge commits) get newly allocated lanes.
pub fn assign_lanes(commits: Vec<Commit>, lane0_tip: Option<&str>) -> Vec<GraphNode> {
    let lane0_chain = build_lane0_chain(&commits, lane0_tip);
    let lane0_active = !lane0_chain.is_empty();

    let mut lanes: Vec<Option<String>> = Vec::new();
    let mut nodes: Vec<GraphNode> = Vec::with_capacity(commits.len());

    for (row, c) in commits.into_iter().enumerate() {
        let on_lane0 = lane0_chain.contains(&c.sha);
        let waiting: Vec<usize> = lanes
            .iter()
            .enumerate()
            .filter_map(|(i, l)| (l.as_deref() == Some(c.sha.as_str())).then_some(i))
            .collect();

        let my_lane = if waiting.is_empty() {
            allocate_lane(&mut lanes, on_lane0, lane0_active)
        } else if on_lane0 && waiting[0] != 0 {
            // Chain commit but its waiting lane isn't 0. If lane 0 is free,
            // pull it down to lane 0 and free the side lanes. This keeps the
            // chain's column straight even when a parent was speculatively
            // parked on a higher lane.
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
                let lane = side_parent_lane(&mut lanes, parent, lane0_active);
                parent_lanes.push(lane as u32);
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

    compact_lanes_by_first_use(&mut nodes, lane0_active);
    nodes
}

/// Lane for a merge's side parent. If some lane already awaits that
/// parent (e.g. a branch that kept going after being merged), join it
/// instead of opening a second line that runs parallel down to the same
/// commit. Otherwise allocate an outer lane: side parents of a lane-0 merge
/// are NOT on the chain themselves. See docs/specs/graph-visual-2026-10.md.
fn side_parent_lane(lanes: &mut Vec<Option<String>>, parent: &str, lane0_active: bool) -> usize {
    if let Some(existing) = lanes.iter().position(|l| l.as_deref() == Some(parent)) {
        return existing;
    }
    let new_lane = allocate_lane(lanes, false, lane0_active);
    lanes[new_lane] = Some(parent.to_string());
    new_lane
}

/// Walk parent links from the lane-0 tip to collect every commit on that chain
/// within the loaded slice. Returns empty if the tip is unknown or its sha
/// isn't present in the slice. We restrict the walk to the slice so
/// out-of-range parents never throw off lane assignment.
fn build_lane0_chain(commits: &[Commit], tip: Option<&str>) -> HashSet<String> {
    let head = match tip {
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

/// Pick a free lane. When `for_lane0_chain` is true, prefer lane 0 even
/// if it's "available". When false and lane 0 is reserved for the chain,
/// skip it: non-chain tips never claim the leftmost column.
fn allocate_lane(
    lanes: &mut Vec<Option<String>>,
    for_lane0_chain: bool,
    lane0_active: bool,
) -> usize {
    if for_lane0_chain {
        ensure_lane(lanes, 0);
        return 0;
    }
    let start = if lane0_active { 1 } else { 0 };
    // Reserve the slots below `start` even when they do not exist yet. Without
    // this, an empty `lanes` pushed a new slot at index 0 and handed lane 0 to a
    // non-chain tip, which the chain then had to boot out.
    while lanes.len() < start {
        lanes.push(None);
    }
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
/// was reused after another branch terminated. The lane-0 chain's lane 0
/// is preserved when present.
fn compact_lanes_by_first_use(nodes: &mut [GraphNode], lane0_active: bool) {
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
    // Lane 0 is pinned when a lane-0 reservation is in effect so the chain's
    // column never shifts under the user.
    order.sort_by_key(|(lane, row)| {
        let pin = lane0_active && *lane == 0;
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

    fn lane_of(nodes: &[GraphNode], sha: &str) -> u32 {
        nodes.iter().find(|n| n.sha == sha).unwrap().lane
    }

    /// HEAD (h2) and a pinned branch (p2) diverged from `base`. Rows are date-ordered.
    fn diverged_fixture() -> Vec<Commit> {
        vec![
            c("h2", &["h1"]),
            c("p2", &["p1"]),
            c("h1", &["base"]),
            c("p1", &["base"]),
            c("base", &[]),
        ]
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

    #[test]
    fn merge_parent_already_awaited_reuses_its_lane() {
        // f2 continued the feature after f1 was merged into main by m.
        let nodes = assign_lanes(vec![
            c("f2", &["f1"]),
            c("m", &["p", "f1"]),
            c("f1", &["base"]),
            c("p", &["base"]),
            c("base", &[]),
        ], None);
        assert_eq!(nodes[1].parent_lanes[1], nodes[0].lane);
        assert_eq!(nodes[2].lane, nodes[0].lane);
    }

    #[test]
    fn no_pin_keeps_head_chain_on_lane_zero() {
        let commits = diverged_fixture();
        let tip = pick_lane0_tip(&commits, None, Some("h2"));
        let nodes = assign_lanes(commits, tip);
        assert_eq!(lane_of(&nodes, "h2"), 0);
        assert_eq!(lane_of(&nodes, "h1"), 0);
        assert_ne!(lane_of(&nodes, "p2"), 0);
    }

    #[test]
    fn pinned_chain_takes_lane_zero_and_head_moves_aside() {
        let commits = diverged_fixture();
        let tip = pick_lane0_tip(&commits, Some("p2"), Some("h2"));
        let nodes = assign_lanes(commits, tip);
        assert_eq!(lane_of(&nodes, "p2"), 0);
        assert_eq!(lane_of(&nodes, "p1"), 0);
        assert_eq!(lane_of(&nodes, "base"), 0);
        assert_ne!(lane_of(&nodes, "h2"), 0);
        assert_eq!(lane_of(&nodes, "h1"), lane_of(&nodes, "h2"));
    }

    // Regression: a non-chain tip listed before the chain used to take lane 0
    // while lanes was still empty, and the chain then booted it out.
    #[test]
    fn non_chain_tip_listed_first_does_not_take_lane_zero() {
        let nodes = assign_lanes(vec![
            c("u", &["base"]),
            c("p", &["base"]),
            c("base", &[]),
        ], Some("p"));
        assert_eq!(lane_of(&nodes, "p"), 0);
        assert_eq!(lane_of(&nodes, "u"), 1);
    }

    #[test]
    fn lanes_stay_compact_with_pinned_chain_and_unrelated_tip() {
        let nodes = assign_lanes(vec![
            c("u1", &["base"]),
            c("h2", &["h1"]),
            c("p2", &["p1"]),
            c("h1", &["base"]),
            c("p1", &["base"]),
            c("base", &[]),
        ], Some("p2"));
        let mut used: Vec<u32> = nodes.iter().map(|n| n.lane).collect();
        used.sort_unstable();
        used.dedup();
        assert_eq!(used, (0..used.len() as u32).collect::<Vec<u32>>());
        assert_eq!(lane_of(&nodes, "p2"), 0);
    }

    #[test]
    fn pick_lane0_tip_prefers_a_loaded_pin_over_head() {
        let commits = diverged_fixture();
        assert_eq!(pick_lane0_tip(&commits, Some("p2"), Some("h2")), Some("p2"));
    }

    #[test]
    fn pick_lane0_tip_falls_back_to_head_when_pin_is_not_loaded() {
        let commits = diverged_fixture();
        assert_eq!(pick_lane0_tip(&commits, Some("gone"), Some("h2")), Some("h2"));
        assert_eq!(pick_lane0_tip(&commits, Some(""), Some("h2")), Some("h2"));
        assert_eq!(pick_lane0_tip(&commits, None, Some("h2")), Some("h2"));
    }

    #[test]
    fn pick_lane0_tip_is_none_when_nothing_is_loaded() {
        let commits = diverged_fixture();
        assert_eq!(pick_lane0_tip(&commits, Some("gone"), Some("also-gone")), None);
        assert_eq!(pick_lane0_tip(&commits, None, None), None);
    }
}
