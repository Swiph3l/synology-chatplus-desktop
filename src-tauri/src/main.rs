#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod build_metadata;
mod commands;
mod connection;
mod desktop_notifications;
mod diagnostics;
mod menu;
mod navigation;
mod platform;
mod project;
mod shell;
mod state;
mod tray;
mod unread;
mod updates;
#[cfg(test)]
mod version_format;
mod window;
use tauri::Manager;
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("ChatPlus Desktop")
                .build(),
        )
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filter(|label| label == "main")
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::get_notification_permission,
            commands::request_notification_permission,
            commands::get_status,
            commands::save_settings,
            commands::get_about_info,
            commands::copy_diagnostics,
            commands::show_about,
            commands::show_license,
            commands::open_project_link,
            commands::check_for_updates,
            commands::get_current_version,
            commands::get_latest_version,
            commands::get_update_state,
            commands::download_update,
            commands::cancel_update,
            commands::install_update,
            commands::download_and_install,
            commands::dismiss_update,
            commands::open_release_page,
            commands::get_shell_theme,
            #[cfg(debug_assertions)]
            commands::developer_action
        ])
        .setup(|app| {
            let settings = state::load(app.handle())?;
            app.manage(state::AppState(std::sync::Mutex::new(settings)));
            app.manage(state::Status::default());
            app.manage(connection::ConnectionState::default());
            app.manage(updates::Service::default());
            app.manage(unread::Service::default());
            app.manage(desktop_notifications::Service::default());
            desktop_notifications::icons(app.handle());
            menu::create(app.handle())?;
            tray::create(app.handle())?;
            if std::env::args().any(|arg| arg == "--settings") {
                shell::settings(app.handle())?;
            } else {
                window::open(app.handle()).map_err(std::io::Error::other)?;
            }
            updates::start(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Could not start ChatPlus Desktop")
        .run(|_, event| {
            if let tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } = event
            {
                api.prevent_exit();
            }
        });
}
