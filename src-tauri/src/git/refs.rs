use crate::error::{AppError, AppResult};
use crate::git::types::{CommitRef, RefKind};

/// Format string used with `git for-each-ref --format=...`.
/// Fields: refname \0 objectname \0 (peeled objectname for tags)
pub const REF_FORMAT: &str = "%(refname)%00%(objectname)%00%(*objectname)";

/// Parse output from `git for-each-ref --format=<REF_FORMAT>`.
/// Records separated by newlines; fields inside each record by NUL.
/// (`for-each-ref` does not support `-z`.)
pub fn parse_refs(bytes: &[u8]) -> AppResult<Vec<CommitRef>> {
    bytes
        .split(|b| *b == b'\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            let fields: Vec<&[u8]> = line.split(|b| *b == 0).collect();
            if fields.len() != 3 {
                return Err(AppError::Parse(format!(
                    "for-each-ref record has {} fields, expected 3",
                    fields.len()
                )));
            }
            parse_one(&fields)
        })
        .collect()
}

fn parse_one(chunk: &[&[u8]]) -> AppResult<CommitRef> {
    let s = |idx: usize| -> AppResult<&str> {
        std::str::from_utf8(chunk[idx])
            .map_err(|e| AppError::Parse(format!("non-utf8 ref field {idx}: {e}")))
    };
    let refname = s(0)?;
    let object = s(1)?;
    let peeled = s(2)?;
    let target = if peeled.is_empty() { object } else { peeled };
    let (kind, name) = classify(refname);
    Ok(CommitRef {
        name: name.to_string(),
        kind,
        target_sha: target.to_string(),
    })
}

fn classify(refname: &str) -> (RefKind, &str) {
    if let Some(rest) = refname.strip_prefix("refs/heads/") {
        return (RefKind::LocalBranch, rest);
    }
    if let Some(rest) = refname.strip_prefix("refs/remotes/") {
        return (RefKind::RemoteBranch, rest);
    }
    if let Some(rest) = refname.strip_prefix("refs/tags/") {
        return (RefKind::Tag, rest);
    }
    if let Some(rest) = refname.strip_prefix("refs/stash") {
        return (RefKind::Stash, if rest.is_empty() { "stash" } else { rest });
    }
    (RefKind::Head, refname)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(records: &[(&str, &str, &str)]) -> Vec<u8> {
        let mut out = Vec::new();
        for (a, b, c) in records {
            out.extend_from_slice(a.as_bytes());
            out.push(0);
            out.extend_from_slice(b.as_bytes());
            out.push(0);
            out.extend_from_slice(c.as_bytes());
            out.push(b'\n');
        }
        out
    }

    #[test]
    fn parses_branch_and_tag() {
        let buf = build(&[
            ("refs/heads/main", "abc123", ""),
            ("refs/tags/v1.0", "tagobj", "commit123"),
            ("refs/remotes/origin/main", "remote1", ""),
        ]);
        let refs = parse_refs(&buf).unwrap();
        assert_eq!(refs.len(), 3);
        assert_eq!(refs[0].kind, RefKind::LocalBranch);
        assert_eq!(refs[0].name, "main");
        assert_eq!(refs[1].kind, RefKind::Tag);
        assert_eq!(refs[1].target_sha, "commit123");
        assert_eq!(refs[2].kind, RefKind::RemoteBranch);
        assert_eq!(refs[2].name, "origin/main");
    }
}
