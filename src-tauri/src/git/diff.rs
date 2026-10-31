use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct FileDiff {
    pub old_path: String,
    pub new_path: String,
    pub hunks: Vec<Hunk>,
    pub binary: bool,
    /// Lines dropped after `MAX_FILE_DIFF_LINES`; the viewer says how many.
    pub omitted_lines: u32,
}

// One huge diff (lockfile, generated code) froze the diff view, so each
// file keeps at most this many hunk lines and counts the rest. See
// docs/specs/graph-loading.md.
pub const MAX_FILE_DIFF_LINES: usize = 5000;

#[derive(Debug, Clone, Serialize)]
pub struct Hunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffLine {
    pub kind: LineKind,
    pub content: String,
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LineKind {
    Context,
    Add,
    Del,
    NoNewline,
}

/// Parse unified diff text from `git diff` output. Lenient parser: emits one
/// `FileDiff` per `diff --git` block.
pub fn parse_unified(text: &str) -> Vec<FileDiff> {
    let mut files = Vec::new();
    let mut current: Option<FileDiff> = None;
    let mut current_hunk: Option<Hunk> = None;
    let mut old_no = 0u32;
    let mut new_no = 0u32;
    // Hunk lines kept for the current file; reset per file so the cap is per file.
    let mut kept_lines = 0usize;

    for line in text.split_inclusive('\n') {
        let bare = line.trim_end_matches('\n').trim_end_matches('\r');

        if let Some(rest) = bare.strip_prefix("diff --git ") {
            push_hunk(&mut current, &mut current_hunk);
            push_file(&mut files, &mut current);
            let (old, new) = parse_diff_paths(rest);
            current = Some(FileDiff {
                old_path: old,
                new_path: new,
                hunks: Vec::new(),
                binary: false,
                omitted_lines: 0,
            });
            kept_lines = 0;
            continue;
        }
        if bare.starts_with("Binary files ") {
            if let Some(f) = current.as_mut() { f.binary = true; }
            continue;
        }
        // The authoritative paths come from the `---`/`+++` header lines, not
        // from `diff --git a/x b/x`: that line is unparseable when a path
        // contains a space (e.g. `diff --git a/c d.txt b/c d.txt`). Override
        // whatever parse_diff_paths guessed once we see the real headers.
        // `rename from`/`rename to` cover pure renames, which emit no `---`.
        // (audit 2026-05)
        if let Some(rest) = bare.strip_prefix("--- ") {
            if let Some(f) = current.as_mut() { f.old_path = strip_diff_path(rest); }
            continue;
        }
        if let Some(rest) = bare.strip_prefix("+++ ") {
            if let Some(f) = current.as_mut() { f.new_path = strip_diff_path(rest); }
            continue;
        }
        if let Some(rest) = bare.strip_prefix("rename from ") {
            if let Some(f) = current.as_mut() { f.old_path = rest.trim().to_string(); }
            continue;
        }
        if let Some(rest) = bare.strip_prefix("rename to ") {
            if let Some(f) = current.as_mut() { f.new_path = rest.trim().to_string(); }
            continue;
        }
        if let Some(rest) = bare.strip_prefix("@@ ") {
            push_hunk(&mut current, &mut current_hunk);
            // Past the cap a new hunk would only add headers with no lines.
            if kept_lines >= MAX_FILE_DIFF_LINES {
                continue;
            }
            if let Some(h) = parse_hunk_header(rest, bare) {
                old_no = h.old_start;
                new_no = h.new_start;
                current_hunk = Some(h);
            }
            continue;
        }
        if kept_lines >= MAX_FILE_DIFF_LINES {
            if let (true, Some(f)) = (is_body_line(bare), current.as_mut()) {
                f.omitted_lines += 1;
            }
            continue;
        }
        if current_hunk.is_none() { continue; }
        let h = current_hunk.as_mut().unwrap();
        let first = bare.as_bytes().first().copied();
        let (kind, content) = match first {
            Some(b'+') => (LineKind::Add, &bare[1..]),
            Some(b'-') => (LineKind::Del, &bare[1..]),
            Some(b' ') => (LineKind::Context, &bare[1..]),
            Some(b'\\') => (LineKind::NoNewline, &bare[1..]),
            _ => continue,
        };
        let (o, n) = match kind {
            LineKind::Add => { let n = Some(new_no); new_no += 1; (None, n) }
            LineKind::Del => { let o = Some(old_no); old_no += 1; (o, None) }
            LineKind::Context => {
                let o = Some(old_no); let n = Some(new_no);
                old_no += 1; new_no += 1; (o, n)
            }
            LineKind::NoNewline => (None, None),
        };
        h.lines.push(DiffLine { kind, content: content.to_string(), old_no: o, new_no: n });
        kept_lines += 1;
    }
    push_hunk(&mut current, &mut current_hunk);
    push_file(&mut files, &mut current);
    files
}

/// True for a hunk body line (added, removed or context). `\ No newline`
/// markers are not counted as omitted, so the count matches real lines.
fn is_body_line(bare: &str) -> bool {
    matches!(bare.as_bytes().first(), Some(b'+' | b'-' | b' '))
}

fn push_hunk(file: &mut Option<FileDiff>, hunk: &mut Option<Hunk>) {
    if let (Some(f), Some(h)) = (file.as_mut(), hunk.take()) {
        f.hunks.push(h);
    }
}

fn push_file(out: &mut Vec<FileDiff>, file: &mut Option<FileDiff>) {
    if let Some(f) = file.take() { out.push(f); }
}

// Best-effort guess from the `diff --git` line. Correct only when paths have
// no spaces; the `---`/`+++` (and `rename from/to`) handlers in parse_unified
// override this with the authoritative paths whenever those lines are present.
// Kept as the fallback for headers that emit neither (e.g. binary, mode-only).
fn parse_diff_paths(rest: &str) -> (String, String) {
    let parts: Vec<&str> = rest.splitn(2, ' ').collect();
    match parts.as_slice() {
        [a, b] => (strip_diff_path(a), strip_diff_path(b)),
        _ => (rest.to_string(), rest.to_string()),
    }
}

// Strip the `a/`/`b/` prefix from a unified-diff path. `/dev/null` (add or
// delete side) maps to an empty string so the frontend's `new_path||old_path`
// resolves to the real side.
fn strip_diff_path(s: &str) -> String {
    let s = s.trim();
    if s == "/dev/null" { return String::new(); }
    s.strip_prefix("a/").or_else(|| s.strip_prefix("b/")).unwrap_or(s).to_string()
}

fn parse_hunk_header(rest: &str, full: &str) -> Option<Hunk> {
    let end = rest.find("@@")?;
    let nums = &rest[..end].trim();
    let parts: Vec<&str> = nums.split_whitespace().collect();
    if parts.len() < 2 { return None; }
    let (os, ol) = parse_range(parts[0].trim_start_matches('-'))?;
    let (ns, nl) = parse_range(parts[1].trim_start_matches('+'))?;
    Some(Hunk {
        header: full.to_string(),
        old_start: os, old_lines: ol,
        new_start: ns, new_lines: nl,
        lines: Vec::new(),
    })
}

fn parse_range(s: &str) -> Option<(u32, u32)> {
    let mut parts = s.splitn(2, ',');
    let start: u32 = parts.next()?.parse().ok()?;
    let lines: u32 = parts.next().map(|x| x.parse().ok()).unwrap_or(Some(1))?;
    Some((start, lines))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_diff() {
        let input = concat!(
            "diff --git a/foo.txt b/foo.txt\n",
            "--- a/foo.txt\n",
            "+++ b/foo.txt\n",
            "@@ -1,2 +1,3 @@\n",
            " line1\n",
            "-old\n",
            "+new1\n",
            "+new2\n",
        );
        let files = parse_unified(input);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].new_path, "foo.txt");
        assert_eq!(files[0].hunks.len(), 1);
        let lines = &files[0].hunks[0].lines;
        assert_eq!(lines.len(), 4);
        assert_eq!(lines[1].kind, LineKind::Del);
        assert_eq!(lines[2].kind, LineKind::Add);
    }

    // Regression: paths containing spaces are unparseable from the
    // `diff --git` line; the `---`/`+++` headers carry the real paths. (audit 2026-05)
    #[test]
    fn parses_path_with_spaces() {
        let input = concat!(
            "diff --git a/my dir/c d.txt b/my dir/c d.txt\n",
            "--- a/my dir/c d.txt\n",
            "+++ b/my dir/c d.txt\n",
            "@@ -1 +1 @@\n",
            "-old\n",
            "+new\n",
        );
        let files = parse_unified(input);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].old_path, "my dir/c d.txt");
        assert_eq!(files[0].new_path, "my dir/c d.txt");
    }

    // Regression: added file shows /dev/null on the old side → empty old_path.
    // Builds a one-hunk diff whose hunk adds `count` lines to `path`.
    fn added_lines_diff(path: &str, count: usize) -> String {
        let mut text = format!(
            "diff --git a/{path} b/{path}\n--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{count} @@\n"
        );
        text.push_str(&"+x\n".repeat(count));
        text
    }

    fn total_kept_lines(files: &[FileDiff]) -> usize {
        files
            .iter()
            .flat_map(|f| &f.hunks)
            .map(|h| h.lines.len())
            .sum()
    }

    #[test]
    fn caps_hunk_lines_per_file_and_counts_the_rest() {
        let files = parse_unified(&added_lines_diff("big.txt", MAX_FILE_DIFF_LINES + 3));
        assert_eq!(total_kept_lines(&files), MAX_FILE_DIFF_LINES);
        assert_eq!(files[0].omitted_lines, 3);
    }

    // Regression: the cap is per file, so a huge first file must not
    // starve the lines of the next file.
    #[test]
    fn cap_resets_for_each_file() {
        let text = format!(
            "{}{}",
            added_lines_diff("big.txt", MAX_FILE_DIFF_LINES + 3),
            added_lines_diff("small.txt", 2)
        );
        let files = parse_unified(&text);
        assert_eq!(files.len(), 2);
        assert_eq!(files[1].hunks[0].lines.len(), 2);
        assert_eq!(files[1].omitted_lines, 0);
    }

    #[test]
    fn body_lines_are_prefixed_with_add_del_or_context() {
        assert!(is_body_line("+a"));
        assert!(is_body_line("-a"));
        assert!(is_body_line(" a"));
        assert!(!is_body_line("\\ No newline at end of file"));
        assert!(!is_body_line("@@ -1 +1 @@"));
    }

    #[test]
    fn added_file_has_empty_old_path() {
        let input = concat!(
            "diff --git a/new.txt b/new.txt\n",
            "--- /dev/null\n",
            "+++ b/new.txt\n",
            "@@ -0,0 +1 @@\n",
            "+hello\n",
        );
        let files = parse_unified(input);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].old_path, "");
        assert_eq!(files[0].new_path, "new.txt");
    }
}
