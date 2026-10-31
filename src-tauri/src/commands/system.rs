use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[tauri::command]
pub async fn open_terminal(path: String) -> AppResult<()> {
    let cwd = PathBuf::from(&path);
    if !cwd.is_dir() {
        return Err(AppError::InvalidRepoPath(path));
    }

    if cfg!(windows) {
        // 1) Windows Terminal launching PowerShell at the repo path.
        let wt = Command::new("wt.exe")
            .args([
                "-d", path.as_str(),
                "powershell.exe", "-NoLogo", "-NoExit",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        if wt.is_ok() { return Ok(()); }

        // 2) Standalone PowerShell window.
        let ps = Command::new("powershell.exe")
            .args(["-NoLogo", "-NoExit", "-Command", &format!("Set-Location -LiteralPath '{}'", path.replace('\'', "''"))])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        if ps.is_ok() { return Ok(()); }

        // 3) Final fallback: cmd.exe.
        Command::new("cmd.exe")
            .args(["/C", "start", "", "cmd.exe", "/K"])
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Terminal", path.as_str()])
            .spawn()?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for term in ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"] {
            if Command::new(term).current_dir(&cwd).spawn().is_ok() {
                return Ok(());
            }
        }
        return Err(AppError::Other("no supported terminal found".into()));
    }

    #[allow(unreachable_code)]
    Ok(())
}
