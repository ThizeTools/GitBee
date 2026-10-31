use crate::error::AppResult;
use crate::git::GitRunner;
use crate::state::AppState;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::State;

// Commit search across the whole history, not only the loaded graph slice.
// See docs/specs/history-search.md.

/// Shas returned when the caller gives no limit. WHY a cap: a one-letter query
/// matches most of a large history, and the UI only steps through the first few.
pub const DEFAULT_SEARCH_LIMIT: usize = 200;

/// A commit sha with its committer time (unix seconds), from `--format=%H %ct`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimedSha {
    pub sha: String,
    pub timestamp: i64,
}

/// Searches commit messages and authors across all refs and returns full shas,
/// newest first, at most `limit`. A hex query that names a commit comes first.
/// Example: `graph_search(path, "fix login", None)`.
#[tauri::command]
pub async fn graph_search(
    path: String,
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.unwrap_or(DEFAULT_SEARCH_LIMIT);
    let cwd = PathBuf::from(&path);
    let (sha_hits, by_message, by_author) = tokio::join!(
        resolve_sha(&state.git, &cwd, q),
        search_log(&state.git, &cwd, "--grep=", q, limit),
        search_log(&state.git, &cwd, "--author=", q, limit),
    );
    let timed: Vec<TimedSha> = by_message.into_iter().chain(by_author).collect();
    Ok(merge_hits(sha_hits, timed, limit))
}

/// `git log` arguments for one field search. The query is attached to its flag
/// (`--grep=<q>`), so a query starting with '-' stays a value, never an option.
/// `--fixed-strings` makes it literal text and `-i` ignores case.
/// Example: `log_search_args("--grep=", "fix", 200)`.
pub fn log_search_args(flag: &str, query: &str, limit: usize) -> Vec<String> {
    vec![
        "log".into(),
        "--all".into(),
        "--format=%H %ct".into(),
        "-i".into(),
        "--fixed-strings".into(),
        format!("{flag}{query}"),
        format!("-n{limit}"),
    ]
}

/// Runs one `git log` field search. A failing search counts as no hits: the
/// local matches the UI already shows keep working, and the search is best effort.
async fn search_log(git: &GitRunner, cwd: &Path, flag: &str, query: &str, limit: usize) -> Vec<TimedSha> {
    match git.run_text(cwd, log_search_args(flag, query, limit)).await {
        Ok(out) => parse_timed_lines(&out),
        Err(_) => Vec::new(),
    }
}

/// Parses `--format=%H %ct` output: one "<sha> <unix time>" per line. Lines
/// that do not have that shape are skipped.
/// Example: `parse_timed_lines("abc 100\n")` gives one entry with timestamp 100.
pub fn parse_timed_lines(out: &str) -> Vec<TimedSha> {
    out.lines()
        .filter_map(|line| {
            let (sha, ts) = line.trim().split_once(' ')?;
            Some(TimedSha { sha: sha.to_string(), timestamp: ts.trim().parse().ok()? })
        })
        .collect()
}

/// The commit a hex query names, as the only hit. `rev-parse` runs only for hex
/// prefixes, so a query such as "-x" never reaches git as an option.
async fn resolve_sha(git: &GitRunner, cwd: &Path, query: &str) -> Vec<String> {
    if !is_hex_prefix(query) {
        return Vec::new();
    }
    let spec = format!("{query}^{{commit}}");
    // Exit status 1 when the prefix names nothing: that is an empty hit, not an error.
    match git.run_text(cwd, ["rev-parse", "--verify", "--quiet", spec.as_str()]).await {
        Ok(out) => {
            let sha = out.trim();
            if sha.is_empty() { Vec::new() } else { vec![sha.to_string()] }
        }
        Err(_) => Vec::new(),
    }
}

/// True for a 4-40 character hex string, the shape of a sha prefix worth resolving.
/// Example: `is_hex_prefix("ab12")` is true, `is_hex_prefix("fix")` is false.
pub fn is_hex_prefix(query: &str) -> bool {
    (4..=40).contains(&query.len()) && query.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Unique shas: the exact sha hit first, then text hits newest first, cut to
/// `limit`. WHY newest first: the UI counts the matches that are not loaded yet,
/// and those are the oldest ones, so the newest matches must come first.
pub fn merge_hits(sha_hits: Vec<String>, mut timed: Vec<TimedSha>, limit: usize) -> Vec<String> {
    timed.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    let mut seen: HashSet<String> = HashSet::new();
    sha_hits
        .into_iter()
        .chain(timed.into_iter().map(|t| t.sha))
        .filter(|sha| seen.insert(sha.clone()))
        .take(limit)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn timed(sha: &str, ts: i64) -> TimedSha {
        TimedSha { sha: sha.into(), timestamp: ts }
    }

    #[test]
    fn query_stays_attached_to_its_flag() {
        let args = log_search_args("--grep=", "-x", 5);
        assert!(args.contains(&"--grep=-x".to_string()));
        assert!(!args.contains(&"-x".to_string()));
        assert!(args.contains(&"--fixed-strings".to_string()));
        assert!(args.contains(&"-i".to_string()));
        assert!(args.contains(&"-n5".to_string()));
    }

    #[test]
    fn author_search_uses_the_author_flag_and_all_refs() {
        let args = log_search_args("--author=", "Ann", 7);
        assert!(args.contains(&"--author=Ann".to_string()));
        assert!(args.contains(&"--all".to_string()));
        assert!(args.contains(&"--format=%H %ct".to_string()));
    }

    #[test]
    fn hex_prefix_needs_four_to_forty_hex_digits() {
        assert!(is_hex_prefix("ab12"));
        assert!(is_hex_prefix(&"a".repeat(40)));
        assert!(!is_hex_prefix("abc"));
        assert!(!is_hex_prefix(&"a".repeat(41)));
        assert!(!is_hex_prefix("fix login"));
        assert!(!is_hex_prefix("xyz1"));
        assert!(!is_hex_prefix(""));
    }

    #[test]
    fn parse_timed_lines_skips_malformed_lines() {
        let parsed = parse_timed_lines("abc 100\nno-time\ndef x\n\nghi 50\n");
        assert_eq!(parsed, vec![timed("abc", 100), timed("ghi", 50)]);
    }

    #[test]
    fn merge_puts_the_sha_hit_first_then_newest_first() {
        let merged = merge_hits(
            vec!["sha0".into()],
            vec![timed("old", 10), timed("new", 30), timed("mid", 20)],
            10,
        );
        assert_eq!(merged, vec!["sha0", "new", "mid", "old"]);
    }

    #[test]
    fn merge_keeps_each_sha_once() {
        let merged = merge_hits(
            vec!["dup".into()],
            vec![timed("dup", 5), timed("other", 1)],
            10,
        );
        assert_eq!(merged, vec!["dup", "other"]);
    }

    #[test]
    fn merge_cuts_to_the_limit() {
        let merged = merge_hits(vec![], vec![timed("a", 3), timed("b", 2), timed("c", 1)], 2);
        assert_eq!(merged, vec!["a", "b"]);
    }

    /// A throwaway repo under the temp dir, removed on drop. Commits are made by
    /// "Ann Tester" so the author search has something to match.
    struct TempRepo {
        root: PathBuf,
    }

    impl TempRepo {
        fn new(name: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir()
                .join(format!("gitbee-search-test-{name}-{}-{nanos}", std::process::id()));
            std::fs::create_dir_all(&root).unwrap();
            let repo = Self { root };
            repo.git(&["init", "-q"]);
            repo.git(&["config", "user.name", "Ann Tester"]);
            repo.git(&["config", "user.email", "ann@example.test"]);
            repo.git(&["config", "commit.gpgsign", "false"]);
            repo
        }

        fn git(&self, args: &[&str]) -> String {
            let out = std::process::Command::new("git")
                .args(args)
                .current_dir(&self.root)
                .output()
                .unwrap();
            assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        }

        /// Commits `file` with `message` and returns the new full sha.
        fn commit(&self, file: &str, message: &str) -> String {
            std::fs::write(self.root.join(file), message).unwrap();
            self.git(&["add", file]);
            self.git(&["commit", "-q", "-m", message]);
            self.git(&["rev-parse", "HEAD"])
        }
    }

    impl Drop for TempRepo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    // Runs the real git calls the command makes, so a wrong flag or a wrong
    // format string fails here rather than only in the app.
    #[tokio::test]
    async fn search_finds_message_author_and_sha_prefix_in_real_git() {
        let repo = TempRepo::new("match");
        let fix = repo.commit("a.txt", "Fix login bug");
        repo.commit("b.txt", "Unrelated change");
        let git = GitRunner::discover().unwrap();

        let by_message = search_log(&git, &repo.root, "--grep=", "fix login", 10).await;
        assert_eq!(by_message.len(), 1);
        assert_eq!(by_message[0].sha, fix);

        let by_author = search_log(&git, &repo.root, "--author=", "ann tester", 10).await;
        assert_eq!(by_author.len(), 2);

        assert_eq!(resolve_sha(&git, &repo.root, &fix[..8]).await, vec![fix.clone()]);
    }

    #[tokio::test]
    async fn search_treats_dash_queries_as_text_and_misses_quietly() {
        let repo = TempRepo::new("dash");
        repo.commit("a.txt", "Plain subject");
        let git = GitRunner::discover().unwrap();

        assert!(search_log(&git, &repo.root, "--grep=", "--oneline", 10).await.is_empty());
        assert!(resolve_sha(&git, &repo.root, "ffffffff").await.is_empty());
        assert!(resolve_sha(&git, &repo.root, "-x").await.is_empty());
    }
}
