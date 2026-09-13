use crate::{
    diagnostics, navigation, project, shell,
    state::{self, Settings},
    updates, window,
};
use tauri::Manager;
use tauri_plugin_clipboard_manager::ClipboardExt;

fn local(window: &tauri::WebviewWindow, labels: &[&str]) -> Result<(), String> {
    if !labels.contains(&window.label())
        || !navigation::local_settings(&window.url().map_err(|_| "Not permitted.")?)
    {
        return Err("Not permitted.".into());
    }
    Ok(())
}
#[tauri::command]
pub fn get_notification_permission(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<crate::desktop_notifications::Permission, String> {
    local(&window, &["settings"])?;
    Ok(crate::desktop_notifications::permission(&app))
}
#[tauri::command]
pub fn request_notification_permission(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<crate::desktop_notifications::Permission, String> {
    local(&window, &["settings"])?;
    crate::desktop_notifications::request_permission(&app)
}
#[tauri::command]
pub fn get_settings(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Settings, String> {
    local(&window, &["settings"])?;
    Ok(state::current(&app))
}
#[tauri::command]
pub fn get_status(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    local(&window, &["settings"])?;
    Ok(app
        .state::<state::Status>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take())
}
#[tauri::command]
pub async fn save_settings(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    mut settings: Settings,
) -> Result<(), String> {
    local(&window, &["settings"])?;
    settings.server_url = state::normalize_server(&settings.server_url)?;
    let old = state::current(&app);
    state::persist(&app, settings.clone())?;
    if old.server_url != settings.server_url || old.theme != settings.theme {
        window::reopen(&app)?;
    }
    window::open(&app)?;
    window::apply_theme(&app)?;
    // Keep setup available on validation, persistence or window-opening failure.
    // Close it only after the configured main window has opened successfully.
    window
        .destroy()
        .map_err(|_| "Settings saved, but the settings window could not close.".into())
}
#[tauri::command]
pub fn get_about_info(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<diagnostics::AboutInfo, String> {
    local(&window, &["about"])?;
    Ok(diagnostics::snapshot(&app))
}
#[tauri::command]
pub fn copy_diagnostics(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    local(&window, &["about"])?;
    app.clipboard()
        .write_text(diagnostics::format(&diagnostics::snapshot(&app)))
        .map_err(|_| "Could not copy diagnostics to the clipboard.".into())
}
#[tauri::command]
pub async fn show_about(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    local(&window, &["settings", "about"])?;
    shell::about(&app).map_err(|_| "Could not open About.".into())
}
#[tauri::command]
pub fn show_license(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    local(&window, &["about"])?;
    shell::license(&app).map_err(|_| "Could not open the license.".into())
}
#[tauri::command]
pub fn open_project_link(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    link: project::Link,
) -> Result<(), String> {
    local(&window, &["settings", "about"])?;
    project::open(&app, link)
}
#[tauri::command]
pub async fn check_for_updates(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<updates::Snapshot, String> {
    local(&window, &["settings", "about", "update"])?;
    shell::update(&app).map_err(|_| "Could not open update status.")?;
    updates::check(&app, true).await
}
#[tauri::command]
pub fn get_current_version(window: tauri::WebviewWindow) -> Result<String, String> {
    local(&window, &["settings", "about"])?;
    Ok(env!("CARGO_PKG_VERSION").into())
}
#[tauri::command]
pub fn get_latest_version(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    local(&window, &["settings", "about", "update"])?;
    Ok(updates::snapshot(&app).latest_version)
}
#[tauri::command]
pub fn open_release_page(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<(), String> {
    local(&window, &["settings", "about", "update"])?;
    updates::open_release_page(&app)
}
#[tauri::command]
pub fn get_update_state(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<updates::Snapshot, String> {
    local(&window, &["settings", "about", "update"])?;
    Ok(updates::snapshot(&app))
}
#[tauri::command]
pub async fn download_update(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<(), String> {
    local(&window, &["update"])?;
    updates::download(&app).await
}
#[tauri::command]
pub fn cancel_update(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    local(&window, &["update"])?;
    updates::cancel(&app);
    Ok(())
}
#[tauri::command]
pub fn install_update(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    confirmed: bool,
) -> Result<(), String> {
    local(&window, &["update"])?;
    updates::install(&app, confirmed)
}
#[tauri::command]
pub async fn download_and_install(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    confirmed: bool,
) -> Result<(), String> {
    local(&window, &["update"])?;
    if !confirmed {
        return Err("Confirm restart before installing.".into());
    }
    updates::download(&app).await?;
    updates::install(&app, true)
}
#[tauri::command]
pub fn dismiss_update(window: tauri::WebviewWindow) -> Result<(), String> {
    local(&window, &["update"])?;
    window
        .close()
        .map_err(|_| "Could not close update window.".into())
}
#[tauri::command]
pub fn get_shell_theme(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<state::Theme, String> {
    let mut labels = vec!["settings", "about", "license", "update"];
    if cfg!(debug_assertions) {
        labels.push("fixture");
    }
    local(&window, &labels)?;
    Ok(state::current(&app).theme)
}
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn developer_action(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    action: String,
) -> Result<(), String> {
    local(&window, &["settings", "fixture"])?;
    let action = crate::menu::Action::parse(&action).ok_or("Unknown menu action.")?;
    crate::menu::dispatch(&app, action)
}
