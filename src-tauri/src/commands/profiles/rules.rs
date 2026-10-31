//! The profile model and the rules a stored list must pass. Pure: no git, no
//! storage. Spec: docs/specs/git-profiles.md "Validation".

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// The values git accepts for `gpg.format`. Any other string fails to parse, so
/// a bad format never reaches `git config`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GpgFormat {
    Openpgp,
    Ssh,
    X509,
}

impl GpgFormat {
    /// The value git stores under `gpg.format`.
    pub fn as_git(self) -> &'static str {
        match self {
            GpgFormat::Openpgp => "openpgp",
            GpgFormat::Ssh => "ssh",
            GpgFormat::X509 => "x509",
        }
    }
}

/// One named identity. `name` is the label in the UI and is never written to git.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub user_name: String,
    pub user_email: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signing_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gpg_format: Option<GpgFormat>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_default: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// Trims text and drops an optional field that is empty after trimming. WHY on
/// the backend too: a profile from any caller is stored and written to git in
/// the same form.
pub fn normalize(profile: Profile) -> Profile {
    Profile {
        id: profile.id.trim().to_string(),
        name: profile.name.trim().to_string(),
        user_name: profile.user_name.trim().to_string(),
        user_email: profile.user_email.trim().to_string(),
        signing_key: profile.signing_key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()),
        ..profile
    }
}

/// Checks a whole list as it will be stored: each profile, then the rules that
/// span profiles.
pub fn validate_list(list: &[Profile]) -> AppResult<()> {
    for profile in list {
        check_profile(profile)?;
    }
    check_unique(list)
}

/// One profile's own rules. Each message names the field and the value, so the
/// user can see what to fix.
pub fn check_profile(p: &Profile) -> AppResult<()> {
    require_text("id", &p.id)?;
    require_text("name", &p.name)?;
    require_text("userName", &p.user_name)?;
    require_text("userEmail", &p.user_email)?;
    check_email(&p.user_email)?;
    for (field, value) in single_line_fields(p) {
        check_one_line(field, value)?;
    }
    Ok(())
}

/// The values git stores on one line. A line break would split the value in
/// `.git/config` and break the next read.
fn single_line_fields(p: &Profile) -> Vec<(&'static str, &str)> {
    let mut fields = vec![
        ("name", p.name.as_str()),
        ("userName", p.user_name.as_str()),
        ("userEmail", p.user_email.as_str()),
    ];
    if let Some(key) = p.signing_key.as_deref() {
        fields.push(("signingKey", key));
    }
    fields
}

fn require_text(field: &str, value: &str) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(AppError::Other(format!("profile {field} must not be empty")));
    }
    Ok(())
}

/// An email needs text on both sides of the `@`. Git accepts any string, so this
/// is the only guard against an empty half.
fn check_email(email: &str) -> AppResult<()> {
    match email.split_once('@') {
        Some((local, domain)) if !local.is_empty() && !domain.is_empty() => Ok(()),
        _ => Err(AppError::Other(format!(
            "profile userEmail must contain \"@\" with text on both sides, got {email:?}"
        ))),
    }
}

fn check_one_line(field: &str, value: &str) -> AppResult<()> {
    if value.contains(['\n', '\r']) {
        return Err(AppError::Other(format!("profile {field} must be one line, got {value:?}")));
    }
    Ok(())
}

/// Ids and labels (labels ignoring case) must be unique, and at most one profile
/// is the default.
fn check_unique(list: &[Profile]) -> AppResult<()> {
    let mut ids = HashSet::new();
    let mut labels = HashSet::new();
    for p in list {
        if !ids.insert(p.id.as_str()) {
            return Err(AppError::Other(format!("two profiles share the id {:?}", p.id)));
        }
        if !labels.insert(p.name.to_lowercase()) {
            return Err(AppError::Other(format!(
                "two profiles share the label {:?}; labels must be unique, ignoring case",
                p.name
            )));
        }
    }
    check_one_default(list)
}

fn check_one_default(list: &[Profile]) -> AppResult<()> {
    let defaults = list.iter().filter(|p| p.is_default).count();
    if defaults > 1 {
        return Err(AppError::Other(format!(
            "at most one profile can be the default, got {defaults}"
        )));
    }
    Ok(())
}

#[cfg(test)]
pub mod test_support {
    use super::*;

    pub fn profile(id: &str, name: &str) -> Profile {
        Profile {
            id: id.into(),
            name: name.into(),
            user_name: "Jane Doe".into(),
            user_email: "jane@work.example".into(),
            signing_key: None,
            gpg_format: None,
            is_default: false,
        }
    }

    pub fn work_profile() -> Profile {
        Profile {
            signing_key: Some("ABCD1234".into()),
            gpg_format: Some(GpgFormat::Ssh),
            ..profile("p1", "Work")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{profile, work_profile};
    use super::*;

    fn err_text(list: &[Profile]) -> String {
        validate_list(list).unwrap_err().to_string()
    }

    #[test]
    fn normalize_trims_text_and_drops_an_empty_signing_key() {
        let raw = Profile {
            user_name: "  Jane  ".into(),
            signing_key: Some("   ".into()),
            ..profile(" p1 ", " Work ")
        };
        let got = normalize(raw);
        assert_eq!(got.id, "p1");
        assert_eq!(got.name, "Work");
        assert_eq!(got.user_name, "Jane");
        assert_eq!(got.signing_key, None);
    }

    #[test]
    fn a_good_list_passes_validation() {
        assert!(validate_list(&[work_profile(), profile("p2", "Personal")]).is_ok());
    }

    #[test]
    fn an_empty_required_field_is_refused_by_name() {
        let blank_label = profile("p1", "  ");
        let blank_user = Profile { user_name: "".into(), ..profile("p1", "W") };
        for (field, bad) in [("name", blank_label), ("userName", blank_user)] {
            let msg = err_text(&[bad]);
            assert!(msg.contains(field), "{field} missing from {msg}");
        }
    }

    #[test]
    fn an_email_without_text_on_both_sides_names_the_value() {
        for email in ["jane", "@work.example", "jane@"] {
            let bad = Profile { user_email: email.into(), ..profile("p1", "W") };
            let msg = err_text(&[bad]);
            assert!(msg.contains(&format!("{email:?}")), "value {email} missing from {msg}");
        }
    }

    #[test]
    fn a_line_break_in_a_git_value_is_refused() {
        let bad = Profile { user_name: "Jane\nDoe".into(), ..profile("p1", "W") };
        assert!(err_text(&[bad]).contains("must be one line"));
    }

    #[test]
    fn labels_must_be_unique_ignoring_case() {
        let msg = err_text(&[profile("p1", "Work"), profile("p2", "WORK")]);
        assert!(msg.contains("share the label"));
    }

    #[test]
    fn ids_must_be_unique() {
        let msg = err_text(&[profile("same", "Work"), profile("same", "Home")]);
        assert!(msg.contains("share the id"));
    }

    #[test]
    fn at_most_one_profile_is_the_default() {
        let a = Profile { is_default: true, ..profile("p1", "Work") };
        let b = Profile { is_default: true, ..profile("p2", "Home") };
        assert!(err_text(&[a, b]).contains("got 2"));
    }

    #[test]
    fn an_unknown_gpg_format_fails_to_parse() {
        let raw = r#"{"id":"p1","name":"W","userName":"J","userEmail":"j@h","gpgFormat":"pgp"}"#;
        let msg = serde_json::from_str::<Profile>(raw).unwrap_err().to_string();
        assert!(msg.contains("openpgp") && msg.contains("ssh"), "expected values missing from {msg}");
    }

    #[test]
    fn gpg_format_maps_to_the_value_git_stores() {
        assert_eq!(GpgFormat::X509.as_git(), "x509");
        assert_eq!(GpgFormat::Openpgp.as_git(), "openpgp");
    }
}
