//! The `git config --local` writes that make a repo commit as a profile. Pure:
//! each write is data, and running it is in commands/profiles.rs. Spec:
//! docs/specs/git-profiles.md "Applying a profile".

use super::rules::Profile;
use crate::error::{AppError, AppResult};

/// The only keys a profile writes. WHY an allow-list: apply takes a profile from
/// the webview, and an open key would let it rewrite any setting in the repo.
pub const PROFILE_CONFIG_KEYS: [&str; 4] = ["user.name", "user.email", "user.signingkey", "gpg.format"];

/// One `git config --local` write. `value: None` unsets the key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigWrite {
    pub key: &'static str,
    pub value: Option<String>,
}

/// The writes that make a repo commit as `profile`. A key the profile leaves out
/// is unset, so a signing key from the previous profile does not survive the switch.
pub fn apply_plan(profile: &Profile) -> Vec<ConfigWrite> {
    vec![
        ConfigWrite { key: "user.name", value: Some(profile.user_name.clone()) },
        ConfigWrite { key: "user.email", value: Some(profile.user_email.clone()) },
        ConfigWrite { key: "user.signingkey", value: profile.signing_key.clone() },
        ConfigWrite {
            key: "gpg.format",
            value: profile.gpg_format.map(|f| f.as_git().to_string()),
        },
    ]
}

/// Argv for one write. `--local` is always passed, so the global and system
/// files are never the target. The key is checked against the allow-list here,
/// the last step before git runs.
pub fn write_args(write: &ConfigWrite) -> AppResult<Vec<String>> {
    check_profile_key(write.key)?;
    let mut args = vec!["config".to_string(), "--local".to_string()];
    match &write.value {
        Some(value) => args.extend([write.key.to_string(), value.clone()]),
        None => args.extend(["--unset".to_string(), write.key.to_string()]),
    }
    Ok(args)
}

fn check_profile_key(key: &str) -> AppResult<()> {
    if PROFILE_CONFIG_KEYS.contains(&key) {
        return Ok(());
    }
    Err(AppError::Other(format!(
        "git config key {key:?} is not written by profiles; allowed keys: {}",
        PROFILE_CONFIG_KEYS.join(", ")
    )))
}

#[cfg(test)]
mod tests {
    use super::super::rules::test_support::{profile, work_profile};
    use super::*;

    #[test]
    fn apply_plan_writes_all_four_keys_in_order() {
        let keys: Vec<&str> = apply_plan(&work_profile()).iter().map(|w| w.key).collect();
        assert_eq!(keys, PROFILE_CONFIG_KEYS);
        let plan = apply_plan(&work_profile());
        assert_eq!(plan[2].value.as_deref(), Some("ABCD1234"));
        assert_eq!(plan[3].value.as_deref(), Some("ssh"));
    }

    #[test]
    fn apply_plan_unsets_the_signing_keys_a_profile_leaves_out() {
        let plan = apply_plan(&profile("p2", "Personal"));
        assert_eq!(plan[2].value, None);
        assert_eq!(plan[3].value, None);
    }

    #[test]
    fn every_write_targets_the_local_config_and_never_global_or_system() {
        for write in apply_plan(&work_profile()) {
            let args = write_args(&write).unwrap();
            assert!(args.contains(&"--local".to_string()), "{args:?}");
            assert!(!args.iter().any(|a| a == "--global" || a == "--system"), "{args:?}");
        }
    }

    #[test]
    fn an_unset_write_uses_unset_and_a_set_write_uses_the_value() {
        let unset = write_args(&ConfigWrite { key: "gpg.format", value: None }).unwrap();
        assert_eq!(unset, ["config", "--local", "--unset", "gpg.format"]);
        let set = write_args(&ConfigWrite { key: "user.name", value: Some("J".into()) }).unwrap();
        assert_eq!(set, ["config", "--local", "user.name", "J"]);
    }

    #[test]
    fn a_key_outside_the_profile_allow_list_is_refused() {
        for key in ["core.sshCommand", "credential.helper", "url.x.insteadOf", "--global"] {
            let write = ConfigWrite { key, value: Some("x".into()) };
            assert!(write_args(&write).is_err(), "{key} must be refused");
        }
    }

    #[test]
    fn the_allow_list_is_exactly_the_four_profile_keys() {
        assert_eq!(PROFILE_CONFIG_KEYS, ["user.name", "user.email", "user.signingkey", "gpg.format"]);
    }
}
