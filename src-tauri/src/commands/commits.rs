use crate::error::{AppError, AppResult};
use crate::git::checked_ref;
use crate::git::numstat::{file_stats, parse_commit_stats, CommitFileStat, CommitStat};
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::State;

fn cwd(path: &str) -> PathBuf { PathBuf::from(path) }

/// Most shas one `commit_stats` call takes. The argv of that one git process
/// grows with the count, so callers ask for their visible commits in chunks.
pub const MAX_STATS_SHAS: usize = 200;

#[tauri::command]
pub async fn commit_create(
    path: String,
    message: String,
    amend: Option<bool>,
    sign: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut args: Vec<String> = vec!["commit".into(), "-m".into(), message];
    if amend.unwrap_or(false) { args.push("--amend".into()); }
    if sign.unwrap_or(false) { args.push("-S".into()); }
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

/// Commit message only (subject, blank line, body): what the details panel
/// shows and what the amend form pre-fills. `-s` drops the diff, so a big
/// commit does not build its whole patch just to discard it. Before this, the
/// output was `--format=fuller` headers plus the diff, which both callers read
/// as if it were the message. See docs/specs/commit-details.md.
#[tauri::command]
pub async fn commit_show(
    path: String,
    sha: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let args = commit_show_args(&sha)?;
    state.git.run_text_lossy(&cwd(&path), args).await
}

fn commit_show_args(sha: &str) -> AppResult<Vec<String>> {
    Ok(vec![
        "show".into(),
        "-s".into(),
        "--no-color".into(),
        "--format=%B".into(),
        checked_ref(sha)?.into(),
    ])
}

#[tauri::command]
pub async fn commit_cherry_pick(
    path: String,
    sha: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.git.run(&cwd(&path), ["cherry-pick", checked_ref(&sha)?]).await?;
    Ok(())
}

#[tauri::command]
pub async fn commit_revert(
    path: String,
    sha: String,
    no_edit: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    checked_ref(&sha)?;
    let mut args: Vec<String> = vec!["revert".into()];
    if no_edit.unwrap_or(true) { args.push("--no-edit".into()); }
    args.push(sha);
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

// Generate a single-commit patch via `git format-patch -1 <sha> -o
// <dest_dir>`. Returns the absolute path of the generated `.patch` file
// (format-patch always writes one file for `-1`, named after the
// commit's subject). The caller passes a destination folder picked
// through Tauri's file dialog.
#[tauri::command]
pub async fn commit_format_patch(
    path: String,
    sha: String,
    dest_dir: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let output = state
        .git
        .run_text(&cwd(&path), ["format-patch", "-1", checked_ref(&sha)?, "-o", &dest_dir])
        .await?;
    // `format-patch -1` prints the single resulting filename on stdout,
    // relative to `dest_dir` on some git versions and absolute on
    // others. Normalize to absolute by joining when relative.
    let line = output.lines().next().unwrap_or("").trim().to_string();
    if line.is_empty() { return Ok(dest_dir); }
    let p = std::path::Path::new(&line);
    if p.is_absolute() {
        Ok(line)
    } else {
        Ok(std::path::Path::new(&dest_dir).join(p).to_string_lossy().into_owned())
    }
}

// Apply a patch file to the working tree via `git apply --3way`. The
// 3-way variant falls back to a merge with conflict markers when a
// straight apply doesn't cleanly fit, which matches what the user
// expects from a GUI ("apply this and tell me where conflicts are").
// The patch is NOT committed — the user inspects, stages, and commits
// like any other change. For a "treat patches as commits" workflow
// (`git am`) we'd add a separate command later.
#[tauri::command]
pub async fn patch_apply(
    path: String,
    patch_file: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state
        .git
        .run(&cwd(&path), ["apply", "--3way", &patch_file])
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn commit_reset(
    path: String,
    sha: String,
    mode: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let flag = match mode.as_str() {
        "soft" => "--soft",
        "hard" => "--hard",
        _ => "--mixed",
    };
    state.git.run(&cwd(&path), ["reset", flag, checked_ref(&sha)?]).await?;
    Ok(())
}

/// Changed files of one commit, with counts and no diff text. The panel asks
/// for a file's diff only when that file is expanded. The two `diff-tree`
/// calls run concurrently, so one selection costs two git processes here and
/// one more for `commit_show`.
#[tauri::command]
pub async fn commit_files(
    path: String,
    sha: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<CommitFileStat>> {
    let repo = cwd(&path);
    let (numstat, names) = tokio::join!(
        state.git.run_text_lossy(&repo, diff_tree_args("--numstat", &sha)?),
        state.git.run_text_lossy(&repo, diff_tree_args("--name-status", &sha)?),
    );
    Ok(file_stats(&numstat?, &names?))
}

/// `diff-tree` args that list one commit's files, with `list_flag` set to
/// `--numstat` or `--name-status`. The commit is diffed against its first
/// parent: `--diff-merges=first-parent` does that for merges, matching what
/// most GUIs show and `git show --first-parent` prints. `--root` makes a root
/// commit diff against the empty tree.
///
/// One argument shape covers every commit. Looking up the parent first would
/// cost a third git process per selection. `-M` keeps rename detection the
/// same as the per-file diff.
fn diff_tree_args(list_flag: &str, sha: &str) -> AppResult<Vec<String>> {
    Ok(vec![
        "diff-tree".into(),
        "-r".into(),
        "-z".into(),
        "-M".into(),
        "--no-commit-id".into(),
        "--root".into(),
        "--diff-merges=first-parent".into(),
        list_flag.into(),
        checked_ref(sha)?.into(),
    ])
}

/// Files, additions and deletions for each commit, in one git process, for the
/// graph's changes column. Merges count against their first parent, as
/// `commit_files` does. More than `MAX_STATS_SHAS` shas is an error.
#[tauri::command]
pub async fn commit_stats(
    path: String,
    shas: Vec<String>,
    state: State<'_, AppState>,
) -> AppResult<Vec<CommitStat>> {
    if shas.is_empty() { return Ok(Vec::new()); }
    let args = commit_stats_args(&shas)?;
    let text = state.git.run_text_lossy(&cwd(&path), args).await?;
    Ok(parse_commit_stats(&text))
}

/// `git log` args for `shas`. `--no-walk=unsorted` stops git from walking
/// history and keeps the order the caller gave. `-z` with `\x01%H` headers is
/// what `parse_commit_stats` reads.
fn commit_stats_args(shas: &[String]) -> AppResult<Vec<String>> {
    check_stats_cap(shas.len())?;
    let mut args: Vec<String> = vec![
        "log".into(),
        "--no-walk=unsorted".into(),
        "--format=%x01%H".into(),
        "--numstat".into(),
        "-z".into(),
        "-M".into(),
        "--diff-merges=first-parent".into(),
    ];
    for sha in shas {
        args.push(checked_ref(sha)?.into());
    }
    Ok(args)
}

/// Refuses a `commit_stats` call above the cap. The message names the count,
/// so a caller that chunked wrongly can see by how much.
fn check_stats_cap(count: usize) -> AppResult<()> {
    if count <= MAX_STATS_SHAS {
        return Ok(());
    }
    Err(AppError::Other(format!(
        "commit_stats takes at most {MAX_STATS_SHAS} shas per call, got {count}"
    )))
}

/// The only config keys the commit box may read. WHY an allow-list: the
/// frontend asks by key name, and an open read would expose any setting,
/// including credential helpers and URL rewrites. Add a key here only when the
/// commit box uses it (docs/specs/commit-box.md "Config reads").
const READABLE_CONFIG_KEYS: [&str; 6] = [
    "commit.gpgsign",
    "commit.template",
    "user.name",
    "user.email",
    "gpg.format",
    "user.signingkey",
];

/// One allow-listed config value in this repo, or None when it is unset.
/// Values come back as git prints them; the frontend reads booleans.
#[tauri::command]
pub async fn git_config_get(
    path: String,
    key: String,
    state: State<'_, AppState>,
) -> AppResult<Option<String>> {
    check_readable_config_key(&key)?;
    read_config(&state, &cwd(&path), &key).await
}

/// Refuses a key outside `READABLE_CONFIG_KEYS`. Case is ignored because git
/// config keys are case-insensitive, so `COMMIT.GPGSIGN` is the same key.
fn check_readable_config_key(key: &str) -> AppResult<()> {
    let lower = key.to_ascii_lowercase();
    if READABLE_CONFIG_KEYS.contains(&lower.as_str()) {
        return Ok(());
    }
    Err(AppError::Other(format!(
        "git config key {key:?} is not readable from the commit box; allowed keys: {}",
        READABLE_CONFIG_KEYS.join(", ")
    )))
}

/// `git config --get`. Exit status 1 means "not set" and is not an error, so
/// the caller can tell an unset key from a failed read.
async fn read_config(state: &AppState, repo: &Path, key: &str) -> AppResult<Option<String>> {
    match state.git.run_text_lossy(repo, ["config", "--get", key]).await {
        Ok(text) => Ok(Some(text.trim().to_string())),
        Err(AppError::GitFailed { status: Some(1), .. }) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Text of the file named by `commit.template`, or None when the key is unset
/// or the file cannot be read. WHY best effort: the box pre-fills from the
/// template, and a missing template must not block typing. `git commit` reads
/// the same file itself, so a broken path still surfaces there.
#[tauri::command]
pub async fn commit_template(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<Option<String>> {
    let repo = cwd(&path);
    let Some(raw) = read_config(&state, &repo, "commit.template").await? else {
        return Ok(None);
    };
    let root = repo_root(&state, &repo).await?;
    let file = resolve_template_path(&raw, &root, dirs::home_dir());
    match std::fs::read(&file) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(e) => {
            tracing::warn!(path = %file.display(), error = %e, "commit template unreadable");
            Ok(None)
        }
    }
}

async fn repo_root(state: &AppState, repo: &Path) -> AppResult<PathBuf> {
    let root = state.git.run_text_lossy(repo, ["rev-parse", "--show-toplevel"]).await?;
    Ok(PathBuf::from(root.trim()))
}

/// Where `commit.template` points. A leading `~` expands to the home directory,
/// a relative path is taken from the repo root (as git documents for
/// commit.template), and an absolute path is used as is. The home directory is
/// a parameter so the tests do not depend on the machine they run on.
fn resolve_template_path(raw: &str, repo_root: &Path, home: Option<PathBuf>) -> PathBuf {
    if let Some(path) = home_relative(raw, home) {
        return path;
    }
    let path = Path::new(raw);
    if path.is_absolute() {
        return path.to_path_buf();
    }
    repo_root.join(path)
}

/// `~` or `~/rest` (or `~\rest` on Windows) under `home`. None when `raw` is
/// not a home path or no home directory is known.
fn home_relative(raw: &str, home: Option<PathBuf>) -> Option<PathBuf> {
    let home = home?;
    if raw == "~" {
        return Some(home);
    }
    let rest = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\"))?;
    Some(home.join(rest))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sha_list(n: usize) -> Vec<String> {
        (0..n).map(|i| format!("{i:040x}")).collect()
    }

    #[test]
    fn diff_tree_args_diff_each_commit_against_its_first_parent() {
        let args = diff_tree_args("--numstat", "abc123").unwrap();
        assert!(args.contains(&"--root".to_string()));
        assert!(args.contains(&"--diff-merges=first-parent".to_string()));
        assert!(args.contains(&"-z".to_string()));
        assert!(args.contains(&"-M".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("abc123"));
    }

    #[test]
    fn diff_tree_args_use_only_the_requested_listing() {
        let args = diff_tree_args("--name-status", "abc").unwrap();
        assert!(args.contains(&"--name-status".to_string()));
        assert!(!args.contains(&"--numstat".to_string()));
    }

    #[test]
    fn diff_tree_args_refuse_an_option_like_sha() {
        assert!(matches!(diff_tree_args("--numstat", "--output=x"), Err(AppError::Other(_))));
    }

    #[test]
    fn commit_show_args_return_the_message_without_a_diff() {
        let args = commit_show_args("abc").unwrap();
        assert!(args.contains(&"-s".to_string()));
        assert!(args.contains(&"--format=%B".to_string()));
        assert!(!args.iter().any(|a| a.starts_with("--format=fuller")));
        assert_eq!(args.last().map(String::as_str), Some("abc"));
    }

    #[test]
    fn commit_stats_args_pass_shas_in_the_given_order() {
        let shas = vec!["bbb".to_string(), "aaa".to_string()];
        let args = commit_stats_args(&shas).unwrap();
        assert!(args.contains(&"--no-walk=unsorted".to_string()));
        assert_eq!(&args[args.len() - 2..], &["bbb".to_string(), "aaa".to_string()]);
    }

    #[test]
    fn commit_stats_args_accept_exactly_the_cap() {
        assert!(commit_stats_args(&sha_list(MAX_STATS_SHAS)).is_ok());
    }

    #[test]
    fn commit_stats_args_refuse_more_than_the_cap_and_name_the_count() {
        match commit_stats_args(&sha_list(MAX_STATS_SHAS + 1)) {
            Err(AppError::Other(msg)) => assert!(msg.contains("got 201")),
            other => panic!("expected an Other error, got {other:?}"),
        }
    }

    #[test]
    fn commit_stats_args_refuse_an_option_like_sha() {
        assert!(commit_stats_args(&["--all".to_string()]).is_err());
    }

    #[test]
    fn every_commit_box_key_is_readable() {
        for key in READABLE_CONFIG_KEYS {
            assert!(check_readable_config_key(key).is_ok(), "{key} should be readable");
        }
    }

    #[test]
    fn config_key_check_ignores_case() {
        assert!(check_readable_config_key("COMMIT.GPGSIGN").is_ok());
    }

    #[test]
    fn config_key_check_refuses_keys_outside_the_list() {
        for key in ["core.sshCommand", "url.x.insteadOf", "--get", "credential.helper"] {
            assert!(check_readable_config_key(key).is_err(), "{key} must be refused");
        }
    }

    #[test]
    fn refused_config_key_message_names_the_key_and_the_allowed_list() {
        let msg = check_readable_config_key("core.editor").unwrap_err().to_string();
        assert!(msg.contains("core.editor"));
        assert!(msg.contains("commit.template"));
    }

    #[test]
    fn template_path_is_relative_to_the_repo_root() {
        let root = Path::new("/repo");
        let got = resolve_template_path("tpl/msg.txt", root, None);
        assert_eq!(got, root.join("tpl/msg.txt"));
    }

    #[test]
    fn template_path_expands_a_leading_tilde_to_home() {
        let home = PathBuf::from("/home/u");
        let got = resolve_template_path("~/msg.txt", Path::new("/repo"), Some(home.clone()));
        assert_eq!(got, home.join("msg.txt"));
    }

    #[test]
    fn template_path_tilde_alone_is_home() {
        let home = PathBuf::from("/home/u");
        let got = resolve_template_path("~", Path::new("/repo"), Some(home.clone()));
        assert_eq!(got, home);
    }

    #[test]
    fn template_path_keeps_an_absolute_path() {
        let abs = std::env::temp_dir().join("msg.txt");
        let got = resolve_template_path(&abs.to_string_lossy(), Path::new("/repo"), None);
        assert_eq!(got, abs);
    }

    #[test]
    fn template_tilde_without_a_home_dir_falls_back_to_the_repo_root() {
        let got = resolve_template_path("~/msg.txt", Path::new("/repo"), None);
        assert_eq!(got, Path::new("/repo").join("~/msg.txt"));
    }
}
