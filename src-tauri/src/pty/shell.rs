//! Picks the shell an embedded terminal runs. The PATH lookup is a parameter,
//! so tests answer "is pwsh installed" without touching the disk.

use super::ShellProgram;

/// Used on Unix when $SHELL is unset or blank.
const UNIX_FALLBACK: &str = "/bin/bash";

/// Chooses the shell for a new session. Windows prefers PowerShell 7, then
/// Windows PowerShell, then cmd.exe. Elsewhere the shell follows $SHELL.
/// Example: choose_shell(true, None, &|n| n == "pwsh.exe").program == "pwsh.exe"
pub fn choose_shell(
    is_windows: bool,
    env_shell: Option<&str>,
    exists_on_path: &dyn Fn(&str) -> bool,
) -> ShellProgram {
    if is_windows {
        return windows_shell(exists_on_path);
    }
    let program = env_shell
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(UNIX_FALLBACK);
    ShellProgram { program: program.to_string(), args: Vec::new() }
}

fn windows_shell(exists_on_path: &dyn Fn(&str) -> bool) -> ShellProgram {
    if exists_on_path("pwsh.exe") {
        return powershell("pwsh.exe");
    }
    if exists_on_path("powershell.exe") {
        return powershell("powershell.exe");
    }
    ShellProgram { program: "cmd.exe".to_string(), args: Vec::new() }
}

fn powershell(program: &str) -> ShellProgram {
    // -NoLogo drops the copyright banner so the first screen is the prompt.
    ShellProgram { program: program.to_string(), args: vec!["-NoLogo".to_string()] }
}

/// True when `name` is an existing file in one of the PATH directories.
/// Example: is_on_path("cmd.exe") is true on any Windows install.
pub fn is_on_path(name: &str) -> bool {
    let Some(paths) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&paths).any(|dir| dir.join(name).is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fake PATH lookup: only the named programs exist.
    fn installed(names: &'static [&'static str]) -> impl Fn(&str) -> bool {
        move |name: &str| names.contains(&name)
    }

    #[test]
    fn windows_prefers_pwsh_when_present() {
        let shell = choose_shell(true, None, &installed(&["pwsh.exe", "powershell.exe"]));
        assert_eq!(shell.program, "pwsh.exe");
        assert_eq!(shell.args, vec!["-NoLogo".to_string()]);
    }

    #[test]
    fn windows_falls_back_to_windows_powershell() {
        let shell = choose_shell(true, None, &installed(&["powershell.exe"]));
        assert_eq!(shell.program, "powershell.exe");
    }

    #[test]
    fn windows_falls_back_to_cmd_without_powershell() {
        let shell = choose_shell(true, Some("/bin/zsh"), &installed(&[]));
        assert_eq!(shell.program, "cmd.exe");
        assert!(shell.args.is_empty());
    }

    #[test]
    fn unix_uses_shell_from_environment() {
        let shell = choose_shell(false, Some("/usr/bin/fish"), &installed(&[]));
        assert_eq!(shell.program, "/usr/bin/fish");
        assert!(shell.args.is_empty());
    }

    #[test]
    fn unix_falls_back_to_bash_when_shell_is_blank() {
        let shell = choose_shell(false, Some("   "), &installed(&[]));
        assert_eq!(shell.program, "/bin/bash");
    }

    #[test]
    fn unix_falls_back_to_bash_when_shell_is_unset() {
        let shell = choose_shell(false, None, &installed(&["pwsh.exe"]));
        assert_eq!(shell.program, "/bin/bash");
    }
}
