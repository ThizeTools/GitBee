pub mod cache;
pub mod commands;
pub mod error;
pub mod git;
pub mod github;
pub mod state;
pub mod tray;
pub mod watcher;

use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let app_state = AppState::init().expect("failed to initialize app state");

    tauri::Builder::default()
        // Must be the first plugin registered. When the user launches a
        // second instance (e.g. clicking the portable .exe again while the
        // app is hidden in the tray), this fires in the original process
        // and we focus the existing window instead of starting fresh.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            // Bring whatever window we have to the front. The label isn't
            // pinned in tauri.conf.json so iterate to be safe.
            for (_, w) in app.webview_windows() {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
                break;
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Auto-update — manifest + signed binaries served as GitHub
        // Release assets on github.com/ThizeTools/GitBee (the public project
        // repo). See docs/specs/auto-update.md for the publish workflow.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            tray::install(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| tray::handle_window_event(window, event))
        .manage(app_state)
        .manage(commands::terminal::TerminalRegistry::default())
        .manage(commands::github::OAuthRegistry::default())
        .invoke_handler(tauri::generate_handler![
            commands::repo::repo_open,
            commands::repo::repo_recent,
            commands::repo::repo_forget,
            commands::graph::graph_load,
            commands::branches::branch_create,
            commands::branches::branch_checkout,
            commands::branches::branch_delete,
            commands::branches::branch_rename,
            commands::branches::branch_merge,
            commands::branches::branch_rebase,
            commands::branches::checkout_sha,
            commands::branches::branch_set_upstream,
            commands::staging::status_load,
            commands::staging::stage_file,
            commands::staging::unstage_file,
            commands::staging::stage_files,
            commands::staging::unstage_files,
            commands::staging::stage_all,
            commands::staging::unstage_all,
            commands::staging::discard_file,
            commands::staging::discard_all_changes,
            commands::diff::diff_commit,
            commands::diff::diff_stash,
            commands::diff::diff_workdir,
            commands::diff::diff_index,
            commands::commits::commit_create,
            commands::commits::commit_show,
            commands::commits::commit_cherry_pick,
            commands::commits::commit_revert,
            commands::commits::commit_reset,
            commands::commits::commit_format_patch,
            commands::commits::patch_apply,
            commands::stash::stash_list,
            commands::stash::stash_create,
            commands::stash::stash_apply,
            commands::stash::stash_pop,
            commands::stash::stash_drop,
            commands::tags::tag_create,
            commands::tags::tag_delete,
            commands::tags::tag_push,
            commands::tags::tag_move,
            commands::tags::tag_annotate,
            commands::remotes::remote_list,
            commands::remotes::remote_add,
            commands::remotes::remote_remove,
            commands::remotes::remote_fetch,
            commands::remotes::remote_tags,
            commands::remotes::remote_pull,
            commands::remotes::remote_push,
            commands::merge::op_state,
            commands::merge::op_abort,
            commands::merge::op_continue,
            commands::merge::mark_resolved,
            commands::watcher_cmd::watcher_start,
            commands::watcher_cmd::watcher_stop,
            commands::system::open_terminal,
            commands::system::undo_last_commit,
            commands::worktrees::worktree_list,
            commands::worktrees::worktree_add,
            commands::worktrees::worktree_remove,
            commands::files::file_read,
            commands::files::file_read_at,
            commands::files::file_delete,
            commands::files::file_show_in_folder,
            commands::files::file_edit,
            commands::files::file_history,
            commands::files::file_blame,
            commands::files::ignore_add,
            commands::files::stash_file,
            commands::files::stash_edit_message,
            commands::repo_extra::repo_logs,
            commands::repo_extra::repo_clone,
            commands::repo_extra::repo_create,
            commands::terminal::terminal_spawn,
            commands::terminal::terminal_write,
            commands::terminal::terminal_kill,
            commands::github::github_status,
            commands::github::github_save_pat,
            commands::github::github_oauth_start,
            commands::github::github_oauth_await,
            commands::github::github_oauth_cancel,
            commands::github::github_logout,
            commands::github::github_list_repos,
            commands::github::github_clone,
            commands::github::avatar_for_email,
            commands::github::clone_last_dest,
            commands::github::clone_save_dest,
            commands::github::github_list_create_owners,
            commands::github::github_check_repo_name,
            commands::github::github_create_repo,
            commands::github::github_publish_local,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(tray::handle_run_event);
}
