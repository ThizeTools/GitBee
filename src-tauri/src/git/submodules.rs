//! Parsers for submodule state. The command layer (commands/submodules.rs)
//! runs git and passes its text here; nothing in this file starts a process,
//! so every rule is tested on plain strings. See docs/specs/submodules.md.

use serde::Serialize;

/// Sync state of one submodule as the sidebar shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SubmoduleState {
    Uninitialized,
    Clean,
    Modified,
    OutOfSync,
    Conflict,
}

/// One submodule as the sidebar receives it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Submodule {
    pub name: String,
    pub path: String,
    pub url: String,
    pub branch: Option<String>,
    pub sha: Option<String>,
    pub state: SubmoduleState,
}

/// One submodule declared in `.gitmodules`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigEntry {
    pub name: String,
    pub path: String,
    pub url: String,
    pub branch: Option<String>,
}

/// One line of `git submodule status`: prefix char, checked-out sha, path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusLine {
    pub prefix: char,
    pub sha: String,
    pub path: String,
}

/// Parses `git config -f .gitmodules -z --get-regexp '^submodule\.'`. Records
/// are `key\nvalue\0`. The name may contain dots (`submodule.a.b.path`), so
/// the variable is the segment after the LAST dot.
pub fn parse_gitmodules(text: &str) -> Vec<ConfigEntry> {
    let mut out: Vec<ConfigEntry> = Vec::new();
    for record in text.split('\0').filter(|r| !r.is_empty()) {
        let (key, value) = record.split_once('\n').unwrap_or((record, ""));
        let Some((name, var)) = split_key(key) else { continue };
        let entry = entry_for(&mut out, name);
        match var {
            "path" => entry.path = value.to_string(),
            "url" => entry.url = value.to_string(),
            "branch" => entry.branch = Some(value.to_string()),
            _ => {}
        }
    }
    // A section without `path` cannot be matched to a checkout, so it is dropped.
    out.retain(|e| !e.path.is_empty());
    out
}

/// Splits `submodule.<name>.<var>` into `(name, var)`.
fn split_key(key: &str) -> Option<(&str, &str)> {
    let rest = key.strip_prefix("submodule.")?;
    let (name, var) = rest.rsplit_once('.')?;
    (!name.is_empty()).then_some((name, var))
}

/// Returns the entry for `name`, creating it at the end of the list on first use
/// so the output keeps the order of `.gitmodules`.
fn entry_for<'a>(out: &'a mut Vec<ConfigEntry>, name: &str) -> &'a mut ConfigEntry {
    let idx = match out.iter().position(|e| e.name == name) {
        Some(i) => i,
        None => {
            out.push(ConfigEntry {
                name: name.to_string(),
                path: String::new(),
                url: String::new(),
                branch: None,
            });
            out.len() - 1
        }
    };
    &mut out[idx]
}

/// Parses `git submodule status --recursive`. Each line is
/// `<prefix><sha> <path>[ (<describe>)]`, where the prefix is ' ' (clean), '-'
/// (not initialized), '+' (checked out at another commit) or 'U' (conflict).
pub fn parse_status_lines(text: &str) -> Vec<StatusLine> {
    text.lines().filter_map(parse_status_line).collect()
}

fn parse_status_line(line: &str) -> Option<StatusLine> {
    let mut chars = line.chars();
    let prefix = chars.next()?;
    if !matches!(prefix, ' ' | '-' | '+' | 'U') {
        return None;
    }
    let (sha, after) = chars.as_str().split_once(' ')?;
    if sha.is_empty() {
        return None;
    }
    Some(StatusLine {
        prefix,
        sha: sha.to_string(),
        path: strip_describe(after).to_string(),
    })
}

/// Drops the trailing ` (describe)` that git appends when `git describe`
/// finds a tag. The last ` (` is used, so a path with an earlier ` (` survives.
/// A path that itself ends in `)` after ` (` is misread; git gives no way to
/// tell the two apart.
fn strip_describe(s: &str) -> &str {
    match s.rfind(" (") {
        Some(i) if s.ends_with(')') => &s[..i],
        _ => s,
    }
}

/// Parses `git status --porcelain=v2 -z` and returns the paths whose submodule
/// has changes inside it (modified tracked content or untracked files). The
/// `S<c><m><u>` field's `m` and `u` characters carry that; `c` (new commit)
/// alone is covered by the `+` prefix in `git submodule status`.
pub fn parse_dirty_paths(bytes: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let mut records = bytes.split(|b| *b == 0).filter(|r| !r.is_empty());
    while let Some(rec) = records.next() {
        let Ok(line) = std::str::from_utf8(rec) else { continue };
        match line.as_bytes().first() {
            Some(b'1') => out.extend(dirty_entry(line, 9)),
            // A rename record is followed by its original path as its own NUL record.
            Some(b'2') => {
                records.next();
                out.extend(dirty_entry(line, 10));
            }
            _ => {}
        }
    }
    out
}

/// Returns the entry's path when its sub field marks dirty content. `fields`
/// is the split count that leaves the path in the last slot.
fn dirty_entry(line: &str, fields: usize) -> Option<String> {
    let parts: Vec<&str> = line.splitn(fields, ' ').collect();
    let sub = parts.get(2)?;
    let path = parts.get(fields - 1)?;
    is_dirty_sub(sub).then(|| path.to_string())
}

/// True for an `S<c><m><u>` sub field whose `m` (tracked changes) or `u`
/// (untracked files) flag is set. A plain submodule has `N...` and never matches.
fn is_dirty_sub(sub: &str) -> bool {
    let b = sub.as_bytes();
    b.len() == 4 && b[0] == b'S' && (b[2] == b'M' || b[3] == b'U')
}

/// Picks the state. Conflict and not-initialized come first because they stop
/// any other action; dirty content comes before out-of-sync because local work
/// in a checkout is what the user must not lose.
pub fn classify(prefix: Option<char>, dirty: bool) -> SubmoduleState {
    match prefix {
        Some('U') => SubmoduleState::Conflict,
        None | Some('-') => SubmoduleState::Uninitialized,
        _ if dirty => SubmoduleState::Modified,
        Some('+') => SubmoduleState::OutOfSync,
        _ => SubmoduleState::Clean,
    }
}

/// Joins the `.gitmodules` declarations with the status lines and dirty paths.
/// A declared submodule with no status line (not in the index) reads as uninitialized.
pub fn build_submodules(
    configs: Vec<ConfigEntry>,
    statuses: &[StatusLine],
    dirty: &[String],
) -> Vec<Submodule> {
    configs
        .into_iter()
        .map(|c| build_one(c, statuses, dirty))
        .collect()
}

fn build_one(c: ConfigEntry, statuses: &[StatusLine], dirty: &[String]) -> Submodule {
    let line = statuses.iter().find(|s| s.path == c.path);
    let is_dirty = dirty.iter().any(|d| *d == c.path);
    let state = classify(line.map(|l| l.prefix), is_dirty);
    Submodule {
        name: c.name,
        path: c.path,
        url: c.url,
        branch: c.branch,
        sha: line.map(|l| l.sha.clone()),
        state,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHA_A: &str = "1111111111111111111111111111111111111111";
    const SHA_B: &str = "2222222222222222222222222222222222222222";

    #[test]
    fn gitmodules_reads_path_url_and_branch_per_name() {
        let text = "submodule.libfoo.path\nlibs/foo\0submodule.libfoo.url\nhttps://x/foo.git\0\
                    submodule.libfoo.branch\nmain\0";
        let got = parse_gitmodules(text);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "libfoo");
        assert_eq!(got[0].path, "libs/foo");
        assert_eq!(got[0].url, "https://x/foo.git");
        assert_eq!(got[0].branch.as_deref(), Some("main"));
    }

    #[test]
    fn gitmodules_keeps_dotted_names_and_declaration_order() {
        let text = "submodule.a.b.path\na\0submodule.z.path\nz\0submodule.a.b.url\nu\0";
        let got = parse_gitmodules(text);
        let names: Vec<&str> = got.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["a.b", "z"]);
        assert_eq!(got[0].url, "u");
    }

    #[test]
    fn gitmodules_drops_sections_without_path_and_empty_input() {
        assert!(parse_gitmodules("").is_empty());
        let got = parse_gitmodules("submodule.nopath.url\nhttps://x\0");
        assert!(got.is_empty());
    }

    #[test]
    fn gitmodules_ignores_keys_outside_the_submodule_prefix() {
        let got = parse_gitmodules("core.bare\nfalse\0submodule.s.path\ns\0");
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "s");
    }

    #[test]
    fn status_lines_map_each_prefix_char() {
        let text = format!(" {SHA_A} clean\n-{SHA_B} off\n+{SHA_A} moved (v1.0)\nU{SHA_B} broken\n");
        let got = parse_status_lines(&text);
        let prefixes: Vec<char> = got.iter().map(|l| l.prefix).collect();
        assert_eq!(prefixes, [' ', '-', '+', 'U']);
        assert_eq!(got[0].sha, SHA_A);
        assert_eq!(got[2].path, "moved");
    }

    #[test]
    fn status_line_keeps_spaces_inside_the_path() {
        let text = format!(" {SHA_A} my libs/foo\n");
        let got = parse_status_lines(&text);
        assert_eq!(got[0].path, "my libs/foo");
    }

    #[test]
    fn status_line_skips_malformed_lines() {
        assert!(parse_status_lines("garbage\n\n?abc x\n").is_empty());
        assert!(parse_status_lines(" nospace\n").is_empty());
    }

    #[test]
    fn dirty_paths_flags_only_submodules_with_inner_changes() {
        // Parent-tracked file (type 1, sub N...) must not count.
        let text = "1 .M N... 100644 100644 100644 aa bb src/main.rs\0\
                    1 .M S.M. 160000 160000 160000 aa bb libs/foo\0\
                    1 .M SC.. 160000 160000 160000 aa bb libs/bar\0\
                    1 .M S..U 160000 160000 160000 aa bb libs/baz\0";
        let got = parse_dirty_paths(text.as_bytes());
        assert_eq!(got, ["libs/foo", "libs/baz"]);
    }

    #[test]
    fn dirty_paths_reads_rename_records_and_skips_their_orig_path() {
        let text = "2 R. S.M. 160000 160000 160000 aa bb R100 libs/new\0libs/old\0\
                    1 .M S.M. 160000 160000 160000 aa bb libs/foo\0";
        let got = parse_dirty_paths(text.as_bytes());
        assert_eq!(got, ["libs/new", "libs/foo"]);
    }

    #[test]
    fn dirty_paths_empty_output_is_empty() {
        assert!(parse_dirty_paths(b"").is_empty());
    }

    #[test]
    fn classify_conflict_and_uninitialized_win_over_dirty() {
        assert_eq!(classify(Some('U'), true), SubmoduleState::Conflict);
        assert_eq!(classify(Some('-'), true), SubmoduleState::Uninitialized);
        assert_eq!(classify(None, false), SubmoduleState::Uninitialized);
    }

    #[test]
    fn classify_dirty_wins_over_out_of_sync_and_clean_is_default() {
        assert_eq!(classify(Some('+'), true), SubmoduleState::Modified);
        assert_eq!(classify(Some('+'), false), SubmoduleState::OutOfSync);
        assert_eq!(classify(Some(' '), true), SubmoduleState::Modified);
        assert_eq!(classify(Some(' '), false), SubmoduleState::Clean);
    }

    #[test]
    fn build_joins_config_status_and_dirty_by_path() {
        let configs = vec![
            ConfigEntry { name: "foo".into(), path: "libs/foo".into(), url: "u1".into(), branch: None },
            ConfigEntry { name: "bar".into(), path: "libs/bar".into(), url: "u2".into(), branch: None },
        ];
        let statuses = vec![StatusLine { prefix: ' ', sha: SHA_A.into(), path: "libs/foo".into() }];
        let dirty = vec!["libs/foo".to_string()];
        let got = build_submodules(configs, &statuses, &dirty);
        assert_eq!(got[0].state, SubmoduleState::Modified);
        assert_eq!(got[0].sha.as_deref(), Some(SHA_A));
        assert_eq!(got[1].state, SubmoduleState::Uninitialized);
        assert_eq!(got[1].sha, None);
    }
}
