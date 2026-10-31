//! Git profiles: the Tauri commands, the stored list, and the git round trip.
//! The rules live in profiles/rules.rs, the identity parsing in
//! profiles/identity.rs, and the write plan in profiles/apply_plan.rs. Spec:
//! docs/specs/git-profiles.md.

mod apply_plan;
mod identity;
mod rules;

use crate::error::{AppError, AppResult};
use crate::git::GitRunner;
use crate::state::AppState;
use apply_plan::{apply_plan, write_args, ConfigWrite};
use identity::{build_identity, parse_origin_line, ConfigValue, RepoIdentity};
use rules::{check_profile, normalize, validate_list, Profile};
use std::path::Path;
use tauri::State;

/// Settings key for the profile list (JSON). The `.v1` suffix leaves room for a
/// later shape without guessing at old data.
const PROFILES_KEY: &str = "profiles.v1";

/// `git config --get` exit status for a key that is not set.
const GIT_NOT_SET: i32 = 1;
/// `git config --unset` exit status for a key that is not set.
const GIT_KEY_NOT_FOUND: i32 = 5;

#[tauri::command]
pub async fn profiles_list(state: State<'_, AppState>) -> AppResult<Vec<Profile>> {
    parse_stored(state.cache.settings_get(PROFILES_KEY)?.as_deref())
}

/// Replaces the stored list. The whole list is checked before anything is
/// written, so one bad profile never reaches the settings table.
#[tauri::command]
pub async fn profiles_save(list: Vec<Profile>, state: State<'_, AppState>) -> AppResult<()> {
    let list: Vec<Profile> = list.into_iter().map(normalize).collect();
    validate_list(&list)?;
    state.cache.settings_set(PROFILES_KEY, &serialize_stored(&list)?)
}

#[tauri::command]
pub async fn profile_apply(path: String, profile: Profile, state: State<'_, AppState>) -> AppResult<()> {
    apply_profile(&state.git, Path::new(&path), profile).await
}

#[tauri::command]
pub async fn repo_identity(path: String, state: State<'_, AppState>) -> AppResult<RepoIdentity> {
    read_identity(&state.git, Path::new(&path)).await
}

/// The stored list, or an empty list when nothing is stored yet.
fn parse_stored(raw: Option<&str>) -> AppResult<Vec<Profile>> {
    let Some(text) = raw else { return Ok(Vec::new()) };
    serde_json::from_str(text).map_err(|e| {
        AppError::Parse(format!("stored git profiles are not a JSON array of profiles: {e}"))
    })
}

fn serialize_stored(list: &[Profile]) -> AppResult<String> {
    serde_json::to_string(list)
        .map_err(|e| AppError::Parse(format!("could not encode git profiles: {e}")))
}

/// Writes `profile` into the repo's local config. The profile is checked first,
/// so an invalid one never half-applies.
pub async fn apply_profile(git: &GitRunner, repo: &Path, profile: Profile) -> AppResult<()> {
    let profile = normalize(profile);
    check_profile(&profile)?;
    for write in apply_plan(&profile) {
        apply_write(git, repo, &write).await?;
    }
    Ok(())
}

/// Runs one write. Unsetting a key that is not there is success. Any other
/// failure names the key that failed, and the keys before it stay written.
async fn apply_write(git: &GitRunner, repo: &Path, write: &ConfigWrite) -> AppResult<()> {
    let args = write_args(write)?;
    match git.run(repo, args).await {
        Ok(_) => Ok(()),
        Err(AppError::GitFailed { status: Some(GIT_KEY_NOT_FOUND), .. }) if write.value.is_none() => {
            Ok(())
        }
        Err(e) => Err(AppError::Other(format!("could not write {} in this repo: {e}", write.key))),
    }
}

/// The identity git would commit as in `repo`, with where each value came from.
pub async fn read_identity(git: &GitRunner, repo: &Path) -> AppResult<RepoIdentity> {
    let name = read_with_origin(git, repo, "user.name").await?;
    let email = read_with_origin(git, repo, "user.email").await?;
    Ok(build_identity(name, email))
}

/// `git config --show-origin --get key`, or None when the key is not set.
async fn read_with_origin(git: &GitRunner, repo: &Path, key: &str) -> AppResult<Option<ConfigValue>> {
    match git.run_text_lossy(repo, ["config", "--show-origin", "--get", key]).await {
        Ok(text) => Ok(parse_origin_line(&text)),
        Err(AppError::GitFailed { status: Some(GIT_NOT_SET), .. }) => Ok(None),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::rules::test_support::{profile, work_profile};
    use super::*;

    #[test]
    fn nothing_stored_is_an_empty_list() {
        assert!(parse_stored(None).unwrap().is_empty());
    }

    #[test]
    fn a_corrupt_stored_value_is_an_error_not_an_empty_list() {
        assert!(matches!(parse_stored(Some("[{")), Err(AppError::Parse(_))));
    }

    #[test]
    fn stored_list_round_trips_in_camel_case_and_omits_unset_fields() {
        let list = vec![work_profile(), profile("p2", "Personal")];
        let text = serialize_stored(&list).unwrap();
        assert!(text.contains("\"userName\""));
        assert!(text.contains("\"gpgFormat\":\"ssh\""));
        assert!(!text.contains("isDefault"), "false default must not be stored: {text}");
        assert_eq!(parse_stored(Some(&text)).unwrap(), list);
    }

    /// A throwaway directory under the OS temp dir, removed on drop, so the
    /// git round trip gets a fresh repo each time.
    struct ScratchRepo {
        root: std::path::PathBuf,
    }

    impl ScratchRepo {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let root = std::env::temp_dir()
                .join(format!("gitbee-profiles-{tag}-{}-{nanos}", std::process::id()));
            std::fs::create_dir_all(&root).unwrap();
            Self { root }
        }
    }

    impl Drop for ScratchRepo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    /// The local value of `key` in `repo`, or None when git has none there.
    async fn local_value(git: &GitRunner, repo: &Path, key: &str) -> Option<String> {
        git.run_text_lossy(repo, ["config", "--local", "--get", key])
            .await
            .ok()
            .map(|t| t.trim().to_string())
    }

    #[tokio::test]
    async fn applying_a_profile_writes_the_repo_config_and_reads_back_as_local() {
        let git = GitRunner::discover().expect("git on PATH");
        let repo = ScratchRepo::new("apply");
        git.run(&repo.root, ["init", "-q"]).await.unwrap();
        apply_profile(&git, &repo.root, work_profile()).await.unwrap();
        assert_eq!(local_value(&git, &repo.root, "user.name").await.as_deref(), Some("Jane Doe"));
        assert_eq!(local_value(&git, &repo.root, "user.signingkey").await.as_deref(), Some("ABCD1234"));
        let identity = read_identity(&git, &repo.root).await.unwrap();
        assert_eq!(identity.source, identity::IdentitySource::Local);
        assert_eq!(identity.email, "jane@work.example");
    }

    #[tokio::test]
    async fn switching_to_a_profile_without_a_signing_key_unsets_the_old_one() {
        let git = GitRunner::discover().expect("git on PATH");
        let repo = ScratchRepo::new("switch");
        git.run(&repo.root, ["init", "-q"]).await.unwrap();
        // Unsetting keys that were never set must not be an error.
        apply_profile(&git, &repo.root, profile("p2", "Personal")).await.unwrap();
        apply_profile(&git, &repo.root, work_profile()).await.unwrap();
        apply_profile(&git, &repo.root, profile("p2", "Personal")).await.unwrap();
        assert_eq!(local_value(&git, &repo.root, "user.signingkey").await, None);
        assert_eq!(local_value(&git, &repo.root, "gpg.format").await, None);
    }
}
