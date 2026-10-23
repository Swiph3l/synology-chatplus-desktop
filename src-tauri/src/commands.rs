use crate::{
    diagnostics, navigation, project, shell,
    state::{self, Settings},
    updates, window,
};
use tauri::Manager;
use tauri_plugin_clipboard_manager::ClipboardExt;

fn local(window: &tauri::WebviewWindow, labels: &[&str]) -> Result<(), String> {
    local_view(window.as_ref(), labels)
}
fn local_view(view: &tauri::Webview, labels: &[&str]) -> Result<(), String> {
    if !labels.contains(&view.label())
        || !navigation::local_settings(&view.url().map_err(|_| "Not permitted.")?)
    {
        return Err("Not permitted.".into());
    }
    Ok(())
}

struct PermissionProbe {
    service: crate::providers::ServiceConfig,
    bridge: Option<(u64, bool)>,
}

fn permission_target(
    settings: &Settings,
    id: Option<&str>,
) -> Option<crate::providers::ServiceConfig> {
    let id = id.or(settings.active_service.as_deref())?;
    settings
        .services
        .iter()
        .find(|service| service.enabled && service.id == id)
        .cloned()
}

fn permission_bridge(app: &tauri::AppHandle, id: &str) -> Option<(u64, bool)> {
    app.state::<crate::desktop_notifications::Service>()
        .0
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .bridges
        .get(id)
        .copied()
}

fn capture_permission_probe(app: &tauri::AppHandle, id: Option<&str>) -> Option<PermissionProbe> {
    let service = permission_target(&state::current(app), id)?;
    let bridge = permission_bridge(app, &service.id);
    Some(PermissionProbe { service, bridge })
}

fn permission_probe_valid(
    settings: &Settings,
    probe: &PermissionProbe,
    bridge: Option<(u64, bool)>,
) -> bool {
    bridge == probe.bridge
        && permission_target(settings, Some(&probe.service.id)).is_some_and(|current| {
            current.provider == probe.service.provider && current.url == probe.service.url
        })
}

fn browser_permission(value: &str) -> (&'static str, diagnostics::NotificationReason) {
    use diagnostics::NotificationReason as Reason;
    match value {
        "granted" => ("granted", Reason::BrowserPermissionGranted),
        "default" => ("default", Reason::BrowserPermissionDefault),
        "denied" => ("denied", Reason::BrowserPermissionDenied),
        _ => ("unavailable", Reason::BrowserPermissionUnavailable),
    }
}

async fn query_permission_probe(
    app: &tauri::AppHandle,
    probe: Option<PermissionProbe>,
    mut result: crate::desktop_notifications::Permission,
) -> crate::desktop_notifications::Permission {
    result.webview_state = "unavailable".into();
    result.bridge_available = false;
    let Some(probe) = probe else {
        return result;
    };
    if !permission_probe_valid(
        &state::current(app),
        &probe,
        permission_bridge(app, &probe.service.id),
    ) {
        return result;
    }
    let value = crate::notification_bridge::permission_state_for(app, &probe.service.id).await;
    // Swiph3l: Never attribute a delayed browser answer to a replacement profile
    // or to the service selected while the original script was pending.
    if !permission_probe_valid(
        &state::current(app),
        &probe,
        permission_bridge(app, &probe.service.id),
    ) {
        return result;
    }
    let (value, reason) = browser_permission(&value);
    result.webview_state = value.into();
    result.bridge_available = probe.bridge.is_some_and(|(_, available)| available);
    diagnostics::notification(
        app,
        &probe.service.id,
        diagnostics::NotificationEvent::PermissionChecked,
        reason,
        0,
    );
    if result.granted && value == "denied" {
        diagnostics::notification(
            app,
            &probe.service.id,
            diagnostics::NotificationEvent::PermissionChecked,
            diagnostics::NotificationReason::FrontendPermissionMismatch,
            0,
        );
    }
    result
}
#[tauri::command]
pub fn get_external_link_prompt(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<crate::external_links::PromptPayload, String> {
    local(&window, &["external-link"])?;
    crate::external_links::prompt(&app)
}
#[tauri::command]
pub fn external_link_prompt_ready(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    request_id: String,
) -> Result<(), String> {
    local(&window, &["external-link"])?;
    crate::external_links::ready(&app, &request_id)
}
#[tauri::command]
pub fn respond_external_link_prompt(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    request_id: String,
    accepted: bool,
) -> Result<(), String> {
    local(&window, &["external-link"])?;
    crate::external_links::respond(&app, &request_id, accepted)
}
#[tauri::command]
pub async fn get_notification_permission(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    service_id: Option<String>,
) -> Result<crate::desktop_notifications::Permission, String> {
    local(&window, &["settings"])?;
    let probe = capture_permission_probe(&app, service_id.as_deref());
    let result = crate::desktop_notifications::permission(&app);
    Ok(query_permission_probe(&app, probe, result).await)
}
#[tauri::command]
pub fn open_notification_settings(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<(), String> {
    local(&window, &["settings"])?;
    #[cfg(windows)]
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_url("ms-settings:notifications", None::<&str>)
            .map_err(|_| "Could not open Windows notification settings.".into())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("Open notification settings in your operating system.".into())
    }
}
#[tauri::command]
pub async fn request_notification_permission(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    service_id: Option<String>,
) -> Result<crate::desktop_notifications::Permission, String> {
    local(&window, &["settings"])?;
    let probe = capture_permission_probe(&app, service_id.as_deref());
    let result = crate::desktop_notifications::request_permission(&app)?;
    if result.granted {
        if let Some(probe) = &probe {
            if permission_probe_valid(
                &state::current(&app),
                probe,
                permission_bridge(&app, &probe.service.id),
            ) {
                crate::notification_bridge::enable_permission_captured(
                    &app,
                    probe.service.clone(),
                    probe.bridge,
                )
                .await?;
            }
        }
    }
    Ok(query_permission_probe(&app, probe, result).await)
}
#[tauri::command]
pub fn send_test_notification(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    sound: bool,
) -> Result<(), String> {
    local(&window, &["settings"])?;
    crate::desktop_notifications::send_test(&app, sound)
}
#[tauri::command]
pub fn get_settings(window: tauri::Webview, app: tauri::AppHandle) -> Result<Settings, String> {
    local_view(&window, &["settings", "main", "about", "license", "update"])?;
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
    settings: Settings,
) -> Result<(), String> {
    local(&window, &["settings"])?;
    crate::services::save(&app, settings)?;
    window::apply_theme(&app)
        .map_err(|error| format!("Settings saved. Restart to apply the theme. {error}"))?;
    // Swiph3l: Keep Settings visible after Save so users can continue editing multiple options.
    window::focus(&window.as_ref().window())
        .map_err(|_| "Settings saved, but Settings could not be focused.".into())
}
#[tauri::command]
pub async fn complete_onboarding(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Settings, String> {
    local(&window, &["settings"])?;
    crate::services::complete_onboarding(&app)?;
    window::open(&app)?;
    window.close().map_err(|_| "Could not close Settings.")?;
    Ok(state::current(&app))
}
#[tauri::command]
pub fn get_about_info(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<diagnostics::AboutInfo, String> {
    local(&window, &["about", "settings"])?;
    Ok(diagnostics::snapshot(&app))
}
#[tauri::command]
pub fn copy_diagnostics(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    local(&window, &["about", "settings"])?;
    app.clipboard()
        .write_text(diagnostics::report(&app))
        .map_err(|_| "Could not copy diagnostics to the clipboard.".into())
}
#[tauri::command]
pub async fn show_about(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    local(&window, &["settings", "about"])?;
    shell::about(&app).map_err(|_| "Could not open About.".into())
}
#[tauri::command]
pub fn show_license(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    local(&window, &["about", "settings"])?;
    shell::license(&app).map_err(|_| "Could not open the license.".into())
}
#[tauri::command]
pub fn open_project_link(
    window: tauri::Webview,
    app: tauri::AppHandle,
    link: project::Link,
) -> Result<(), String> {
    local_view(&window, &["settings", "about", "main"])?;
    project::open(&app, link)
}
#[tauri::command]
pub async fn check_for_updates(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<updates::Snapshot, String> {
    local(&window, &["settings", "about", "update"])?;
    updates::check(&app, true).await
}
#[tauri::command]
pub fn get_current_version(window: tauri::Webview) -> Result<String, String> {
    local_view(&window, &["settings", "about", "main", "update"])?;
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
    window: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<updates::Snapshot, String> {
    local_view(&window, &["settings", "about", "update", "main"])?;
    Ok(updates::snapshot(&app))
}
#[tauri::command]
pub async fn download_update(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<(), String> {
    local(&window, &["update", "settings"])?;
    updates::download(&app).await
}
#[tauri::command]
pub fn cancel_update(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    local(&window, &["update", "settings"])?;
    updates::cancel(&app);
    Ok(())
}
#[tauri::command]
pub fn install_update(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    confirmed: bool,
    expected_version: String,
    expected_include_beta_updates: bool,
) -> Result<(), String> {
    local(&window, &["update", "settings"])?;
    updates::install_for(
        &app,
        confirmed,
        &expected_version,
        expected_include_beta_updates,
    )
}
#[tauri::command]
pub async fn download_and_install(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    confirmed: bool,
    expected_version: String,
    expected_include_beta_updates: bool,
) -> Result<(), String> {
    local(&window, &["update", "settings"])?;
    if !confirmed {
        return Err("Confirm restart before installing.".into());
    }
    let selected = updates::snapshot(&app);
    if selected.latest_version.as_deref() != Some(expected_version.as_str())
        || selected.include_beta_updates != expected_include_beta_updates
    {
        return Err("The update changed after confirmation. Review it and confirm again.".into());
    }
    updates::download(&app).await?;
    updates::install_for(&app, true, &expected_version, expected_include_beta_updates)
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
    window: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<state::Theme, String> {
    let mut labels = vec!["main", "settings", "about", "license", "update"];
    if cfg!(debug_assertions) {
        labels.push("fixture");
    }
    local_view(&window, &labels)?;
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

#[tauri::command]
pub async fn activate_service(
    window: tauri::Webview,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    local_view(&window, &["main"])?;
    crate::services::activate(&app, &id)
}
#[tauri::command]
pub async fn reorder_services(
    window: tauri::Webview,
    app: tauri::AppHandle,
    ids: Vec<String>,
) -> Result<Settings, String> {
    local_view(&window, &["main"])?;
    // Swiph3l: A service worker can own the transition lock while waiting on
    // WebView UI work. Drag reordering must never wait for that lock on the UI.
    crate::services::reorder(&app, &ids)
}
#[tauri::command]
pub async fn open_settings(
    window: tauri::Webview,
    app: tauri::AppHandle,
    section: Option<String>,
) -> Result<(), String> {
    local_view(&window, &["main"])?;
    shell::settings_section(&app, section.as_deref().unwrap_or("general"))
        .map_err(|_| "Could not open Settings.".into())
}

#[tauri::command]
pub fn get_connection_state(
    window: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<crate::connection::Connection, String> {
    local_view(&window, &["main", "settings", "about"])?;
    Ok(crate::connection::current(&app))
}

#[tauri::command]
pub fn get_unread_state(
    window: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<crate::unread::Snapshot, String> {
    local_view(&window, &["main"])?;
    Ok(crate::unread::snapshot(&app))
}

#[tauri::command]
pub async fn show_service_context_menu(
    window: tauri::Webview,
    app: tauri::AppHandle,
    id: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    local_view(&window, &["main"])?;
    crate::menu::service_popup(&app, &id, x, y)
}

#[tauri::command]
pub fn take_service_settings_target(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Option<crate::menu::ServiceSettingsTarget>, String> {
    local(&window, &["settings"])?;
    Ok(crate::menu::take_service_settings_target(&app))
}

#[tauri::command]
pub async fn remove_service(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
    confirmed: bool,
) -> Result<(), String> {
    local(&window, &["settings"])?;
    if !confirmed {
        return Err("Confirm service removal first.".into());
    }
    crate::services::remove(&app, &id)?;
    window::focus(&window.as_ref().window())
        .map_err(|_| "Service removed, but Settings could not be focused.".into())
}

#[tauri::command]
pub async fn close_settings(window: tauri::WebviewWindow) -> Result<(), String> {
    local(&window, &["settings"])?;
    window
        .close()
        .map_err(|_| "Could not close Settings.".into())
}

#[tauri::command]
pub fn get_validation_fixture_service_ids(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    local(&window, &["settings"])?;
    Ok(crate::state::current(&app)
        .services
        .into_iter()
        .filter(crate::validation_fixture::mattermost)
        .map(|service| service.id)
        .collect())
}

#[tauri::command]
pub fn get_providers(
    window: tauri::Webview,
) -> Result<Vec<crate::providers::ProviderDefinition>, String> {
    local_view(&window, &["settings", "main"])?;
    use crate::providers::ProviderId;
    Ok([
        ProviderId::SynologyChatplus,
        ProviderId::SynologyChat,
        ProviderId::Slack,
        ProviderId::Discord,
        ProviderId::Mattermost,
        ProviderId::Whatsapp,
        ProviderId::Messenger,
    ]
    .into_iter()
    .map(|id| id.definition())
    .collect())
}

#[cfg(test)]
mod permission_tests {
    use super::*;
    use crate::providers::{NotificationColor, ProviderId, ServiceConfig};

    fn fixture() -> Settings {
        Settings {
            active_service: Some("first".into()),
            services: ["first", "second"]
                .into_iter()
                .map(|id| ServiceConfig {
                    id: id.into(),
                    provider: ProviderId::Discord,
                    name: "Private fixture name".into(),
                    url: "https://discord.com/app/".into(),
                    enabled: true,
                    notifications: false,
                    notification_color: NotificationColor::Auto,
                })
                .collect(),
            ..Settings::default()
        }
    }

    #[test]
    fn explicit_permission_target_does_not_follow_active_selection() {
        let mut settings = fixture();
        assert_eq!(permission_target(&settings, None).unwrap().id, "first");
        let probe = PermissionProbe {
            service: permission_target(&settings, Some("second")).unwrap(),
            bridge: Some((7, true)),
        };
        assert!(permission_probe_valid(&settings, &probe, Some((7, true))));
        settings.active_service = Some("second".into());
        settings.services[1].name = "Renamed fixture".into();
        settings.services[1].notifications = true;
        assert!(permission_probe_valid(&settings, &probe, Some((7, true))));
        assert!(permission_target(&settings, Some("missing")).is_none());
    }

    #[test]
    fn permission_probe_rejects_replaced_removed_disabled_or_restarted_service() {
        let settings = fixture();
        let probe = PermissionProbe {
            service: settings.services[0].clone(),
            bridge: Some((7, true)),
        };
        for bridge in [None, Some((8, true)), Some((7, false))] {
            assert!(!permission_probe_valid(&settings, &probe, bridge));
        }
        for change in 0..4 {
            let mut current = fixture();
            match change {
                0 => current.services[0].url = "https://discord.com/channels/@me/".into(),
                1 => current.services[0].provider = ProviderId::Whatsapp,
                2 => current.services[0].enabled = false,
                _ => {
                    current.services.remove(0);
                }
            }
            assert!(!permission_probe_valid(&current, &probe, Some((7, true))));
        }
    }

    #[test]
    fn permission_outcomes_are_closed_metadata_and_unknown_values_are_unavailable() {
        for (input, expected, reason) in [
            ("granted", "granted", "browser_permission_granted"),
            ("default", "default", "browser_permission_default"),
            ("denied", "denied", "browser_permission_denied"),
            (
                "unavailable",
                "unavailable",
                "browser_permission_unavailable",
            ),
            ("unknown", "unavailable", "browser_permission_unavailable"),
            (
                "private arbitrary script result",
                "unavailable",
                "browser_permission_unavailable",
            ),
        ] {
            let (value, code) = browser_permission(input);
            assert_eq!(value, expected);
            assert_eq!(serde_json::to_value(code).unwrap(), reason);
        }
    }
}
