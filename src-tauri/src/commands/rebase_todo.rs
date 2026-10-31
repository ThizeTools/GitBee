//! Pure rules for an interactive rebase: which lists git can replay, and the
//! todo text `git rebase -i` runs. No git calls here, so every rule is unit
//! tested. Spec: docs/specs/interactive-rebase.md.

use crate::error::{AppError, AppResult};
use serde::Deserialize;
use std::collections::HashSet;
use std::path::Path;

/// What the editor asks for one commit. Lowercase on the wire, as the UI sends it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RebaseAction {
    Pick,
    Reword,
    Squash,
    Fixup,
    Drop,
}

/// One commit of the list. `message` is the text the commit must end with.
/// Only pick and reword rows read it; see `amend_after_rows`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct RebaseItem {
    pub action: RebaseAction,
    pub sha: String,
    pub message: Option<String>,
}

/// Pure: whether a list can be replayed. `items` are oldest first.
/// WHY the oldest kept commit cannot be squash or fixup: nothing older is
/// left in the rebase for it to fold into.
pub fn validate_items(items: &[RebaseItem]) -> AppResult<()> {
    if items.is_empty() {
        return Err(AppError::Other(
            "the rebase list is empty; expected at least one commit".into(),
        ));
    }
    items.iter().try_for_each(check_item)?;
    check_no_duplicates(items)?;
    check_oldest_kept(items)
}

fn check_item(item: &RebaseItem) -> AppResult<()> {
    check_sha(&item.sha)?;
    match (item.action, item.message.as_deref()) {
        (RebaseAction::Reword, None) => Err(AppError::Other(format!(
            "reword of {} needs a message; expected non-empty text",
            short(&item.sha)
        ))),
        (RebaseAction::Pick | RebaseAction::Reword, Some(text)) if text.trim().is_empty() => {
            Err(AppError::Other(format!(
                "the message of {} is empty; expected non-empty text",
                short(&item.sha)
            )))
        }
        _ => Ok(()),
    }
}

/// WHY: the sha is written into the todo file, so a value with a newline
/// would inject a git command. Only full hex ids pass.
fn check_sha(sha: &str) -> AppResult<()> {
    let well_formed = matches!(sha.len(), 40 | 64) && sha.bytes().all(|b| b.is_ascii_hexdigit());
    if well_formed {
        return Ok(());
    }
    Err(AppError::Other(format!(
        "invalid commit id {sha:?}: expected 40 or 64 hex digits"
    )))
}

fn check_no_duplicates(items: &[RebaseItem]) -> AppResult<()> {
    let mut seen = HashSet::new();
    for item in items {
        if !seen.insert(item.sha.as_str()) {
            return Err(AppError::Other(format!(
                "commit {} is listed twice; expected each commit once",
                short(&item.sha)
            )));
        }
    }
    Ok(())
}

fn check_oldest_kept(items: &[RebaseItem]) -> AppResult<()> {
    let first_kept = items.iter().find(|item| item.action != RebaseAction::Drop);
    match first_kept {
        None => Err(AppError::Other(
            "every commit is dropped; keep at least one commit".into(),
        )),
        Some(first) if matches!(first.action, RebaseAction::Squash | RebaseAction::Fixup) => {
            Err(AppError::Other(format!(
                "the oldest kept commit {} cannot be squash or fixup: nothing older is left to fold it into",
                short(&first.sha)
            )))
        }
        Some(_) => Ok(()),
    }
}

/// Pure: true when `listed` (git's `rev-list base..HEAD`) holds exactly the
/// commits of `items`. A mismatch means the history moved since the list was
/// opened, so replaying it would rebase the wrong commits.
pub fn listed_shas_match(listed: &[&str], items: &[RebaseItem]) -> bool {
    let mut git_side: Vec<&str> = listed.to_vec();
    let mut ui_side: Vec<&str> = items.iter().map(|item| item.sha.as_str()).collect();
    git_side.sort_unstable();
    ui_side.sort_unstable();
    git_side == ui_side
}

/// Pure: the message file a head row reads, named by the row index.
pub fn message_file(msg_dir: &str, index: usize) -> String {
    format!("{msg_dir}/message-{index}.txt")
}

/// Pure: which rows need a message file, as (row index, text). Only pick and
/// reword rows can carry one; drop, squash and fixup messages are ignored.
pub fn message_writes(items: &[RebaseItem]) -> Vec<(usize, &str)> {
    items
        .iter()
        .enumerate()
        .filter(|(_, item)| matches!(item.action, RebaseAction::Pick | RebaseAction::Reword))
        .filter_map(|(index, item)| item.message.as_deref().map(|text| (index, text)))
        .collect()
}

/// Pure: the group head of each row (oldest first). Pick and reword start a
/// group. Squash and fixup join the nearest older group, so a drop between
/// them does not break it. Drop belongs to no group.
fn group_heads(items: &[RebaseItem]) -> Vec<Option<usize>> {
    let mut current: Option<usize> = None;
    items
        .iter()
        .enumerate()
        .map(|(index, item)| match item.action {
            RebaseAction::Pick | RebaseAction::Reword => {
                current = Some(index);
                Some(index)
            }
            RebaseAction::Squash | RebaseAction::Fixup => current,
            RebaseAction::Drop => None,
        })
        .collect()
}

/// Pure: for each row, the head whose message must be written after it, if
/// any. WHY after the group's last row: a squash step combines the messages
/// of its group, and an amend placed earlier would be overwritten by that
/// combination. A head with a message gets its amend after its last member.
pub fn amend_after_rows(items: &[RebaseItem]) -> Vec<Option<usize>> {
    let heads = group_heads(items);
    let mut last_of_head: Vec<Option<usize>> = vec![None; items.len()];
    for (row, head) in heads.iter().enumerate() {
        if let Some(head) = head {
            last_of_head[*head] = Some(row);
        }
    }
    let mut amend = vec![None; items.len()];
    for (head, item) in items.iter().enumerate() {
        if let (Some(last), Some(_)) = (last_of_head[head], item.message.as_ref()) {
            amend[last] = Some(head);
        }
    }
    amend
}

/// Pure: the todo git replays, one line per row, plus an amend line where a
/// message must land. `msg_dir` and `git_exe` are already sh-safe (`sh_path`).
/// WHY `exec` runs git by its full path: the app may be configured with a git
/// that is not on PATH, and the exec line runs in a shell that would not find it.
pub fn build_todo(items: &[RebaseItem], msg_dir: &str, git_exe: &str) -> String {
    let amend = amend_after_rows(items);
    let mut todo = String::new();
    for (row, item) in items.iter().enumerate() {
        todo.push_str(&format!("{} {}\n", verb(item.action), item.sha));
        if let Some(head) = amend[row] {
            todo.push_str(&amend_line(git_exe, &message_file(msg_dir, head)));
        }
    }
    todo
}

fn verb(action: RebaseAction) -> &'static str {
    match action {
        RebaseAction::Pick | RebaseAction::Reword => "pick",
        RebaseAction::Squash => "squash",
        RebaseAction::Fixup => "fixup",
        RebaseAction::Drop => "drop",
    }
}

/// WHY `--no-edit` and `-F`: the amend must never open an editor. `--allow-empty`
/// keeps the amend from failing if the commit has become empty.
fn amend_line(git_exe: &str, msg_file: &str) -> String {
    format!(
        "exec \"{git_exe}\" commit --amend --no-edit --allow-empty -F \"{msg_file}\"\n"
    )
}

/// Pure: the value of GIT_SEQUENCE_EDITOR. Git runs it with the todo path
/// appended, so `cp` copies our todo over git's file. `todo` must be sh-safe.
pub fn sequence_editor_command(todo: &str) -> String {
    format!("cp \"{todo}\"")
}

/// Pure: a path as sh and git read it: forward slashes, no backslashes. The
/// caller wraps it in double quotes. A `"`, `$`, backtick or newline would be
/// expanded or end the quote inside the todo, so those are refused.
pub fn sh_path(path: &Path) -> AppResult<String> {
    let text = path.to_string_lossy().replace('\\', "/");
    match text.chars().find(|c| matches!(c, '"' | '$' | '`' | '\n' | '\r')) {
        None => Ok(text),
        Some(bad) => Err(AppError::Other(format!(
            "temp path {text:?} contains {bad:?}, which the rebase editor cannot quote; expected a temp folder path without quotes, $, backticks or newlines"
        ))),
    }
}

fn short(sha: &str) -> &str {
    sha.get(..7).unwrap_or(sha)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sha(c: char) -> String {
        c.to_string().repeat(40)
    }

    fn item(action: RebaseAction, c: char, message: Option<&str>) -> RebaseItem {
        RebaseItem { action, sha: sha(c), message: message.map(str::to_string) }
    }

    fn amend(c: &str) -> String {
        format!("exec \"G\" commit --amend --no-edit --allow-empty -F \"D/message-{c}.txt\"\n")
    }

    #[test]
    fn build_todo_writes_one_verb_per_action() {
        let items = [
            item(RebaseAction::Pick, 'a', None),
            item(RebaseAction::Squash, 'b', None),
            item(RebaseAction::Fixup, 'c', None),
            item(RebaseAction::Drop, 'd', None),
        ];
        let todo = build_todo(&items, "D", "G");
        let expected = format!(
            "pick {a}\nsquash {b}\nfixup {c}\ndrop {d}\n",
            a = sha('a'), b = sha('b'), c = sha('c'), d = sha('d')
        );
        assert_eq!(todo, expected);
    }

    #[test]
    fn reword_gets_an_amend_line_right_after_its_pick() {
        let items = [item(RebaseAction::Reword, 'a', Some("new")), item(RebaseAction::Pick, 'b', None)];
        let todo = build_todo(&items, "D", "G");
        assert_eq!(todo, format!("pick {}\n{}pick {}\n", sha('a'), amend("0"), sha('b')));
    }

    #[test]
    fn edited_squash_head_gets_its_amend_after_the_last_squash() {
        let items = [
            item(RebaseAction::Pick, 'a', Some("edited")),
            item(RebaseAction::Squash, 'b', None),
            item(RebaseAction::Pick, 'c', None),
        ];
        let todo = build_todo(&items, "D", "G");
        let expected = format!("pick {}\nsquash {}\n{}pick {}\n", sha('a'), sha('b'), amend("0"), sha('c'));
        assert_eq!(todo, expected);
    }

    #[test]
    fn squash_group_without_an_edit_has_no_amend() {
        let items = [item(RebaseAction::Pick, 'a', None), item(RebaseAction::Fixup, 'b', None)];
        assert!(!build_todo(&items, "D", "G").contains("exec"));
    }

    #[test]
    fn drop_between_head_and_squash_keeps_the_group() {
        let items = [
            item(RebaseAction::Pick, 'a', Some("edited")),
            item(RebaseAction::Drop, 'x', None),
            item(RebaseAction::Squash, 'b', None),
        ];
        assert_eq!(amend_after_rows(&items), vec![None, None, Some(0)]);
    }

    #[test]
    fn reword_head_with_fixups_amends_after_the_last_fixup() {
        let items = [
            item(RebaseAction::Reword, 'a', Some("new")),
            item(RebaseAction::Fixup, 'b', None),
            item(RebaseAction::Fixup, 'c', None),
        ];
        assert_eq!(amend_after_rows(&items), vec![None, None, Some(0)]);
    }

    #[test]
    fn two_groups_each_get_their_own_amend() {
        let items = [
            item(RebaseAction::Pick, 'a', Some("one")),
            item(RebaseAction::Squash, 'b', None),
            item(RebaseAction::Reword, 'c', Some("two")),
        ];
        assert_eq!(amend_after_rows(&items), vec![None, Some(0), Some(2)]);
    }

    #[test]
    fn message_writes_cover_pick_and_reword_rows_only() {
        let items = [
            item(RebaseAction::Pick, 'a', Some("kept")),
            item(RebaseAction::Squash, 'b', Some("ignored")),
            item(RebaseAction::Reword, 'c', Some("new")),
            item(RebaseAction::Pick, 'd', None),
        ];
        assert_eq!(message_writes(&items), vec![(0, "kept"), (2, "new")]);
    }

    #[test]
    fn message_file_is_named_by_row_index() {
        assert_eq!(message_file("C:/t/run", 3), "C:/t/run/message-3.txt");
    }

    #[test]
    fn validate_accepts_a_plain_list() {
        let items = [item(RebaseAction::Pick, 'a', None), item(RebaseAction::Squash, 'b', None)];
        assert!(validate_items(&items).is_ok());
    }

    #[test]
    fn validate_rejects_an_empty_list() {
        let err = validate_items(&[]).unwrap_err().to_string();
        assert!(err.contains("empty"), "unexpected: {err}");
    }

    #[test]
    fn validate_rejects_a_list_where_everything_is_dropped() {
        let items = [item(RebaseAction::Drop, 'a', None)];
        let err = validate_items(&items).unwrap_err().to_string();
        assert!(err.contains("keep at least one"), "unexpected: {err}");
    }

    #[test]
    fn validate_rejects_squash_as_the_oldest_kept_commit() {
        let items = [item(RebaseAction::Squash, 'a', None), item(RebaseAction::Pick, 'b', None)];
        let err = validate_items(&items).unwrap_err().to_string();
        assert!(err.contains(&sha('a')[..7]) && err.contains("squash"), "unexpected: {err}");
    }

    #[test]
    fn validate_rejects_squash_right_after_drops_that_leave_nothing_older() {
        let items = [item(RebaseAction::Drop, 'a', None), item(RebaseAction::Fixup, 'b', None)];
        assert!(validate_items(&items).is_err());
    }

    #[test]
    fn validate_rejects_reword_without_a_message() {
        let items = [item(RebaseAction::Reword, 'a', None)];
        assert!(validate_items(&items).unwrap_err().to_string().contains("needs a message"));
    }

    #[test]
    fn validate_rejects_a_blank_edited_message() {
        let items = [item(RebaseAction::Pick, 'a', Some("  \n "))];
        assert!(validate_items(&items).unwrap_err().to_string().contains("is empty"));
    }

    #[test]
    fn validate_rejects_a_commit_listed_twice() {
        let items = [item(RebaseAction::Pick, 'a', None), item(RebaseAction::Drop, 'a', None)];
        assert!(validate_items(&items).unwrap_err().to_string().contains("twice"));
    }

    #[test]
    fn validate_rejects_a_sha_that_is_not_hex() {
        let bad = RebaseItem {
            action: RebaseAction::Pick,
            sha: "a\nexec rm -rf /".into(),
            message: None,
        };
        let err = validate_items(&[bad]).unwrap_err().to_string();
        assert!(err.contains("40 or 64 hex digits"), "unexpected: {err}");
    }

    #[test]
    fn listed_shas_match_ignores_order_but_not_membership() {
        let items = [item(RebaseAction::Pick, 'a', None), item(RebaseAction::Pick, 'b', None)];
        let (a, b) = (sha('a'), sha('b'));
        assert!(listed_shas_match(&[b.as_str(), a.as_str()], &items));
        assert!(!listed_shas_match(&[a.as_str()], &items));
        let c = sha('c');
        assert!(!listed_shas_match(&[a.as_str(), c.as_str()], &items));
    }

    #[test]
    fn sh_path_turns_backslashes_into_slashes() {
        let path = Path::new(r"C:\Users\me\AppData\Local\Temp\gitbee-rebase-1");
        assert_eq!(sh_path(path).unwrap(), "C:/Users/me/AppData/Local/Temp/gitbee-rebase-1");
    }

    #[test]
    fn sh_path_refuses_characters_sh_would_expand_or_break() {
        for bad in ["C:/a\"b", "C:/a$b", "C:/a`b", "C:/a\nb"] {
            let err = sh_path(Path::new(bad)).unwrap_err().to_string();
            assert!(err.contains("cannot quote"), "{bad:?} gave {err}");
        }
    }

    #[test]
    fn sequence_editor_copies_the_todo_over_git_file() {
        assert_eq!(sequence_editor_command("C:/t/todo.txt"), "cp \"C:/t/todo.txt\"");
    }
}
