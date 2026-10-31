//! The identity git would commit as, parsed from `git config --show-origin`.
//! Pure: the git call lives in commands/profiles.rs. Spec: docs/specs/git-profiles.md
//! "Reading the identity".

use serde::Serialize;

/// Where the identity comes from, as the status bar and commit box show it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IdentitySource {
    Local,
    Global,
    None,
}

/// The identity git would commit as in one repo. Empty strings mean unset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RepoIdentity {
    pub name: String,
    pub email: String,
    pub source: IdentitySource,
}

/// One value git printed, and whether its file is this repo's own config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigValue {
    pub value: String,
    pub local: bool,
}

/// One `--show-origin` line, `file:<path>` then a tab then the value. `--get`
/// prints one line, the last value when a key repeats. None when the line has no tab.
pub fn parse_origin_line(text: &str) -> Option<ConfigValue> {
    let line = text.lines().last()?;
    let (origin, value) = line.split_once('\t')?;
    Some(ConfigValue { value: value.to_string(), local: is_local_origin(origin) })
}

/// True when the origin is the repo's own config file. Matches `.git/config`
/// and linked worktrees' `config.worktree`, with either slash, since git prints
/// the path as it found it. A global file such as `~/.gitconfig` is not local.
pub fn is_local_origin(origin: &str) -> bool {
    let Some(path) = origin.strip_prefix("file:") else { return false };
    let normalized = path.replace('\\', "/");
    normalized == ".git/config"
        || normalized.ends_with("/.git/config")
        || normalized.ends_with("/config.worktree")
}

/// The identity from the two values. A value git did not print stays empty.
pub fn build_identity(name: Option<ConfigValue>, email: Option<ConfigValue>) -> RepoIdentity {
    let source = identity_source(name.as_ref(), email.as_ref());
    RepoIdentity {
        name: name.map(|c| c.value).unwrap_or_default(),
        email: email.map(|c| c.value).unwrap_or_default(),
        source,
    }
}

/// `none` when either value is unset or empty. Otherwise `local` if either value
/// comes from this repo's config, else `global`.
fn identity_source(name: Option<&ConfigValue>, email: Option<&ConfigValue>) -> IdentitySource {
    match (name, email) {
        (Some(n), Some(e)) if !n.value.is_empty() && !e.value.is_empty() => {
            if n.local || e.local {
                IdentitySource::Local
            } else {
                IdentitySource::Global
            }
        }
        _ => IdentitySource::None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn value(text: &str, local: bool) -> Option<ConfigValue> {
        Some(ConfigValue { value: text.into(), local })
    }

    #[test]
    fn origin_line_splits_the_path_from_the_value() {
        let got = parse_origin_line("file:.git/config\tJane Doe\n").unwrap();
        assert_eq!(got, ConfigValue { value: "Jane Doe".into(), local: true });
    }

    #[test]
    fn origin_line_without_a_tab_is_unset() {
        assert_eq!(parse_origin_line(""), None);
        assert_eq!(parse_origin_line("file:.git/config"), None);
    }

    #[test]
    fn local_origin_matches_repo_config_and_worktree_config() {
        for origin in [
            "file:.git/config",
            "file:C:/work/repo/.git/config",
            "file:C:\\work\\repo\\.git\\config",
            "file:/home/u/repo/.git/worktrees/x/config.worktree",
        ] {
            assert!(is_local_origin(origin), "{origin} should be local");
        }
    }

    #[test]
    fn global_and_system_origins_are_not_local() {
        for origin in [
            "file:C:/Users/u/.gitconfig",
            "file:/home/u/.config/git/config",
            "file:C:/Program Files/Git/etc/gitconfig",
            "command line:",
        ] {
            assert!(!is_local_origin(origin), "{origin} should not be local");
        }
    }

    #[test]
    fn identity_is_local_when_either_value_is_local() {
        let got = build_identity(value("Jane", false), value("j@h", true));
        assert_eq!(got.source, IdentitySource::Local);
    }

    #[test]
    fn identity_is_global_when_both_values_come_from_elsewhere() {
        let got = build_identity(value("Jane", false), value("j@h", false));
        assert_eq!(got.source, IdentitySource::Global);
        assert_eq!(got.email, "j@h");
    }

    #[test]
    fn identity_is_none_when_either_value_is_missing_or_empty() {
        assert_eq!(build_identity(None, value("j@h", true)).source, IdentitySource::None);
        assert_eq!(build_identity(value("Jane", true), value("", true)).source, IdentitySource::None);
    }

    #[test]
    fn an_unset_identity_has_empty_strings() {
        let got = build_identity(None, None);
        assert_eq!(
            got,
            RepoIdentity { name: String::new(), email: String::new(), source: IdentitySource::None }
        );
    }
}
