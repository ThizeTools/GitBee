//! Parser and argument builder for the file history view: `git log --follow`
//! on one file, read as NUL-separated tokens.
//!
//! The format separates fields with NUL, and `-z` separates records with NUL,
//! so the output is one flat run of tokens. A `\x01` marks each commit header,
//! which is how the parser tells a header from a change record. See
//! docs/specs/file-history-blame.md.

use crate::error::{AppError, AppResult};
use serde::Serialize;

/// Starts each commit header. SOH cannot occur in a sha or a subject line.
const COMMIT_MARK: char = '\u{1}';

/// Status letters git prints in `--name-status` output. `R` and `C` carry two
/// paths; the others carry one.
const CHANGE_LETTERS: &str = "ACDMRTUX";

/// `--format` for one commit header: sha, parents, author name, author email,
/// author time, subject. The fields are NUL-separated.
const HEADER_FORMAT: &str = "--format=%x01%H%x00%P%x00%an%x00%ae%x00%at%x00%s";

/// Page size when the caller gives no limit, and the largest page allowed.
pub const DEFAULT_LIMIT: usize = 500;
pub const MAX_LIMIT: usize = 2000;

/// One commit that touched the followed file. `path_at_commit` is the file's
/// name in that commit: before a rename it is the old name, so the diff and
/// blame of that commit can be asked for the right path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileLogEntry {
    pub sha: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub subject: String,
    pub path_at_commit: String,
    /// First letter of git's status: `A M D R C T U X`.
    pub status: String,
}

/// Rejects an empty file name. Git reads an empty pathspec as the whole
/// repository, so an empty name would list every commit.
pub fn require_file(file: &str) -> AppResult<&str> {
    if file.is_empty() {
        return Err(AppError::Other(format!(
            "file must be a non-empty repo-relative path, got {file:?}"
        )));
    }
    Ok(file)
}

/// Pathspec that matches `file` exactly. Without the `:(literal)` magic git
/// reads `*`, `?` and `[` in a name as glob characters, so `a[1].txt` would
/// match the wrong file or none. `log` accepts this magic; `blame` does not
/// (see `git::blame::blame_args`).
pub fn literal_pathspec(file: &str) -> AppResult<String> {
    Ok(format!(":(literal){}", require_file(file)?))
}

/// Arguments for one page of a file's history. `--follow` keeps the history
/// across renames, `--diff-merges=first-parent` gives a merge the same diff
/// base the commit details use, and `skip` passes over the commits already
/// shown. `limit` is clamped to `1..=MAX_LIMIT`.
pub fn file_log_args(file: &str, limit: usize, skip: usize) -> AppResult<Vec<String>> {
    Ok(vec![
        "log".into(),
        "--follow".into(),
        "--name-status".into(),
        "-z".into(),
        "--diff-merges=first-parent".into(),
        HEADER_FORMAT.into(),
        format!("-n{}", limit.clamp(1, MAX_LIMIT)),
        format!("--skip={skip}"),
        "--".into(),
        literal_pathspec(file)?,
    ])
}

/// One `--name-status -z` record: the status letter and the path the commit
/// has for the file.
struct Change {
    status: String,
    path: String,
}

/// Parses the output of `file_log_args`. A commit with no change record (a
/// merge with no diff against its first parent) is skipped.
pub fn parse_file_log(text: &str) -> Vec<FileLogEntry> {
    let tokens: Vec<&str> = text.split('\0').collect();
    let mut out = Vec::new();
    let mut at = 0;
    while at < tokens.len() {
        match read_entry(&tokens, at) {
            Some((entry, next)) => {
                out.push(entry);
                at = next;
            }
            None => at += 1,
        }
    }
    out
}

/// Reads one commit header and its change record starting at token `at`.
/// Returns the entry and the index of the token after it.
fn read_entry(tokens: &[&str], at: usize) -> Option<(FileLogEntry, usize)> {
    let sha = tokens.get(at)?.trim_start_matches('\n').strip_prefix(COMMIT_MARK)?;
    // parents, author name, author email, author time, subject
    let fields = tokens.get(at + 1..at + 6)?;
    let (change, next) = read_change(tokens, at + 6)?;
    let entry = FileLogEntry {
        sha: sha.to_string(),
        parents: fields[0].split(' ').filter(|p| !p.is_empty()).map(String::from).collect(),
        author_name: fields[1].to_string(),
        author_email: fields[2].to_string(),
        timestamp: fields[3].parse().unwrap_or(0),
        subject: fields[4].to_string(),
        path_at_commit: change.path,
        status: change.status,
    };
    Some((entry, next))
}

/// Reads one name-status record at token `at`: `M\0path`, or `R100\0old\0new`
/// for a rename or copy. For those the second path is the one the commit has.
/// Git prints a newline before the first record, so it is trimmed here.
fn read_change(tokens: &[&str], at: usize) -> Option<(Change, usize)> {
    let raw = tokens.get(at)?.trim_start_matches('\n');
    let letter = raw.chars().next().filter(|c| CHANGE_LETTERS.contains(*c))?;
    let status = letter.to_string();
    if matches!(letter, 'R' | 'C') {
        let path = non_empty(tokens.get(at + 2))?;
        return Some((Change { status, path }, at + 3));
    }
    let path = non_empty(tokens.get(at + 1))?;
    Some((Change { status, path }, at + 2))
}

fn non_empty(token: Option<&&str>) -> Option<String> {
    token.filter(|t| !t.is_empty()).map(|t| t.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two commits: the newer renames `a.txt` to `b.txt`, the older added `a.txt`.
    /// The header and record layout is what `git log -z --name-status` prints.
    const RENAME_LOG: &str = "\x01c2\0c1\0Ann\0ann@x.io\01700000100\0rename\0\nR100\0a.txt\0b.txt\0\x01c1\0\0Ann\0ann@x.io\01700000000\0add a\0\nA\0a.txt\0";

    #[test]
    fn parses_header_fields_and_the_change_record() {
        let text = "\x01c1\0\0Ann\0ann@x.io\01700000000\0add a\0\nA\0a.txt\0";
        let entries = parse_file_log(text);
        assert_eq!(entries.len(), 1);
        let e = &entries[0];
        assert_eq!(e.sha, "c1");
        assert!(e.parents.is_empty(), "a root commit has no parents");
        assert_eq!(e.author_name, "Ann");
        assert_eq!(e.author_email, "ann@x.io");
        assert_eq!(e.timestamp, 1_700_000_000);
        assert_eq!(e.subject, "add a");
        assert_eq!(e.path_at_commit, "a.txt");
        assert_eq!(e.status, "A");
    }

    #[test]
    fn rename_reports_the_new_name_for_the_renamed_commit_and_the_old_one_before_it() {
        let entries = parse_file_log(RENAME_LOG);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].status, "R");
        assert_eq!(entries[0].path_at_commit, "b.txt");
        assert_eq!(entries[1].status, "A");
        assert_eq!(entries[1].path_at_commit, "a.txt");
    }

    #[test]
    fn deleted_file_keeps_the_path_it_had() {
        let text = "\x01c3\0c2\0Ann\0ann@x.io\01700000200\0remove\0\nD\0b.txt\0";
        let e = &parse_file_log(text)[0];
        assert_eq!(e.status, "D");
        assert_eq!(e.path_at_commit, "b.txt");
    }

    #[test]
    fn splits_multiple_parents_on_spaces() {
        let text = "\x01m1\0p1 p2\0Ann\0ann@x.io\01\0merge\0\nM\0a.txt\0";
        assert_eq!(parse_file_log(text)[0].parents, vec!["p1".to_string(), "p2".to_string()]);
    }

    #[test]
    fn keeps_a_path_with_newline_and_tab_as_written() {
        let text = "\x01c4\0c3\0Ann\0ann@x.io\01\0odd\0\nM\0dir\tx\nname.txt\0";
        assert_eq!(parse_file_log(text)[0].path_at_commit, "dir\tx\nname.txt");
    }

    #[test]
    fn skips_a_commit_with_no_change_record() {
        let text = "\x01m1\0p1 p2\0Ann\0ann@x.io\01\0merge\0\x01c1\0\0Ann\0ann@x.io\01\0add\0\nA\0a.txt\0";
        let entries = parse_file_log(text);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].sha, "c1");
    }

    #[test]
    fn empty_output_gives_no_entries() {
        assert!(parse_file_log("").is_empty());
    }

    #[test]
    fn file_log_args_follow_renames_and_match_the_path_literally() {
        let args = file_log_args("a[1].txt", 50, 100).unwrap();
        assert!(args.contains(&"--follow".to_string()));
        assert!(args.contains(&"-z".to_string()));
        assert!(args.contains(&"-n50".to_string()));
        assert!(args.contains(&"--skip=100".to_string()));
        assert_eq!(args.last().unwrap(), ":(literal)a[1].txt");
        let sep = args.iter().position(|a| a == "--").unwrap();
        assert_eq!(sep, args.len() - 2, "the pathspec follows --");
    }

    #[test]
    fn file_log_args_clamp_the_limit() {
        assert!(file_log_args("a", 0, 0).unwrap().contains(&"-n1".to_string()));
        assert!(file_log_args("a", 99_999, 0).unwrap().contains(&format!("-n{MAX_LIMIT}")));
    }

    #[test]
    fn empty_file_is_refused_with_the_value_shown() {
        let err = file_log_args("", 10, 0).unwrap_err().to_string();
        assert!(err.contains("non-empty"), "unexpected message: {err}");
    }
}
