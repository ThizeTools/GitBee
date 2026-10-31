//! Pure parsers for `git diff-tree` and `git log` output in `-z` form.
//!
//! `-z` output is NUL-separated and never quotes paths. A path with a tab, a
//! newline or non-ASCII bytes therefore comes through unchanged. The text
//! forms (`--numstat` without `-z`) quote such paths and break a split on
//! tabs. See docs/specs/commit-details.md.

use serde::Serialize;
use std::collections::HashMap;

/// Starts each commit in `git log --format=%x01%H` output. SOH cannot occur in
/// a sha, so the marker never collides with a numstat or name-status record.
const COMMIT_MARK: char = '\u{1}';

/// One changed file of a commit, as the commit details list shows it.
/// `path` is the new path (the old one for a deletion). `old_path` is set for
/// renames and copies. `additions` and `deletions` are None for binary files,
/// which git reports as `-`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommitFileStat {
    pub path: String,
    pub old_path: Option<String>,
    /// First letter of git's status: `A M D R C T`.
    pub status: String,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

/// Totals for one commit, from `commit_stats`. A binary file counts as one
/// file with no lines.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommitStat {
    pub sha: String,
    pub files: u32,
    pub additions: u32,
    pub deletions: u32,
}

/// One `--numstat -z` record. Renames and copies carry the old path.
#[derive(Debug, Clone, PartialEq, Eq)]
struct NumstatRecord {
    path: String,
    old_path: Option<String>,
    additions: Option<u32>,
    deletions: Option<u32>,
}

/// One `--name-status -z` record. `status` is one letter, the similarity
/// score dropped (`R070` is `R`).
#[derive(Debug, Clone, PartialEq, Eq)]
struct NameStatusRecord {
    status: String,
    path: String,
    old_path: Option<String>,
}

/// Builds one commit's file list from its `--numstat -z` and
/// `--name-status -z` output. Both must come from the same `diff-tree`
/// options, so rename detection agrees between them.
///
/// The name-status list decides which files appear and in what order. The
/// numstat list supplies the counts, matched by new path. A file missing from
/// numstat gets no counts, which the UI shows as it shows a binary file.
///
/// Usage: `file_stats("1\t0\ta.txt\0", "M\0a.txt\0")` gives `a.txt` with
/// one addition and no deletions.
pub fn file_stats(numstat_text: &str, name_status_text: &str) -> Vec<CommitFileStat> {
    let numstat = read_all(&tokens(numstat_text), read_numstat);
    let names = read_all(&tokens(name_status_text), read_name_status);
    join_records(&numstat, &names)
}

/// Parses `commit_stats` output: a `\x01<sha>` header per commit, followed by
/// that commit's numstat records. Commits keep the order git printed them in.
pub fn parse_commit_stats(text: &str) -> Vec<CommitStat> {
    let tokens = tokens(text);
    let mut stats: Vec<CommitStat> = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let head = tokens[i].trim_start_matches('\n');
        if let Some(sha) = head.strip_prefix(COMMIT_MARK) {
            stats.push(CommitStat { sha: sha.trim().to_string(), files: 0, additions: 0, deletions: 0 });
            i += 1;
        } else if let Some(record) = read_numstat(&tokens, &mut i) {
            if let Some(stat) = stats.last_mut() {
                add_record(stat, &record);
            }
        } else {
            i += 1;
        }
    }
    stats
}

/// Splits `-z` output on NUL. Empty tokens are kept, so a path token is never
/// shifted by a missing record; the readers skip them.
fn tokens(text: &str) -> Vec<&str> {
    text.split('\0').collect()
}

/// Runs `read` from the start of `tokens` until the input ends. A token the
/// reader rejects is skipped (the terminator after the last record, for one).
fn read_all<T>(tokens: &[&str], read: impl Fn(&[&str], &mut usize) -> Option<T>) -> Vec<T> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        match read(tokens, &mut i) {
            Some(record) => out.push(record),
            None => i += 1,
        }
    }
    out
}

/// Reads the numstat record at `tokens[*i]` and advances `*i` past it. Returns
/// None, leaving `*i` alone, when the token is not `adds\tdels\tpath`.
///
/// Git prints a newline before the first record of a commit in `git log`
/// output, so leading newlines are dropped from the record's first token. A
/// rename's line ends in a tab with an empty path. Its old and new paths
/// follow as the next two tokens, and those are read raw.
fn read_numstat(tokens: &[&str], i: &mut usize) -> Option<NumstatRecord> {
    let head = tokens.get(*i)?.trim_start_matches('\n');
    let mut fields = head.splitn(3, '\t');
    let (adds, dels, path) = (fields.next()?, fields.next()?, fields.next()?);
    if !is_count(adds) || !is_count(dels) {
        return None;
    }
    let (additions, deletions) = (parse_count(adds), parse_count(dels));
    if !path.is_empty() {
        *i += 1;
        return Some(NumstatRecord { path: path.to_string(), old_path: None, additions, deletions });
    }
    // A rename or copy: its old and new paths are the next two tokens.
    let old = tokens.get(*i + 1)?;
    let new = tokens.get(*i + 2)?;
    *i += 3;
    Some(NumstatRecord {
        path: new.to_string(),
        old_path: Some(old.to_string()),
        additions,
        deletions,
    })
}

/// Reads one `--name-status -z` record at `tokens[*i]`: a status token, then
/// one path, or two for a rename or copy (old, then new).
fn read_name_status(tokens: &[&str], i: &mut usize) -> Option<NameStatusRecord> {
    let head = tokens.get(*i)?.trim_start_matches('\n');
    let status = head.chars().next().filter(|c| c.is_ascii_alphabetic())?;
    if matches!(status, 'R' | 'C') {
        let old = tokens.get(*i + 1)?;
        let new = tokens.get(*i + 2)?;
        *i += 3;
        return Some(NameStatusRecord {
            status: status.to_string(),
            path: new.to_string(),
            old_path: Some(old.to_string()),
        });
    }
    let path = tokens.get(*i + 1)?;
    *i += 2;
    Some(NameStatusRecord { status: status.to_string(), path: path.to_string(), old_path: None })
}

/// Git writes `-` for a binary file and a number otherwise. Anything else is
/// not a count, so the line is not a numstat record.
fn is_count(field: &str) -> bool {
    field == "-" || (!field.is_empty() && field.bytes().all(|b| b.is_ascii_digit()))
}

/// `-` is binary, so None. Numbers too large for u32 also read as None.
fn parse_count(field: &str) -> Option<u32> {
    if field == "-" {
        return None;
    }
    field.parse().ok()
}

/// Pairs each name-status record with the numstat record of the same new path.
fn join_records(numstat: &[NumstatRecord], names: &[NameStatusRecord]) -> Vec<CommitFileStat> {
    let counts: HashMap<&str, &NumstatRecord> =
        numstat.iter().map(|r| (r.path.as_str(), r)).collect();
    names
        .iter()
        .map(|n| {
            let (additions, deletions) = counts
                .get(n.path.as_str())
                .map_or((None, None), |r| (r.additions, r.deletions));
            CommitFileStat {
                path: n.path.clone(),
                old_path: n.old_path.clone(),
                status: n.status.clone(),
                additions,
                deletions,
            }
        })
        .collect()
}

/// Adds one file to a commit's totals. A binary file adds a file but no lines.
fn add_record(stat: &mut CommitStat, record: &NumstatRecord) {
    stat.files = stat.files.saturating_add(1);
    stat.additions = stat.additions.saturating_add(record.additions.unwrap_or(0));
    stat.deletions = stat.deletions.saturating_add(record.deletions.unwrap_or(0));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stat(path: &str, status: &str, add: Option<u32>, del: Option<u32>) -> CommitFileStat {
        CommitFileStat {
            path: path.into(),
            old_path: None,
            status: status.into(),
            additions: add,
            deletions: del,
        }
    }

    fn renamed(old: &str, new: &str, status: &str, add: Option<u32>, del: Option<u32>) -> CommitFileStat {
        CommitFileStat {
            path: new.into(),
            old_path: Some(old.into()),
            status: status.into(),
            additions: add,
            deletions: del,
        }
    }

    #[test]
    fn numstat_reads_plain_records() {
        let got = read_all(&tokens("3\t1\tsrc/a.rs\0\0"), read_numstat);
        assert_eq!(got, vec![NumstatRecord {
            path: "src/a.rs".into(),
            old_path: None,
            additions: Some(3),
            deletions: Some(1),
        }]);
    }

    #[test]
    fn numstat_binary_counts_are_none() {
        let got = read_all(&tokens("-\t-\timg.png\0"), read_numstat);
        assert_eq!(got[0].additions, None);
        assert_eq!(got[0].deletions, None);
        assert_eq!(got[0].path, "img.png");
    }

    #[test]
    fn numstat_rename_reads_old_then_new_path() {
        let got = read_all(&tokens("1\t0\t\0a.txt\0b.txt\0"), read_numstat);
        assert_eq!(got, vec![NumstatRecord {
            path: "b.txt".into(),
            old_path: Some("a.txt".into()),
            additions: Some(1),
            deletions: Some(0),
        }]);
    }

    #[test]
    fn numstat_keeps_tabs_and_newlines_in_paths() {
        let text = "2\t0\tdir/tab\tname.txt\0-\t-\tline\nbreak.bin\0";
        let got = read_all(&tokens(text), read_numstat);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].path, "dir/tab\tname.txt");
        assert_eq!(got[1].path, "line\nbreak.bin");
    }

    #[test]
    fn numstat_skips_a_leading_newline_from_git_log() {
        let got = read_all(&tokens("\n4\t2\tx.rs\0"), read_numstat);
        assert_eq!(got[0].path, "x.rs");
        assert_eq!(got[0].additions, Some(4));
    }

    #[test]
    fn numstat_rejects_lines_without_two_count_fields() {
        let got = read_all(&tokens("oops\0x\ty\tz\0"), read_numstat);
        assert!(got.is_empty());
    }

    #[test]
    fn numstat_empty_input_gives_no_records() {
        assert!(read_all(&tokens(""), read_numstat).is_empty());
    }

    #[test]
    fn name_status_reads_single_path_records() {
        let got = read_all(&tokens("A\0new file.txt\0D\0gone.rs\0T\0link\0"), read_name_status);
        let statuses: Vec<(&str, &str)> = got.iter().map(|r| (r.status.as_str(), r.path.as_str())).collect();
        assert_eq!(statuses, vec![("A", "new file.txt"), ("D", "gone.rs"), ("T", "link")]);
    }

    #[test]
    fn name_status_rename_keeps_score_out_and_reads_both_paths() {
        let got = read_all(&tokens("R070\0a.txt\0b.txt\0"), read_name_status);
        assert_eq!(got, vec![NameStatusRecord {
            status: "R".into(),
            path: "b.txt".into(),
            old_path: Some("a.txt".into()),
        }]);
    }

    #[test]
    fn name_status_copy_reads_both_paths() {
        let got = read_all(&tokens("C075\0src.rs\0dst.rs\0"), read_name_status);
        assert_eq!(got[0].status, "C");
        assert_eq!(got[0].old_path.as_deref(), Some("src.rs"));
        assert_eq!(got[0].path, "dst.rs");
    }

    #[test]
    fn file_stats_joins_counts_by_new_path() {
        let numstat = "1\t0\t\0a.txt\0b.txt\0-\t-\timg.bin\0";
        let names = "R070\0a.txt\0b.txt\0M\0img.bin\0";
        assert_eq!(file_stats(numstat, names), vec![
            renamed("a.txt", "b.txt", "R", Some(1), Some(0)),
            stat("img.bin", "M", None, None),
        ]);
    }

    #[test]
    fn file_stats_keeps_name_status_order_and_status_letters() {
        let numstat = "5\t0\tz.rs\u{0}0\t3\ta.rs\0";
        let names = "A\0z.rs\0M\0a.rs\0";
        let got = file_stats(numstat, names);
        assert_eq!(got.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["z.rs", "a.rs"]);
        assert_eq!(got[1].status, "M");
    }

    #[test]
    fn file_stats_file_without_numstat_gets_no_counts() {
        let got = file_stats("", "D\0gone.txt\0");
        assert_eq!(got, vec![stat("gone.txt", "D", None, None)]);
    }

    #[test]
    fn file_stats_path_with_tab_and_unicode_matches() {
        let numstat = "2\t3\tdir/tab\tü.txt\0";
        let names = "M\0dir/tab\tü.txt\0";
        assert_eq!(file_stats(numstat, names), vec![stat("dir/tab\tü.txt", "M", Some(2), Some(3))]);
    }

    #[test]
    fn file_stats_empty_commit_is_empty() {
        assert!(file_stats("", "").is_empty());
    }

    #[test]
    fn commit_stats_totals_each_commit_in_order() {
        let text = "\u{1}aaa111\0\n1\t0\ta\0\u{1}bbb222\0\n2\t3\tb\0-\t-\tc.png\0";
        assert_eq!(parse_commit_stats(text), vec![
            CommitStat { sha: "aaa111".into(), files: 1, additions: 1, deletions: 0 },
            CommitStat { sha: "bbb222".into(), files: 2, additions: 2, deletions: 3 },
        ]);
    }

    #[test]
    fn commit_stats_rename_counts_as_one_file() {
        let text = "\u{1}abc\0\n1\t1\t\0old.txt\0new.txt\0";
        assert_eq!(parse_commit_stats(text), vec![
            CommitStat { sha: "abc".into(), files: 1, additions: 1, deletions: 1 },
        ]);
    }

    #[test]
    fn commit_stats_commit_without_changes_has_zero_totals() {
        let text = "\u{1}empty\0\u{1}full\0\n3\t0\tx\0";
        let got = parse_commit_stats(text);
        assert_eq!(got[0], CommitStat { sha: "empty".into(), files: 0, additions: 0, deletions: 0 });
        assert_eq!(got[1].files, 1);
    }

    #[test]
    fn commit_stats_reads_real_git_log_layout() {
        // Shape of `git log --no-walk --format=%x01%H --numstat -z` for a
        // rename commit followed by a root commit (checked against git 2.53).
        let text = "\u{1}3e731a0f43d09e04275\0\n1\t0\t\0a.txt\0b.txt\0\
                    1\t0\tdir sub/new file.txt\0-\t-\timg.bin\0\
                    \u{1}be6bc72605c9ab1de438\0\n2\t0\ta.txt\0";
        let got = parse_commit_stats(text);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].files, 3);
        assert_eq!(got[0].additions, 2);
        assert_eq!(got[1], CommitStat { sha: "be6bc72605c9ab1de438".into(), files: 1, additions: 2, deletions: 0 });
    }

    #[test]
    fn commit_stats_ignores_records_before_the_first_header() {
        assert!(parse_commit_stats("1\t0\tstray\0").is_empty());
    }
}
