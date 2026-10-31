//! Git LFS parsers and input rules. The command layer (commands/lfs.rs) runs
//! git; everything here is pure text handling, so it is tested without a
//! repository. Spec: docs/specs/git-lfs.md.

use crate::error::{AppError, AppResult};
use crate::git::GitRunner;
use serde::Serialize;
use std::path::Path;

/// The attribute that routes a path through the LFS clean/smudge filter.
/// `-filter` and `!filter` are different tokens and do not match.
const LFS_FILTER_TOKEN: &str = "filter=lfs";

/// What the frontend shows about LFS for one repo. `installed` is about the
/// machine (the git-lfs binary), `used` is about the repo (.gitattributes).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LfsInfo {
    pub installed: bool,
    pub version: Option<String>,
    pub used: bool,
    pub patterns: Vec<String>,
}

/// Patterns of the `.gitattributes` lines whose attributes include `filter=lfs`.
/// WHY read the file instead of asking git: "used" must not start a git
/// process for a repo that does not use LFS (docs/specs/git-lfs.md).
pub fn parse_lfs_patterns(content: &str) -> Vec<String> {
    content.lines().filter_map(lfs_pattern_of_line).collect()
}

fn lfs_pattern_of_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    let mut tokens = trimmed.split_whitespace();
    let pattern = tokens.next()?;
    tokens.any(|t| t == LFS_FILTER_TOKEN).then(|| pattern.to_string())
}

/// Reads `<repo>/.gitattributes` and returns its LFS patterns. A missing or
/// unreadable file means no LFS patterns: a repo without the file is not LFS.
pub async fn read_patterns(repo: &Path) -> Vec<String> {
    match tokio::fs::read_to_string(repo.join(".gitattributes")).await {
        Ok(content) => parse_lfs_patterns(&content),
        Err(_) => Vec::new(),
    }
}

/// Paths whose `filter` attribute is `lfs`, from `git check-attr -z filter`.
/// The output is (path, attribute, value) triples separated by NUL. Any value
/// other than `lfs` (`unspecified`, `unset`, another filter) is not LFS.
pub fn parse_check_attr_lfs(bytes: &[u8]) -> Vec<String> {
    let fields: Vec<&[u8]> = bytes.split(|b| *b == 0).collect();
    fields
        .chunks_exact(3)
        .filter(|triple| triple[2] == b"lfs".as_slice())
        .map(|triple| String::from_utf8_lossy(triple[0]).into_owned())
        .collect()
}

/// Stdin for `git check-attr -z --stdin`: each path followed by NUL, so a
/// newline inside a file name cannot split it.
pub fn encode_check_attr_input(paths: &[String]) -> Vec<u8> {
    paths.iter().flat_map(|p| p.as_bytes().iter().copied().chain([0])).collect()
}

/// Version from `git lfs version`, e.g. `git-lfs/3.4.1 (GitHub; windows amd64)`
/// gives `3.4.1`. Any other output means the git-lfs binary is not there.
pub fn parse_lfs_version(output: &str) -> Option<String> {
    let first = output.lines().next()?.trim();
    let rest = first.strip_prefix("git-lfs/")?;
    rest.split_whitespace().next().map(str::to_string)
}

/// Checks a pattern before it reaches `git lfs track`. A leading `-` would be
/// read by git as an option, and an empty or multi-line value is not a glob.
pub fn validate_pattern(pattern: &str) -> AppResult<&str> {
    let trimmed = pattern.trim();
    if trimmed.is_empty() {
        return Err(AppError::Lfs("LFS pattern is empty; expected a glob such as *.psd".into()));
    }
    if trimmed.starts_with('-') {
        return Err(AppError::Lfs(format!(
            "invalid LFS pattern {trimmed:?}: must not start with '-'"
        )));
    }
    if trimmed.contains(['\n', '\r', '\0']) {
        return Err(AppError::Lfs(format!("invalid LFS pattern {trimmed:?}: must be one line")));
    }
    Ok(trimmed)
}

/// Runs `git check-attr` on the given paths in one process. An empty list
/// starts no process at all.
pub async fn check_lfs_paths(
    git: &GitRunner,
    repo: &Path,
    paths: &[String],
) -> AppResult<Vec<String>> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let input = encode_check_attr_input(paths);
    let out = git
        .run_with_input(repo, ["check-attr", "-z", "--stdin", "filter"], input)
        .await?;
    Ok(parse_check_attr_lfs(&out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patterns_are_the_lines_with_the_lfs_filter() {
        let content = "*.psd filter=lfs diff=lfs merge=lfs -text\n*.md text\n";
        assert_eq!(parse_lfs_patterns(content), vec!["*.psd"]);
    }

    #[test]
    fn comments_blank_lines_and_negated_filters_are_not_patterns() {
        let content = "# filter=lfs in a comment\n\nbin/* -filter=lfs\nassets/** !filter\n";
        assert!(parse_lfs_patterns(content).is_empty());
    }

    #[test]
    fn an_empty_file_has_no_patterns() {
        assert!(parse_lfs_patterns("").is_empty());
    }

    #[tokio::test]
    async fn read_patterns_treats_a_missing_file_as_not_lfs() {
        let dir = std::env::temp_dir().join(format!("gitbee-lfs-missing-{}", std::process::id()));
        assert!(read_patterns(&dir).await.is_empty());
    }

    #[tokio::test]
    async fn read_patterns_reads_the_root_gitattributes() {
        let dir = std::env::temp_dir().join(format!("gitbee-lfs-read-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(".gitattributes"), "*.zip filter=lfs -text\n").unwrap();
        let patterns = read_patterns(&dir).await;
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(patterns, vec!["*.zip"]);
    }

    #[test]
    fn check_attr_triples_keep_only_lfs_paths() {
        let out = b"a.bin\0filter\0lfs\0b.txt\0filter\0unspecified\0c.mp4\0filter\0lfs\0";
        assert_eq!(parse_check_attr_lfs(out), vec!["a.bin", "c.mp4"]);
    }

    #[test]
    fn check_attr_output_without_triples_is_empty() {
        assert!(parse_check_attr_lfs(b"").is_empty());
    }

    #[test]
    fn check_attr_input_is_nul_terminated_per_path() {
        let paths = vec!["a b.txt".to_string(), "dir/c.bin".to_string()];
        assert_eq!(encode_check_attr_input(&paths), b"a b.txt\0dir/c.bin\0");
    }

    #[test]
    fn lfs_version_is_the_number_after_the_prefix() {
        let out = "git-lfs/3.4.1 (GitHub; windows amd64; go 1.21.1)\n";
        assert_eq!(parse_lfs_version(out).as_deref(), Some("3.4.1"));
    }

    #[test]
    fn git_error_text_is_not_a_version() {
        assert_eq!(parse_lfs_version("git: 'lfs' is not a git command."), None);
        assert_eq!(parse_lfs_version(""), None);
    }

    #[test]
    fn a_plain_glob_is_a_valid_pattern() {
        assert_eq!(validate_pattern("  *.psd ").unwrap(), "*.psd");
    }

    #[test]
    fn an_empty_pattern_is_refused_with_the_expected_shape() {
        let err = validate_pattern("   ").unwrap_err();
        assert!(err.to_string().contains("expected a glob"));
    }

    #[test]
    fn a_pattern_starting_with_a_dash_is_refused_with_its_value() {
        let err = validate_pattern("-rf").unwrap_err();
        assert!(err.to_string().contains("\"-rf\""));
    }

    #[test]
    fn a_multi_line_pattern_is_refused() {
        assert!(validate_pattern("a\nb").is_err());
    }
}
