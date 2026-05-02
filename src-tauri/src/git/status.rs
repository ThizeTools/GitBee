use crate::error::{AppError, AppResult};
use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Ignored,
    Conflicted,
    Unmodified,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatusEntry {
    pub path: String,
    pub orig_path: Option<String>,
    pub index: FileStatus,
    pub worktree: FileStatus,
    pub conflicted: bool,
}

/// Parse output of `git status --porcelain=v2 -z`.
/// Records are NUL-terminated. Renames/copies have an extra NUL-prefixed orig path.
pub fn parse_status_v2(bytes: &[u8]) -> AppResult<Vec<StatusEntry>> {
    let mut entries = Vec::new();
    let mut iter = SplitNul::new(bytes);
    while let Some(record) = iter.next_record() {
        if record.is_empty() {
            continue;
        }
        let kind = record[0];
        match kind {
            b'1' => entries.push(parse_changed_entry(record, false, &mut iter)?),
            b'2' => entries.push(parse_changed_entry(record, true, &mut iter)?),
            b'u' => entries.push(parse_unmerged(record)?),
            b'?' => entries.push(StatusEntry {
                path: record_path(record, 2)?,
                orig_path: None,
                index: FileStatus::Untracked,
                worktree: FileStatus::Untracked,
                conflicted: false,
            }),
            b'!' => entries.push(StatusEntry {
                path: record_path(record, 2)?,
                orig_path: None,
                index: FileStatus::Ignored,
                worktree: FileStatus::Ignored,
                conflicted: false,
            }),
            _ => continue,
        }
    }
    Ok(entries)
}

struct SplitNul<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> SplitNul<'a> {
    fn new(buf: &'a [u8]) -> Self { Self { buf, pos: 0 } }
    fn next_record(&mut self) -> Option<&'a [u8]> {
        if self.pos >= self.buf.len() { return None; }
        let rest = &self.buf[self.pos..];
        let end = rest.iter().position(|b| *b == 0).unwrap_or(rest.len());
        let record = &rest[..end];
        self.pos += end + 1;
        Some(record)
    }
}

fn parse_changed_entry(
    record: &[u8],
    rename: bool,
    iter: &mut SplitNul,
) -> AppResult<StatusEntry> {
    let s = std::str::from_utf8(record)
        .map_err(|e| AppError::Parse(format!("non-utf8 status: {e}")))?;
    let parts: Vec<&str> = s.splitn(if rename { 10 } else { 9 }, ' ').collect();
    let xy = parts.get(1).ok_or_else(|| AppError::Parse("missing XY".into()))?;
    let path_field_idx = if rename { 9 } else { 8 };
    let path_field = parts
        .get(path_field_idx)
        .ok_or_else(|| AppError::Parse("missing path".into()))?;
    let (path, orig_path) = if rename {
        let orig = iter
            .next_record()
            .ok_or_else(|| AppError::Parse("missing rename orig".into()))?;
        let orig_str = std::str::from_utf8(orig)
            .map_err(|e| AppError::Parse(format!("non-utf8 rename: {e}")))?;
        (path_field.to_string(), Some(orig_str.to_string()))
    } else {
        (path_field.to_string(), None)
    };
    let bytes = xy.as_bytes();
    Ok(StatusEntry {
        path,
        orig_path,
        index: status_char(*bytes.first().unwrap_or(&b'.')),
        worktree: status_char(*bytes.get(1).unwrap_or(&b'.')),
        conflicted: false,
    })
}

fn parse_unmerged(record: &[u8]) -> AppResult<StatusEntry> {
    let s = std::str::from_utf8(record)
        .map_err(|e| AppError::Parse(format!("non-utf8 unmerged: {e}")))?;
    let parts: Vec<&str> = s.splitn(11, ' ').collect();
    let path = parts
        .get(10)
        .ok_or_else(|| AppError::Parse("missing unmerged path".into()))?
        .to_string();
    Ok(StatusEntry {
        path,
        orig_path: None,
        index: FileStatus::Conflicted,
        worktree: FileStatus::Conflicted,
        conflicted: true,
    })
}

fn record_path(record: &[u8], skip: usize) -> AppResult<String> {
    let rest = std::str::from_utf8(&record[skip..])
        .map_err(|e| AppError::Parse(format!("non-utf8 path: {e}")))?;
    Ok(rest.to_string())
}

fn status_char(b: u8) -> FileStatus {
    match b {
        b'M' => FileStatus::Modified,
        b'A' => FileStatus::Added,
        b'D' => FileStatus::Deleted,
        b'R' => FileStatus::Renamed,
        b'C' => FileStatus::Copied,
        b'.' | b' ' => FileStatus::Unmodified,
        _ => FileStatus::Modified,
    }
}
