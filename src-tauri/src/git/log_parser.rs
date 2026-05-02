use crate::error::{AppError, AppResult};
use crate::git::types::Commit;

pub const LOG_FORMAT: &str = "%H%x00%P%x00%an%x00%ae%x00%at%x00%s";
const FIELDS_PER_COMMIT: usize = 6;

/// Parse output of `git log -z --format=<LOG_FORMAT>`.
///
/// With `-z`, git separates records with NUL. Combined with `%x00` between
/// fields inside the format, the entire stream is one big NUL-split sequence
/// that we re-chunk into 6-field commits.
pub fn parse_log_z(bytes: &[u8]) -> AppResult<Vec<Commit>> {
    let mut fields: Vec<&[u8]> = bytes.split(|b| *b == 0).collect();
    if fields.last().map(|f| f.is_empty()).unwrap_or(false) {
        fields.pop();
    }
    if fields.len() % FIELDS_PER_COMMIT != 0 {
        return Err(AppError::Parse(format!(
            "git log produced {} fields, expected multiple of {FIELDS_PER_COMMIT}",
            fields.len()
        )));
    }
    fields.chunks(FIELDS_PER_COMMIT).map(parse_one).collect()
}

fn parse_one(chunk: &[&[u8]]) -> AppResult<Commit> {
    let s = |idx: usize| -> AppResult<String> {
        std::str::from_utf8(chunk[idx])
            .map(str::to_owned)
            .map_err(|e| AppError::Parse(format!("non-utf8 field {idx}: {e}")))
    };
    let parents_raw = s(1)?;
    let parents = if parents_raw.is_empty() {
        Vec::new()
    } else {
        parents_raw.split(' ').map(str::to_owned).collect()
    };
    let timestamp: i64 = s(4)?
        .parse()
        .map_err(|e| AppError::Parse(format!("invalid timestamp: {e}")))?;
    Ok(Commit {
        sha: s(0)?,
        parents,
        author_name: s(2)?,
        author_email: s(3)?,
        timestamp,
        subject: s(5)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_commit() {
        let mut buf = Vec::new();
        buf.extend_from_slice(b"abc123");
        buf.push(0);
        buf.extend_from_slice(b"def456");
        buf.push(0);
        buf.extend_from_slice(b"Alice");
        buf.push(0);
        buf.extend_from_slice(b"alice@example.com");
        buf.push(0);
        buf.extend_from_slice(b"1700000000");
        buf.push(0);
        buf.extend_from_slice(b"initial commit");
        buf.push(0);

        let commits = parse_log_z(&buf).unwrap();
        assert_eq!(commits.len(), 1);
        let c = &commits[0];
        assert_eq!(c.sha, "abc123");
        assert_eq!(c.parents, vec!["def456".to_string()]);
        assert_eq!(c.author_name, "Alice");
        assert_eq!(c.timestamp, 1_700_000_000);
        assert_eq!(c.subject, "initial commit");
    }

    #[test]
    fn parses_root_commit_no_parents() {
        let mut buf = Vec::new();
        buf.extend_from_slice(b"root1");
        buf.push(0);
        buf.push(0); // empty parents
        buf.extend_from_slice(b"Bob");
        buf.push(0);
        buf.extend_from_slice(b"bob@x");
        buf.push(0);
        buf.extend_from_slice(b"1");
        buf.push(0);
        buf.extend_from_slice(b"root");
        buf.push(0);

        let commits = parse_log_z(&buf).unwrap();
        assert_eq!(commits[0].parents.len(), 0);
    }

    #[test]
    fn parses_merge_commit_two_parents() {
        let mut buf = Vec::new();
        buf.extend_from_slice(b"merge1");
        buf.push(0);
        buf.extend_from_slice(b"a1 b2");
        buf.push(0);
        buf.extend_from_slice(b"C");
        buf.push(0);
        buf.extend_from_slice(b"c@x");
        buf.push(0);
        buf.extend_from_slice(b"2");
        buf.push(0);
        buf.extend_from_slice(b"merge");
        buf.push(0);

        let commits = parse_log_z(&buf).unwrap();
        assert_eq!(commits[0].parents, vec!["a1".to_string(), "b2".to_string()]);
    }
}
