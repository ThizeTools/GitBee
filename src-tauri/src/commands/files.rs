use crate::error::{AppError, AppResult};
use crate::git::blame::{blame_args, parse_blame_porcelain, BlameResult};
use crate::git::file_log::{file_log_args, parse_file_log, FileLogEntry, DEFAULT_LIMIT};
use crate::git::{checked_ref, GitRunner};
use crate::state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use tauri::State;
use tokio::fs;

fn cwd(p: &str) -> PathBuf { PathBuf::from(p) }

fn safe_join(repo: &Path, file: &str) -> AppResult<PathBuf> {
    // Reject absolute paths and `..` traversal — file is repo-relative.
    let pb = PathBuf::from(file);
    if pb.is_absolute() {
        return Err(AppError::Other(format!("absolute path not allowed: {file}")));
    }
    for c in pb.components() {
        if matches!(c, std::path::Component::ParentDir) {
            return Err(AppError::Other(format!("parent traversal not allowed: {file}")));
        }
    }
    Ok(repo.join(pb))
}

#[tauri::command]
pub async fn file_read(path: String, file: String) -> AppResult<String> {
    let full = safe_join(&cwd(&path), &file)?;
    let bytes = fs::read(&full).await?;
    // Try utf-8; fall back to lossy.
    Ok(match String::from_utf8(bytes.clone()) {
        Ok(s) => s,
        Err(_) => String::from_utf8_lossy(&bytes).into_owned(),
    })
}

/// Read the file's contents at a specific commit (`git show <sha>:<file>`).
/// Used by the commit-details file viewer to show the file as it existed at
/// that commit, alongside the diff.
#[tauri::command]
pub async fn file_read_at(
    path: String,
    sha: String,
    file: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    // safe_join is for filesystem reads only; this goes through git, which
    // already rejects paths outside the repo. Still validate to keep the
    // shape consistent.
    let _ = safe_join(&cwd(&path), &file)?;
    // Guard the sha so a value starting with '-' can't make the combined
    // `<sha>:<file>` spec parse as a git option. (audit 2026-05)
    checked_ref(&sha)?;
    let spec = format!("{sha}:{file}");
    state.git.run_text_lossy(&cwd(&path), ["show", &spec]).await
}

/// Largest image sent to the webview as base64. A bigger blob would stall the
/// diff view, so the frontend shows the error text in place of the image.
pub const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct FileBytes { pub base64: String, pub mime: String }

/// MIME type for the image extensions the diff viewer previews, or `None`
/// for anything else so non-images never reach the base64 path.
/// Keep the list in sync with IMAGE_EXTENSIONS in src/lib/diff/image.ts.
pub fn image_mime(file: &str) -> Option<&'static str> {
    let ext = Path::new(file).extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// Object name for one side of an image diff: `INDEX` is the staged blob
/// (`:<file>`), any other value is a git revision (`<rev>:<file>`).
/// The rev is guarded so a leading `-` cannot become a git option.
fn blob_spec(rev: &str, file: &str) -> AppResult<String> {
    if rev == "INDEX" {
        return Ok(format!(":{file}"));
    }
    Ok(format!("{}:{file}", checked_ref(rev)?))
}

fn check_size(bytes: u64, file: &str) -> AppResult<()> {
    if bytes <= MAX_IMAGE_BYTES {
        return Ok(());
    }
    let mib = 1024.0 * 1024.0;
    Err(AppError::Other(format!(
        "{file} is {:.1} MB; the diff viewer previews images up to {:.0} MB",
        bytes as f64 / mib,
        MAX_IMAGE_BYTES as f64 / mib,
    )))
}

async fn worktree_bytes(repo: &Path, file: &str) -> AppResult<Vec<u8>> {
    let full = safe_join(repo, file)?;
    check_size(fs::metadata(&full).await?.len(), file)?;
    Ok(fs::read(&full).await?)
}

/// Size is checked with `cat-file -s` before the blob is loaded, so an
/// oversized image never gets pulled into memory.
async fn rev_bytes(git: &GitRunner, repo: &Path, rev: &str, file: &str) -> AppResult<Vec<u8>> {
    let spec = blob_spec(rev, file)?;
    let size_text = git.run_text(repo, ["cat-file", "-s", &spec]).await?;
    let size: u64 = size_text
        .trim()
        .parse()
        .map_err(|e| AppError::Parse(format!("bad blob size for {spec}: {e}")))?;
    check_size(size, file)?;
    git.run(repo, ["cat-file", "blob", &spec]).await
}

/// Bytes of an image at a revision (`rev` = `INDEX` or a sha/ref) or in the
/// working tree (`rev` = None). `cat-file blob` returns the raw stored bytes;
/// `git show` could apply textconv filters and change them.
#[tauri::command]
pub async fn file_bytes_base64(
    path: String,
    rev: Option<String>,
    file: String,
    state: State<'_, AppState>,
) -> AppResult<FileBytes> {
    let mime = image_mime(&file)
        .ok_or_else(|| AppError::Other(format!("not an image file: {file}")))?;
    let repo = PathBuf::from(&path);
    let bytes = match rev.as_deref() {
        None => worktree_bytes(&repo, &file).await?,
        Some(r) => rev_bytes(&state.git, &repo, r, &file).await?,
    };
    Ok(FileBytes { base64: STANDARD.encode(&bytes), mime: mime.into() })
}

#[tauri::command]
pub async fn file_delete(path: String, file: String) -> AppResult<()> {
    let full = safe_join(&cwd(&path), &file)?;
    if full.is_dir() {
        fs::remove_dir_all(&full).await?;
    } else if full.exists() {
        fs::remove_file(&full).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn file_show_in_folder(path: String, file: String) -> AppResult<()> {
    let full = safe_join(&cwd(&path), &file)?;
    let _parent = full.parent().unwrap_or(&full);
    #[cfg(target_os = "windows")]
    {
        // explorer.exe /select,<path>
        // - Must be a SINGLE argument (`/select,<path>` glued together).
        //   Passing two args splits them on the command line and Explorer
        //   ignores the selection, just opening the user's home folder.
        // - Path must use backslashes; safe_join may have left forward
        //   slashes from the JS-side input.
        let normalized = full.to_string_lossy().replace('/', "\\");
        let arg = format!("/select,{normalized}");
        StdCommand::new("explorer").arg(arg).spawn()?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        StdCommand::new("open").args(["-R", &full.to_string_lossy()]).spawn()?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        StdCommand::new("xdg-open").arg(_parent).spawn()?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Ok(())
}

#[tauri::command]
pub async fn file_edit(path: String, file: String) -> AppResult<()> {
    let full = safe_join(&cwd(&path), &file)?;
    #[cfg(target_os = "windows")]
    { StdCommand::new("cmd").args(["/C", "start", "", &full.to_string_lossy()]).spawn()?; return Ok(()); }
    #[cfg(target_os = "macos")]
    { StdCommand::new("open").arg(&full).spawn()?; return Ok(()); }
    #[cfg(all(unix, not(target_os = "macos")))]
    { StdCommand::new("xdg-open").arg(&full).spawn()?; return Ok(()); }
    #[allow(unreachable_code)]
    Ok(())
}

/// Real write location for a repo-relative file. `safe_join` only inspects the
/// text of the path, so this also resolves symlinks: a link inside the repo
/// that points outside it is refused. Returns the canonical parent joined with
/// the file name, so the write lands where the check ran.
pub fn confined_write_path(repo: &Path, file: &str) -> AppResult<PathBuf> {
    let full = safe_join(repo, file)?;
    let root = std::fs::canonicalize(repo)?;
    let name = full
        .file_name()
        .ok_or_else(|| AppError::Other(format!("no file name in {file:?}")))?;
    let parent = full
        .parent()
        .ok_or_else(|| AppError::Other(format!("no parent directory for {file:?}")))?;
    let real_parent = std::fs::canonicalize(parent)?;
    ensure_inside(&root, &real_parent, file)?;
    let target = real_parent.join(name);
    if target.exists() {
        ensure_inside(&root, &std::fs::canonicalize(&target)?, file)?;
    }
    Ok(target)
}

fn ensure_inside(root: &Path, real: &Path, file: &str) -> AppResult<()> {
    if real.starts_with(root) {
        return Ok(());
    }
    Err(AppError::Other(format!(
        "write outside the repo refused: {file} resolves to {}",
        real.display()
    )))
}

/// Saves the conflict editor's result to a worktree file. The editor refuses to
/// send text that still has markers, and the caller stages the file afterwards.
#[tauri::command]
pub async fn file_write(path: String, file: String, content: String) -> AppResult<()> {
    let target = confined_write_path(&cwd(&path), &file)?;
    fs::write(&target, content.as_bytes()).await?;
    Ok(())
}

/// Commits that touched `file`, following renames. `skip` passes over the
/// commits an earlier page already showed. One git process per call.
/// See docs/specs/file-history-blame.md.
#[tauri::command]
pub async fn file_history(
    path: String,
    file: String,
    limit: Option<usize>,
    skip: Option<usize>,
    state: State<'_, AppState>,
) -> AppResult<Vec<FileLogEntry>> {
    let args = file_log_args(&file, limit.unwrap_or(DEFAULT_LIMIT), skip.unwrap_or(0))?;
    let text = state.git.run_text_lossy(&cwd(&path), args).await?;
    Ok(parse_file_log(&text))
}

/// Blame of `file` at `rev`, or in the working tree when `rev` is None. One
/// git process per call. See docs/specs/file-history-blame.md.
#[tauri::command]
pub async fn file_blame(
    path: String,
    file: String,
    rev: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<BlameResult> {
    let args = blame_args(&file, rev.as_deref())?;
    let text = state.git.run_text_lossy(&cwd(&path), args).await?;
    Ok(parse_blame_porcelain(&text))
}

#[tauri::command]
pub async fn ignore_add(path: String, pattern: String) -> AppResult<()> {
    use tokio::io::AsyncWriteExt;
    let gi = cwd(&path).join(".gitignore");
    // Append (creating if missing).
    let mut f = tokio::fs::OpenOptions::new()
        .create(true).append(true).open(&gi).await?;
    let line = if pattern.ends_with('\n') { pattern } else { format!("{pattern}\n") };
    f.write_all(line.as_bytes()).await?;
    Ok(())
}

#[tauri::command]
pub async fn stash_file(
    path: String,
    file: String,
    message: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut args: Vec<String> = vec!["stash".into(), "push".into()];
    if let Some(m) = message { args.push("-m".into()); args.push(m); }
    args.push("--".into());
    args.push(file);
    state.git.run(&cwd(&path), args).await?;
    Ok(())
}

#[tauri::command]
pub async fn stash_edit_message(
    path: String,
    index: usize,
    message: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    // Git has no in-place stash-message edit. We re-create the entry, but order
    // matters: STORE FIRST, then drop the original. `git stash store` pushes the
    // sha onto refs/stash as stash@{0}, shifting the original from stash@{index}
    // to stash@{index+1}; we then drop that. Storing before dropping means a
    // failure leaves a harmless DUPLICATE rather than LOSING the stash — the old
    // drop-then-store order could delete the entry and then fail to recreate it.
    // The edited stash moving to the top is inherent to git's reflog. (audit 2026-05)
    let r = format!("stash@{{{index}}}");
    let sha = state.git
        .run_text(&cwd(&path), ["rev-parse", &r])
        .await?
        .trim()
        .to_string();
    state.git.run(&cwd(&path), ["stash", "store", "-m", &message, &sha]).await?;
    let shifted = format!("stash@{{{}}}", index + 1);
    state.git.run(&cwd(&path), ["stash", "drop", &shifted]).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_mime_maps_preview_extensions_case_insensitively() {
        assert_eq!(image_mime("logo.PNG"), Some("image/png"));
        assert_eq!(image_mime("photo.jpeg"), Some("image/jpeg"));
        assert_eq!(image_mime("dir.d/icon.svg"), Some("image/svg+xml"));
        assert_eq!(image_mime("favicon.ico"), Some("image/x-icon"));
    }

    #[test]
    fn image_mime_rejects_non_images_and_extensionless_paths() {
        assert_eq!(image_mime("main.rs"), None);
        assert_eq!(image_mime("Makefile"), None);
        assert_eq!(image_mime("archive.png.zip"), None);
    }

    #[test]
    fn blob_spec_uses_index_colon_form_for_staged_blobs() {
        assert_eq!(blob_spec("INDEX", "a/b.png").unwrap(), ":a/b.png");
        assert_eq!(blob_spec("HEAD", "a.png").unwrap(), "HEAD:a.png");
        assert_eq!(blob_spec("abc123^", "a.png").unwrap(), "abc123^:a.png");
    }

    #[test]
    fn blob_spec_refuses_revs_that_look_like_options() {
        assert!(blob_spec("--output=x", "a.png").is_err());
    }

    #[test]
    fn check_size_accepts_the_limit_and_names_the_size_above_it() {
        assert!(check_size(MAX_IMAGE_BYTES, "a.png").is_ok());
        let err = check_size(21 * 1024 * 1024, "big.png").unwrap_err().to_string();
        assert!(err.contains("big.png is 21.0 MB"), "unexpected message: {err}");
    }

    /// A throwaway directory under the OS temp dir, removed on drop, so each
    /// test gets a fresh "repo root" without a git init.
    struct ScratchRepo { root: PathBuf }

    impl ScratchRepo {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let root = std::env::temp_dir()
                .join(format!("gitbee-{tag}-{}-{nanos}", std::process::id()));
            std::fs::create_dir_all(root.join("sub")).unwrap();
            Self { root }
        }
    }

    impl Drop for ScratchRepo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn confined_write_path_accepts_an_existing_file_inside_the_repo() {
        let repo = ScratchRepo::new("confine-ok");
        std::fs::write(repo.root.join("sub/a.txt"), "x").unwrap();
        let target = confined_write_path(&repo.root, "sub/a.txt").unwrap();
        assert!(target.ends_with("a.txt"));
    }

    #[test]
    fn confined_write_path_accepts_a_new_file_in_an_existing_directory() {
        let repo = ScratchRepo::new("confine-new");
        assert!(confined_write_path(&repo.root, "sub/new.txt").is_ok());
    }

    #[test]
    fn confined_write_path_refuses_parent_traversal() {
        let repo = ScratchRepo::new("confine-dotdot");
        assert!(confined_write_path(&repo.root, "../escape.txt").is_err());
    }

    #[test]
    fn confined_write_path_refuses_absolute_paths() {
        let repo = ScratchRepo::new("confine-abs");
        let outside = std::env::temp_dir().join("escape.txt");
        let err = confined_write_path(&repo.root, &outside.to_string_lossy())
            .unwrap_err()
            .to_string();
        assert!(err.contains("absolute path not allowed"), "unexpected message: {err}");
    }

    #[test]
    fn confined_write_path_refuses_a_missing_parent_directory() {
        let repo = ScratchRepo::new("confine-missing");
        assert!(confined_write_path(&repo.root, "nope/x.txt").is_err());
    }

    #[test]
    fn ensure_inside_accepts_the_root_and_refuses_siblings_of_it() {
        let repo = ScratchRepo::new("confine-real");
        assert!(ensure_inside(&repo.root, &repo.root.join("sub"), "x").is_ok());
        assert!(ensure_inside(&repo.root, &std::env::temp_dir(), "x").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn confined_write_path_refuses_a_link_inside_the_repo_that_points_outside() {
        let repo = ScratchRepo::new("confine-link");
        let outside = ScratchRepo::new("confine-outside");
        std::fs::write(outside.root.join("x.txt"), "x").unwrap();
        std::os::unix::fs::symlink(outside.root.join("x.txt"), repo.root.join("link.txt")).unwrap();
        assert!(confined_write_path(&repo.root, "link.txt").is_err());
    }
}
