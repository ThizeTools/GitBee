use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent, Wry};

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show GitBee", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    with_platform_icon(TrayIconBuilder::with_id("gkp-tray"), app)?
        .tooltip("GitBee")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// The menu bar is monochrome on macOS: a template image (alpha only) lets
/// the system tint it for light/dark bars and the highlighted state, which
/// the full-color app icon can't do. Drawn at 36 px = 18 pt @2x, the height
/// `tray-icon` scales menu-bar images to. See docs/specs/macos-support.md.
#[cfg(target_os = "macos")]
fn with_platform_icon(
    builder: TrayIconBuilder<Wry>,
    _app: &AppHandle,
) -> tauri::Result<TrayIconBuilder<Wry>> {
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-macos-template.png"))?;
    Ok(builder.icon(icon).icon_as_template(true))
}

// The Windows notification area shows color icons, so it keeps the app icon.
#[cfg(not(target_os = "macos"))]
fn with_platform_icon(
    builder: TrayIconBuilder<Wry>,
    app: &AppHandle,
) -> tauri::Result<TrayIconBuilder<Wry>> {
    Ok(builder.icon(app.default_window_icon().cloned().unwrap()))
}

pub fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
        set_dock_icon_visible(window.app_handle(), false);
    }
}

/// Brings the hidden main window back when the app is relaunched (Finder,
/// Spotlight, Dock). Closing only hides the window (see `handle_window_event`).
/// Usage: `builder.build(ctx)?.run(tray::handle_run_event)`.
#[cfg(target_os = "macos")]
pub fn handle_run_event(app: &AppHandle, event: RunEvent) {
    if let RunEvent::Reopen { .. } = event {
        show_main(app);
    }
}

// `RunEvent::Reopen` only exists on macOS; other platforms reopen via the tray.
#[cfg(not(target_os = "macos"))]
pub fn handle_run_event(_app: &AppHandle, _event: RunEvent) {}

/// Shows, unminimizes and focuses the `main` window, restoring the Dock icon
/// on macOS. Shared by the tray, Dock reopen and the single-instance hook.
/// Usage: `tray::show_main(app.handle())`.
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        set_dock_icon_visible(app, true);
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// While hidden, GitBee lives only in the menu bar: the Accessory policy
/// drops the Dock icon and the Cmd+Tab entry. `set_activation_policy` over
/// `set_dock_visibility` because the latter ignores a hide within 1 s of a
/// show (tao's multiple-Dock-icons workaround), so a quick open/close would
/// leave the icon behind.
#[cfg(target_os = "macos")]
fn set_dock_icon_visible(app: &AppHandle, visible: bool) {
    let policy = if visible {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    };
    let _ = app.set_activation_policy(policy);
}

// Windows has no Dock; hiding the window already removes its taskbar button.
#[cfg(not(target_os = "macos"))]
fn set_dock_icon_visible(_app: &AppHandle, _visible: bool) {}
