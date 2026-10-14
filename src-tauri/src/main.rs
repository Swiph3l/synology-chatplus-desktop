#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod build_metadata;
mod commands;
mod connection;
mod desktop_notifications;
mod diagnostics;
mod downloads;
mod i18n;
mod menu;
mod native_shortcuts;
mod navigation;
mod notification_bridge;
mod notification_presentation;
mod platform;
mod project;
mod providers;
mod services;
mod shell;
mod single_instance;
#[cfg(windows)]
mod startup_guard;
mod state;
mod tray;
mod unread;
mod updates;
mod validation_fixture;
#[cfg(test)]
mod version_format;
mod window;
use tauri::Manager;
fn main() {
    let context = tauri::generate_context!();
    #[cfg(windows)]
    let startup_guard = match startup_guard::acquire(&context.config().identifier) {
        Ok(guard) => guard,
        Err(message) => {
            eprintln!("[single-instance] {message}");
            std::process::exit(1);
        }
    };
    // Swiph3l: Reqwest with rustls-no-provider needs one global crypto backend before any client is built.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let builder = tauri::Builder::default()
        .manage(single_instance::Activation::default())
        // Swiph3l: ChatPlus Desktop must run as a single instance.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            single_instance::activate(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build());
    // Windows provider WebViews need the browser Notification API for the native
    // bridge; the plugin replaces it with a shell-only Tauri IPC polyfill.
    #[cfg(not(windows))]
    let builder = builder.plugin(tauri_plugin_notification::init());
    let app = builder
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name(state::AUTOSTART_ENTRY_NAME)
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
            commands::get_connection_state,
            commands::get_unread_state,
            commands::activate_service,
            commands::reorder_services,
            commands::open_settings,
            commands::show_service_context_menu,
            commands::take_service_settings_target,
            commands::remove_service,
            commands::close_settings,
            commands::get_providers,
            commands::get_validation_fixture_service_ids,
            commands::get_notification_permission,
            commands::open_notification_settings,
            commands::send_test_notification,
            commands::request_notification_permission,
            commands::get_status,
            commands::save_settings,
            commands::complete_onboarding,
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
            validation_fixture::initialize(&app.config().identifier);
            let settings = state::load(app.handle())?;
            app.manage(state::AppState(std::sync::Mutex::new(settings)));
            app.manage(state::Status::default());
            app.manage(connection::ConnectionState::default());
            app.manage(updates::Service::default());
            app.manage(unread::Service::default());
            app.manage(diagnostics::NotificationHistory::default());
            app.manage(services::Lifecycle::default());
            app.manage(desktop_notifications::Service::default());
            desktop_notifications::icons(app.handle());
            menu::create(app.handle())?;
            tray::create(app.handle())?;
            // Configured Windows startup always owns Main, even when Settings is requested.
            // Only a fresh profile keeps the provider picker until Skip/Continue.
            // A later EXE launch restores that existing Main without creating views.
            let settings_requested = std::env::args().any(|arg| arg == "--settings");
            if cfg!(windows) || !settings_requested {
                window::open(app.handle()).map_err(std::io::Error::other)?;
            }
            if settings_requested {
                shell::settings(app.handle())?;
            }
            updates::start(app.handle());
            single_instance::ready(app.handle());
            Ok(())
        })
        .build(context)
        .expect("Could not start ChatPlus Desktop");
    // The plugin IPC window is now registered; later processes can enter the
    // official forwarding/exit path without racing its mutex/window creation.
    #[cfg(windows)]
    drop(startup_guard);
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } = event
        {
            // Swiph3l: ChatPlus Desktop must run as a single instance.
            // Allow secondary single-instance launches to exit when no window exists.
            if !app.windows().is_empty() {
                api.prevent_exit();
            }
        }
    });
}
