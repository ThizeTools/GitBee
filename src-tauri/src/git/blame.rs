//! Parser and argument builder for `git blame --porcelain`.
//!
//! Porcelain prints a commit's metadata only at the first line that commit
//! owns. Later lines of that commit get a bare header and their content. The
//! parser keeps one map of commits, so a repeated header needs no lookup. The
//! content line is the only one with a tab, so a tab inside the code is kept.
//! See docs/specs/file-history-blame.md.

use super::file_log::require_file;
use super::runner::checked_ref;
use crate::error::AppResult;
use serde::Serialize;
use std::collections::HashMap;

/// Summary shown for lines git has not committed yet. Porcelain names them
/// with an all-zero sha and a generic summary, which the UI does not need.
pub const NOT_COMMITTED_SUMMARY: &str = "Not committed yet";

/// One source line and the commit that last changed it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BlameLine {
    pub sha: String,
    pub orig_line: u32,
    pub final_line: u32,
    pub content: String,
}

/// Metadata of one commit that owns at least one blamed line.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct BlameCommit {
    pub author_name: String,
    pub author_email: String,
    /// Author time, seconds since the epoch.
    pub author_time: i64,
    pub summary: String,
}

/// Blame of one file: one entry per line in file order, and the metadata of
/// each commit those lines name, keyed by sha.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct BlameResult {
    pub lines: Vec<BlameLine>,
    pub commits: HashMap<String, BlameCommit>,
}

/// The header that starts each blamed line: the sha and the line numbers.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Header {
    sha: String,
    orig_line: u32,
    final_line: u32,
}

/// Arguments for blame of one file, at `rev`, or in the working tree when
/// `rev` is None.
///
/// Blame reads its file argument as a literal path, not a pathspec, so no
/// `:(literal)` magic is added: git refuses it with "no such path". The `--`
/// keeps a name that starts with `-` from being read as an option.
pub fn blame_args(file: &str, rev: Option<&str>) -> AppResult<Vec<String>> {
    let mut args = vec!["blame".to_string(), "--porcelain".to_string()];
    if let Some(r) = rev {
        args.push(checked_ref(r)?.to_string());
    }
    args.push("--".to_string());
    args.push(require_file(file)?.to_string());
    Ok(args)
}

/// Parses `git blame --porcelain` output into lines and commit metadata.
pub fn parse_blame_porcelain(text: &str) -> BlameResult {
    let mut result = BlameResult::default();
    let mut current: Option<Header> = None;
    for line in text.split('\n') {
        if let Some(content) = line.strip_prefix('\t') {
            push_line(&mut result, current.as_ref(), content);
        } else if let Some(header) = parse_header(line) {
            result.commits.entry(header.sha.clone()).or_default();
            current = Some(header);
        } else if let Some(header) = &current {
            apply_metadata(&mut result.commits, &header.sha, line);
        }
    }
    label_uncommitted(&mut result.commits);
    result
}

/// Parses `<sha> <orig-line> <final-line> [<count>]`. Returns None for any
/// other line, so metadata and the `boundary` or `previous` lines fall through.
fn parse_header(line: &str) -> Option<Header> {
    let mut parts = line.split(' ');
    let sha = parts.next().filter(|s| is_object_name(s))?;
    let orig_line = parts.next()?.parse().ok()?;
    let final_line = parts.next()?.parse().ok()?;
    Some(Header { sha: sha.to_string(), orig_line, final_line })
}

/// A full object name: 40 hex digits (SHA-1) or 64 (SHA-256).
fn is_object_name(s: &str) -> bool {
    (s.len() == 40 || s.len() == 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn push_line(result: &mut BlameResult, current: Option<&Header>, content: &str) {
    let Some(header) = current else { return };
    result.lines.push(BlameLine {
        sha: header.sha.clone(),
        orig_line: header.orig_line,
        final_line: header.final_line,
        content: content.to_string(),
    });
}

/// Fills one commit's fields from a metadata line. Other keys (committer,
/// `previous`, `filename`, `boundary`) are not shown, so they are ignored.
fn apply_metadata(commits: &mut HashMap<String, BlameCommit>, sha: &str, line: &str) {
    let Some(commit) = commits.get_mut(sha) else { return };
    if let Some(v) = line.strip_prefix("author ") {
        commit.author_name = v.to_string();
    } else if let Some(v) = line.strip_prefix("author-mail ") {
        commit.author_email = v.trim_start_matches('<').trim_end_matches('>').to_string();
    } else if let Some(v) = line.strip_prefix("author-time ") {
        commit.author_time = v.parse().unwrap_or(0);
    } else if let Some(v) = line.strip_prefix("summary ") {
        commit.summary = v.to_string();
    }
}

/// Gives the uncommitted (all-zero sha) entry the label the UI shows, instead
/// of git's "Version of <file> from <file>" summary.
fn label_uncommitted(commits: &mut HashMap<String, BlameCommit>) {
    for (sha, commit) in commits.iter_mut() {
        if is_uncommitted(sha) {
            commit.summary = NOT_COMMITTED_SUMMARY.to_string();
        }
    }
}

/// True for the all-zero sha git uses for lines in the working tree.
pub fn is_uncommitted(sha: &str) -> bool {
    !sha.is_empty() && sha.bytes().all(|b| b == b'0')
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHA_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const SHA_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const ZERO: &str = "0000000000000000000000000000000000000000";

    #[test]
    fn repeated_header_without_metadata_reuses_the_first_commit_entry() {
        let text = format!(
            "{SHA_A} 1 1 2\nauthor Ann\nauthor-mail <ann@x.io>\nauthor-time 1700000000\nsummary first\nfilename a.txt\n\tline one\n{SHA_A} 2 2\n\tline two\n"
        );
        let result = parse_blame_porcelain(&text);
        assert_eq!(result.lines.len(), 2);
        assert_eq!(result.lines[1].sha, SHA_A);
        assert_eq!(result.lines[1].orig_line, 2);
        assert_eq!(result.lines[1].final_line, 2);
        let commit = &result.commits[SHA_A];
        assert_eq!(commit.author_name, "Ann");
        assert_eq!(commit.author_email, "ann@x.io");
        assert_eq!(commit.author_time, 1_700_000_000);
        assert_eq!(commit.summary, "first");
        assert_eq!(result.commits.len(), 1);
    }

    #[test]
    fn boundary_previous_and_committer_lines_do_not_change_the_commit() {
        let text = format!(
            "{SHA_B} 3 1 1\nauthor Bo\nauthor-mail <bo@x.io>\nauthor-time 5\ncommitter Cy\ncommitter-time 9\nsummary s\nprevious {SHA_A} a.txt\nboundary\nfilename a.txt\n\tx\n"
        );
        let result = parse_blame_porcelain(&text);
        assert_eq!(result.lines.len(), 1);
        let commit = &result.commits[SHA_B];
        assert_eq!(commit.author_name, "Bo");
        assert_eq!(commit.author_time, 5);
        assert!(!result.commits.contains_key(SHA_A), "previous names no commit");
    }

    #[test]
    fn uncommitted_lines_get_the_not_committed_label() {
        let text = format!(
            "{ZERO} 1 1 1\nauthor Not Committed Yet\nauthor-mail <not.committed.yet>\nauthor-time 1\nsummary Version of a.txt from a.txt\nfilename a.txt\n\tdraft\n"
        );
        let result = parse_blame_porcelain(&text);
        assert_eq!(result.commits[ZERO].summary, NOT_COMMITTED_SUMMARY);
        assert!(is_uncommitted(&result.lines[0].sha));
    }

    #[test]
    fn content_keeps_tabs_and_parentheses_after_the_first_tab() {
        let text = format!(
            "{SHA_A} 1 1 1\nauthor Ann\nsummary s\nfilename a (copy).txt\n\tlet s = \"a\tb\" (x);\n"
        );
        let result = parse_blame_porcelain(&text);
        assert_eq!(result.lines[0].content, "let s = \"a\tb\" (x);");
    }

    #[test]
    fn sha256_object_names_are_accepted() {
        let sha256 = "c".repeat(64);
        let text = format!("{sha256} 1 1 1\nauthor Cy\nsummary s\n\tcode\n");
        let result = parse_blame_porcelain(&text);
        assert_eq!(result.lines[0].sha, sha256);
        assert!(result.commits.contains_key(&sha256));
    }

    #[test]
    fn metadata_before_any_header_and_empty_input_give_no_lines() {
        assert!(parse_blame_porcelain("").lines.is_empty());
        let result = parse_blame_porcelain("author Ann\n\tstray\n");
        assert!(result.lines.is_empty());
        assert!(result.commits.is_empty());
    }

    #[test]
    fn short_or_non_hex_first_token_is_not_a_header() {
        assert!(parse_header("abc123 1 1").is_none());
        assert!(parse_header(&format!("{}x 1 1", "a".repeat(39))).is_none());
        assert!(parse_header(&format!("{SHA_A} x 1")).is_none());
    }

    #[test]
    fn blame_args_without_a_rev_name_only_the_file() {
        let args = blame_args("src/a.rs", None).unwrap();
        assert_eq!(args, vec!["blame", "--porcelain", "--", "src/a.rs"]);
    }

    #[test]
    fn blame_args_put_the_rev_before_the_separator() {
        let args = blame_args("a[1].txt", Some("abc123")).unwrap();
        assert_eq!(args, vec!["blame", "--porcelain", "abc123", "--", "a[1].txt"]);
    }

    #[test]
    fn blame_args_refuse_a_rev_that_looks_like_an_option() {
        let err = blame_args("a.txt", Some("--output=x")).unwrap_err().to_string();
        assert!(err.contains("--output=x"), "unexpected message: {err}");
    }

    #[test]
    fn blame_args_never_add_literal_magic() {
        let args = blame_args("a.txt", None).unwrap();
        assert!(!args.iter().any(|a| a.starts_with(":(")));
    }
}
