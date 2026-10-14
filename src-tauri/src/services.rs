//! Native service sessions live behind a local rail; provider pages have no Tauri capability.
use crate::{providers::ServiceConfig, state};
use tauri::{AppHandle, Emitter, Manager, Webview, WebviewBuilder, WebviewUrl};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct Lifecycle(std::sync::Mutex<()>);

const RAIL_WIDTH: f64 = 56.;
// Swiph3l: Native provider WebViews cover the shell, so this must match the 30px CSS footer height.
const FOOTER_HEIGHT: f64 = 30.;

fn service_size(width: f64, height: f64) -> tauri::LogicalSize<f64> {
    tauri::LogicalSize::new(
        (width - RAIL_WIDTH).max(1.),
        (height - FOOTER_HEIGHT).max(1.),
    )
}

pub struct ServiceSession {
    pub config: ServiceConfig,
    pub webview_label: String,
}
impl ServiceSession {
    fn new(config: &ServiceConfig) -> Self {
        Self {
            config: config.clone(),
            webview_label: label(&config.id),
        }
    }
}

pub fn label(id: &str) -> String {
    format!("service-{id}")
}
pub fn active(app: &AppHandle) -> Option<Webview> {
    state::current(app)
        .active()
        .and_then(|s| app.get_webview(&label(&s.id)))
}
pub fn configured(app: &AppHandle, service: &ServiceConfig) -> bool {
    state::current(app).services.iter().any(|s| {
        s.id == service.id && s.provider == service.provider && s.url == service.url && s.enabled
    })
}
pub fn external(app: &AppHandle, url: &url::Url) {
    if state::current(app).external_links
        && matches!(url.scheme(), "https" | "http")
        && url.username().is_empty()
        && url.password().is_none()
    {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}
pub fn layout(app: &AppHandle) {
    let Some(window) = app.get_window("main") else {
        return;
    };
    let Ok(size) = window.inner_size() else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;
    if let Some(rail) = app.get_webview("main") {
        let _ = rail.set_size(tauri::LogicalSize::new(width, height));
    }
    for service in state::current(app).services {
        if let Some(view) = app.get_webview(&label(&service.id)) {
            let _ = view.set_position(tauri::LogicalPosition::new(RAIL_WIDTH, 0.));
            let _ = view.set_size(service_size(width, height));
        }
    }
}
pub fn show(app: &AppHandle) -> Result<(), String> {
    let settings = state::current(app);
    let Some(service) = settings.active().cloned() else {
        // A skipped setup or an empty existing profile owns a normal workspace.
        layout(app);
        let _ = app.emit_to("main", "services-changed", &settings);
        crate::unread::refresh(app);
        crate::connection::refresh(app);
        return Ok(());
    };
    let session_label = label(&service.id);
    if app.get_webview(&session_label).is_none() {
        create(app, &service)?;
    }
    for configured in &settings.services {
        if let Some(view) = app.get_webview(&label(&configured.id)) {
            if configured.id == service.id {
                view.show()
            } else {
                view.hide()
            }
            .map_err(|_| "Could not switch service.")?;
        }
    }
    layout(app);
    crate::unread::sync_presentation(app);
    let _ = app.emit_to("main", "services-changed", &settings);
    crate::unread::refresh(app);
    crate::connection::refresh(app);
    // Swiph3l: Switching services preserves provider unread; focus alone is never a read acknowledgement.
    active(app)
        .ok_or("Service unavailable.")?
        .set_focus()
        .map_err(|_| "Could not focus service.".into())
}
pub fn activate(app: &AppHandle, id: &str) -> Result<(), String> {
    let lifecycle = app.state::<Lifecycle>();
    let _transition = lifecycle.0.lock().unwrap_or_else(|e| e.into_inner());
    let mut settings = state::current(app);
    if !settings.services.iter().any(|s| s.id == id && s.enabled) {
        return Err("Choose an enabled configured service.".into());
    }
    settings.active_service = Some(id.into());
    state::persist(app, settings)?;
    show(app)
}

fn reorder_configuration(settings: &mut state::Settings, ids: &[String]) -> Result<bool, String> {
    let enabled: Vec<_> = settings
        .services
        .iter()
        .filter(|service| service.enabled)
        .collect();
    let unique: std::collections::HashSet<_> = ids.iter().map(String::as_str).collect();
    if ids.len() != enabled.len()
        || unique.len() != ids.len()
        || enabled
            .iter()
            .any(|service| !unique.contains(service.id.as_str()))
    {
        return Err("Services changed. Try ordering them again.".into());
    }
    if enabled
        .iter()
        .zip(ids)
        .all(|(service, id)| service.id == *id)
    {
        return Ok(false);
    }
    let reordered: Vec<ServiceConfig> = ids
        .iter()
        .map(|id| (**enabled.iter().find(|service| service.id == *id).unwrap()).clone())
        .collect();
    // Disabled services retain their full-list slots; the rail orders enabled entries only.
    let mut reordered = reordered.into_iter();
    for service in settings
        .services
        .iter_mut()
        .filter(|service| service.enabled)
    {
        *service = reordered.next().unwrap();
    }
    Ok(true)
}

pub fn reorder(app: &AppHandle, ids: &[String]) -> Result<state::Settings, String> {
    let lifecycle = app.state::<Lifecycle>();
    let _transition = lifecycle
        .0
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    // Apply only order to the authoritative state, preserving current preferences and session IDs.
    let mut settings = state::current(app);
    if reorder_configuration(&mut settings, ids)? {
        state::persist(app, settings)?;
    }
    // Persistence broadcasts Settings and rail snapshots without recreating/focusing provider views.
    Ok(state::current(app))
}
pub fn save(app: &AppHandle, settings: state::Settings) -> Result<(), String> {
    let lifecycle = app.state::<Lifecycle>();
    let _transition = lifecycle.0.lock().unwrap_or_else(|e| e.into_inner());
    // Swiph3l: Persist and reconcile under one lock so removal cannot race service activation or mute.
    let old = state::current(app);
    state::persist(app, settings)?;
    reconcile_current(app, &old).map_err(|error| {
        if error.starts_with("Settings saved.") {
            error
        } else {
            format!("Settings saved. Restart to apply service changes. {error}")
        }
    })
}

pub fn complete_onboarding(app: &AppHandle) -> Result<state::Settings, String> {
    let lifecycle = app.state::<Lifecycle>();
    let _transition = lifecycle.0.lock().unwrap_or_else(|e| e.into_inner());
    let mut settings = state::current(app);
    if !settings.onboarding_completed {
        settings.onboarding_completed = true;
        state::persist(app, settings)?;
    }
    Ok(state::current(app))
}

pub(crate) fn update_notification_config(
    settings: &mut state::Settings,
    id: &str,
    enabled: bool,
) -> Result<(), String> {
    let service = settings
        .services
        .iter_mut()
        .find(|service| service.id == id && service.enabled)
        .ok_or("Choose an enabled configured service.")?;
    if !service.supports_notifications() {
        return Err("Desktop notifications are not supported for this provider.".into());
    }
    service.notifications = enabled;
    Ok(())
}
pub fn set_notifications(app: &AppHandle, id: &str, enabled: bool) -> Result<(), String> {
    let lifecycle = app.state::<Lifecycle>();
    let _transition = lifecycle.0.lock().unwrap_or_else(|e| e.into_inner());
    // Swiph3l: Read under the transition lock so a stale menu cannot resurrect a removed service.
    let mut settings = state::current(app);
    update_notification_config(&mut settings, id, enabled)?;
    state::persist(app, settings)
}

fn remove_configuration(settings: &mut state::Settings, id: &str) -> Result<(), String> {
    let index = settings
        .services
        .iter()
        .position(|service| service.id == id)
        .ok_or("Service is no longer configured.")?;
    settings.services.remove(index);
    // Swiph3l: Mark the schema migrated before removing the last service or legacy settings recreate it.
    settings.service_schema = 1;
    settings.migrate_services()?;
    Ok(())
}

#[cfg(test)]
mod removal_tests {
    use super::*;
    use crate::providers::ProviderId;
    fn settings() -> state::Settings {
        let mut settings = state::Settings {
            service_schema: 1,
            active_service: Some("first".into()),
            services: ["first", "second"]
                .into_iter()
                .map(|id| ServiceConfig {
                    id: id.into(),
                    provider: ProviderId::SynologyChatplus,
                    name: id.into(),
                    url: "https://example.com/chat/".into(),
                    enabled: true,
                    notifications: true,
                    notification_color: crate::providers::NotificationColor::Auto,
                })
                .collect(),
            ..Default::default()
        };
        settings.migrate_services().unwrap();
        settings
    }
    #[test]
    fn first_service_and_add_another_wait_for_continue_while_skip_opens_an_empty_workspace() {
        use std::cell::RefCell;
        let events = RefCell::new(Vec::new());
        let reconcile = |settings: &state::Settings, main_exists| {
            reconcile_workspace(
                settings,
                main_exists,
                || {
                    events.borrow_mut().push("open-main");
                    Ok(())
                },
                || {
                    events.borrow_mut().push("show-services");
                    Ok(())
                },
            )
            .unwrap();
        };
        let mut onboarding = state::Settings::default();
        for service in settings().services {
            onboarding.services.push(service);
            onboarding.migrate_services().unwrap();
            reconcile(&onboarding, false);
            assert!(
                events.borrow().is_empty(),
                "saving a service must leave Add another/Continue visible"
            );
        }
        onboarding.onboarding_completed = true;
        reconcile(&onboarding, false);
        assert_eq!(*events.borrow(), ["open-main", "show-services"]);
        events.borrow_mut().clear();
        onboarding.services.clear();
        onboarding.migrate_services().unwrap();
        reconcile(&onboarding, false);
        assert_eq!(
            *events.borrow(),
            ["open-main", "show-services"],
            "Skip must open the workspace without a provider"
        );
        events.borrow_mut().clear();
        reconcile(&onboarding, true);
        assert_eq!(
            *events.borrow(),
            ["show-services"],
            "existing Main is never recreated by settings saves"
        );
    }
    #[test]
    fn native_service_geometry_reserves_footer_and_stays_positive_at_any_scale() {
        for scale in [1., 1.25, 1.5, 2.] {
            let size = service_size(1366. / scale, 768. / scale);
            assert_eq!(size.width, 1366. / scale - RAIL_WIDTH);
            assert_eq!(size.height, 768. / scale - FOOTER_HEIGHT);
        }
        assert_eq!(service_size(10., 10.), tauri::LogicalSize::new(1., 1.));
    }
    #[test]
    fn removal_reselects_active_preserves_other_profile_and_survives_restart() {
        let mut settings = settings();
        let profile = settings.services[1].profile_directory(std::path::Path::new("profiles"));
        remove_configuration(&mut settings, "first").unwrap();
        assert_eq!(settings.active_service.as_deref(), Some("second"));
        assert_eq!(settings.services.len(), 1);
        assert_eq!(
            settings.services[0].profile_directory(std::path::Path::new("profiles")),
            profile
        );
        let mut restarted: state::Settings =
            serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
        restarted.migrate_services().unwrap();
        assert_eq!(restarted.services.len(), 1);
        assert_eq!(restarted.services[0].id, "second");
        assert!(remove_configuration(&mut restarted, "first").is_err());
    }
    #[test]
    fn last_service_removal_never_recreates_legacy_configuration() {
        let mut settings = settings();
        remove_configuration(&mut settings, "second").unwrap();
        assert_eq!(settings.active_service.as_deref(), Some("first"));
        settings.service_schema = 0;
        remove_configuration(&mut settings, "first").unwrap();
        assert!(settings.services.is_empty());
        assert!(settings.active_service.is_none());
        assert!(settings.server_url.is_empty());
        assert_eq!(settings.service_schema, 1);
        settings.migrate_services().unwrap();
        assert!(settings.services.is_empty());
    }

    #[test]
    fn mattermost_removal_keeps_the_other_account_and_unrelated_preferences() {
        let mut settings = settings();
        for service in &mut settings.services {
            service.provider = ProviderId::Mattermost;
        }
        settings.theme = state::Theme::Dark;
        settings.unread_title = false;
        settings.migrate_services().unwrap();
        let retained = settings.services[1].clone();
        let profile = retained.profile_directory(std::path::Path::new("profiles"));
        remove_configuration(&mut settings, "first").unwrap();
        assert_eq!(settings.services, vec![retained]);
        assert_eq!(settings.active_service.as_deref(), Some("second"));
        assert!(matches!(settings.theme, state::Theme::Dark));
        assert!(!settings.unread_title);
        assert_eq!(
            settings.services[0].profile_directory(std::path::Path::new("profiles")),
            profile
        );
        let mut restarted: state::Settings =
            serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
        restarted.migrate_services().unwrap();
        assert_eq!(restarted.services, settings.services);
    }

    #[test]
    fn rail_reordering_preserves_disabled_slots_profiles_active_and_preferences() {
        let mut settings = settings();
        let mut hidden = settings.services[0].clone();
        hidden.id = "hidden".into();
        hidden.enabled = false;
        hidden.notifications = false;
        settings.services.insert(1, hidden.clone());
        settings.theme = state::Theme::Dark;
        settings.unread_title = false;
        let profiles: Vec<_> = settings
            .services
            .iter()
            .map(|service| {
                (
                    service.id.clone(),
                    service.profile_directory(std::path::Path::new("profiles")),
                )
            })
            .collect();
        assert!(reorder_configuration(&mut settings, &["second".into(), "first".into()]).unwrap());
        assert_eq!(
            settings
                .services
                .iter()
                .map(|service| service.id.as_str())
                .collect::<Vec<_>>(),
            vec!["second", "hidden", "first"]
        );
        assert_eq!(settings.services[1], hidden);
        assert_eq!(settings.active_service.as_deref(), Some("first"));
        assert!(matches!(settings.theme, state::Theme::Dark));
        assert!(!settings.unread_title);
        for service in &settings.services {
            assert_eq!(
                service.profile_directory(std::path::Path::new("profiles")),
                profiles.iter().find(|(id, _)| id == &service.id).unwrap().1
            );
        }
        let restarted: state::Settings =
            serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
        assert_eq!(restarted.services, settings.services);
        assert!(!reorder_configuration(&mut settings, &["second".into(), "first".into()]).unwrap());
    }

    #[test]
    fn rail_reordering_rejects_stale_missing_duplicate_disabled_and_unknown_ids_atomically() {
        let original = settings();
        for ids in [
            vec!["first"],
            vec!["first", "first"],
            vec!["first", "unknown"],
            vec!["first", "second", "extra"],
            vec![],
        ] {
            let mut current = original.clone();
            let before = serde_json::to_value(&current).unwrap();
            assert!(reorder_configuration(
                &mut current,
                &ids.into_iter().map(String::from).collect::<Vec<_>>()
            )
            .is_err());
            assert_eq!(serde_json::to_value(&current).unwrap(), before);
        }
        let mut current = original;
        current.services[1].enabled = false;
        assert!(reorder_configuration(&mut current, &["second".into(), "first".into()]).is_err());
    }
}

pub fn remove(app: &AppHandle, id: &str) -> Result<(), String> {
    let lifecycle = app.state::<Lifecycle>();
    let _transition = lifecycle.0.lock().unwrap_or_else(|e| e.into_inner());
    let old = state::current(app);
    let mut settings = old.clone();
    remove_configuration(&mut settings, id)?;
    state::persist(app, settings)?;
    reconcile_current(app, &old)
}

fn reconcile_current(app: &AppHandle, old: &state::Settings) -> Result<(), String> {
    let settings = state::current(app);
    for service in &old.services {
        if !settings.services.iter().any(|s| {
            s.id == service.id
                && s.enabled
                && s.provider == service.provider
                && s.url == service.url
        }) {
            if let Some(view) = app.get_webview(&label(&service.id)) {
                view.close()
                    .map_err(|_| "Settings saved. Restart to apply service changes.")?;
            }
            crate::unread::remove(app, &service.id);
        }
    }
    reconcile_workspace(
        &settings,
        app.get_window("main").is_some(),
        || crate::window::open(app),
        || show(app),
    )
}

fn reconcile_workspace(
    settings: &state::Settings,
    main_exists: bool,
    open: impl FnOnce() -> Result<(), String>,
    show: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if !main_exists {
        // Reuse normal service validation/persistence during first run, but let
        // the user add another service before opening any provider WebViews.
        if !settings.onboarding_completed {
            return Ok(());
        }
        open()?;
    }
    show()
}
fn create(app: &AppHandle, service: &ServiceConfig) -> Result<(), String> {
    let session = ServiceSession::new(service);
    let service = &session.config;
    let window = app
        .get_window("main")
        .ok_or("Desktop window unavailable.")?;
    let settings = state::current(app);
    let nav_service = service.clone();
    let popup_service = service.clone();
    let nav_app = app.clone();
    let popup_app = app.clone();
    let load_app = app.clone();
    let load_id = service.id.clone();
    let url = service
        .provider
        .validate_url(&service.url)?
        .parse()
        .map_err(|_| "Invalid service URL.")?;
    let mut builder = WebviewBuilder::new(&session.webview_label, WebviewUrl::External(url))
        .disable_drag_drop_handler()
        .on_navigation(move |target| {
            if nav_service.provider.allows(&nav_service.url, target) {
                true
            } else {
                external(&nav_app, target);
                false
            }
        })
        .on_new_window(move |target, features| {
            if crate::downloads::attachment_popup(&popup_service, &target) {
                return match crate::downloads::popup(&popup_app, &popup_service, features) {
                    Ok(window) => tauri::webview::NewWindowResponse::Create { window },
                    Err(_) => {
                        crate::shell::report(
                            &popup_app,
                            "Could not open the attachment. Try the download again.".into(),
                        );
                        tauri::webview::NewWindowResponse::Deny
                    }
                };
            }
            if popup_service.provider.allows(&popup_service.url, &target) {
                if let Some(view) = popup_app.get_webview(&label(&popup_service.id)) {
                    let _ = view.navigate(target);
                }
            } else {
                external(&popup_app, &target);
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .on_page_load(move |_, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                crate::unread::invalidate_presentation(&load_app, &load_id);
                crate::connection::set_for(
                    &load_app,
                    &load_id,
                    crate::connection::Connection::Connecting,
                );
            }
        });
    // Swiph3l: The migrated primary service retains its original profile so existing logins survive migration.
    if let Some(profile) = service.profile_directory(
        &app.path()
            .app_local_data_dir()
            .map_err(|_| "Could not resolve service profile.")?,
    ) {
        builder = builder.data_directory(profile);
    }
    if service.provider.definition().theme {
        builder = builder.initialization_script(format!(
            "window.__chatplusTheme = {};\n{}",
            serde_json::to_string(&settings.theme).unwrap(),
            include_str!("../theme-bootstrap.js")
        ));
    }
    if service.supports_unread() {
        // Swiph3l: Unread adapters are provider-specific and independent of theme support; Discord and Synology Chat must never receive ChatPlus styling.
        builder = builder.initialization_script(format!(
            "window.__chatplusProvider = {};\n{}",
            serde_json::to_string(&service.unread_source_provider()).unwrap(),
            include_str!("../unread-bootstrap.js")
        ));
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    let size = window
        .inner_size()
        .map_err(|_| "Could not measure desktop window.")?;
    let view = window
        .add_child(
            builder,
            tauri::LogicalPosition::new(RAIL_WIDTH, 0.),
            service_size(size.width as f64 / scale, size.height as f64 / scale),
        )
        .map_err(|_| "Could not create service WebView. Check WebView2 installation.")?;
    crate::native_shortcuts::attach(app, &view)
        .map_err(|_| "Could not register service shortcuts.")?;
    crate::platform::observe_connection(app, &view, &service.id)
        .map_err(|_| "Could not observe service connection.")?;
    crate::downloads::attach(app, &view, &service.id)
        .map_err(|_| "Could not observe attachment downloads.")?;
    crate::notification_bridge::attach(app, &view, service)
        .map_err(|_| "Could not attach service bridge.")?;
    crate::menu::restore_zoom(app, &view).map_err(|_| "Could not restore zoom.")?;
    Ok(())
}
