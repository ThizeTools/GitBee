use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct FileDiff {
    pub old_path: String,
    pub new_path: String,
    pub hunks: Vec<Hunk>,
    pub binary: bool,
}

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
            });
            continue;
        }
        if bare.starts_with("Binary files ") {
            if let Some(f) = current.as_mut() { f.binary = true; }
            continue;
        }
        if let Some(rest) = bare.strip_prefix("@@ ") {
            push_hunk(&mut current, &mut current_hunk);
            if let Some(h) = parse_hunk_header(rest, bare) {
                old_no = h.old_start;
                new_no = h.new_start;
                current_hunk = Some(h);
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
    }
    push_hunk(&mut current, &mut current_hunk);
    push_file(&mut files, &mut current);
    files
}

fn push_hunk(file: &mut Option<FileDiff>, hunk: &mut Option<Hunk>) {
    if let (Some(f), Some(h)) = (file.as_mut(), hunk.take()) {
        f.hunks.push(h);
    }
}

fn push_file(out: &mut Vec<FileDiff>, file: &mut Option<FileDiff>) {
    if let Some(f) = file.take() { out.push(f); }
}

fn parse_diff_paths(rest: &str) -> (String, String) {
    let parts: Vec<&str> = rest.splitn(2, ' ').collect();
    let strip = |s: &str| -> String {
        s.strip_prefix("a/").or_else(|| s.strip_prefix("b/")).unwrap_or(s).to_string()
    };
    match parts.as_slice() {
        [a, b] => (strip(a), strip(b)),
        _ => (rest.to_string(), rest.to_string()),
    }
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
}
