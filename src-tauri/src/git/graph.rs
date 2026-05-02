use crate::git::types::Commit;
use serde::Serialize;

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
/// - Maintain a vector of "open lanes". Each slot is either free or
///   waiting for a specific SHA (the next commit expected on that lane).
/// - Process commits top-to-bottom (newer to older, as `git log` returns).
/// - For each commit:
///   - If any lanes are waiting for this commit's SHA, the leftmost wins
///     and becomes the commit's lane. Other waiting lanes converge here
///     (a merge into the kept lane) and are freed.
///   - Otherwise (a new tip), allocate the leftmost free lane.
///   - Replace the chosen lane's awaited SHA with the commit's first parent.
///   - Any additional parents (merge commits) get newly allocated lanes.
pub fn assign_lanes(commits: Vec<Commit>) -> Vec<GraphNode> {
    let mut lanes: Vec<Option<String>> = Vec::new();
    let mut nodes: Vec<GraphNode> = Vec::with_capacity(commits.len());

    for (row, c) in commits.into_iter().enumerate() {
        let waiting: Vec<usize> = lanes
            .iter()
            .enumerate()
            .filter_map(|(i, l)| (l.as_deref() == Some(c.sha.as_str())).then_some(i))
            .collect();

        let my_lane = if waiting.is_empty() {
            allocate_lane(&mut lanes)
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
                let new_lane = allocate_lane(&mut lanes);
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

    nodes
}

fn allocate_lane(lanes: &mut Vec<Option<String>>) -> usize {
    if let Some(idx) = lanes.iter().position(Option::is_none) {
        return idx;
    }
    lanes.push(None);
    lanes.len() - 1
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
        let nodes = assign_lanes(vec![c("c", &["b"]), c("b", &["a"]), c("a", &[])]);
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
        ]);
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
        ]);
        assert_eq!(nodes[0].lane, 0);
        assert_eq!(nodes[1].lane, 1);
        assert_eq!(nodes[2].lane, 0);
    }
}
