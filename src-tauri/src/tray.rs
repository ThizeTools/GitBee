use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show GitBee", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id("gkp-tray")
        .icon(app.default_window_icon().cloned().unwrap())
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

pub fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}

/// Brings the hidden main window back when the Dock icon is clicked.
/// Closing only hides the window (see `handle_window_event`), so without this
/// the app looks dead on macOS until the user finds the menu-bar icon.
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

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
