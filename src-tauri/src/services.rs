//! Native service sessions live behind a local rail; provider pages have no Tauri capability.
use crate::{providers::ServiceConfig, state};
use tauri::{AppHandle, Emitter, Manager, Webview, WebviewBuilder, WebviewUrl};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct Lifecycle(std::sync::Mutex<()>);

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
        let _ = rail.set_size(tauri::LogicalSize::new(56., height));
    }
    for service in state::current(app).services {
        if let Some(view) = app.get_webview(&label(&service.id)) {
            let _ = view.set_position(tauri::LogicalPosition::new(56., 0.));
            let _ = view.set_size(tauri::LogicalSize::new((width - 56.).max(1.), height));
        }
    }
}
pub fn show(app: &AppHandle) -> Result<(), String> {
    let settings = state::current(app);
    let Some(service) = settings.active().cloned() else {
        return crate::shell::settings(app).map_err(|_| "Could not open Settings.".into());
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
    let _ = app.emit_to("main", "services-changed", &settings);
    crate::unread::refresh(app);
    crate::connection::refresh(app);
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
pub fn reconcile(app: &AppHandle, old: &state::Settings) -> Result<(), String> {
    let lifecycle = app.state::<Lifecycle>();
    let _transition = lifecycle.0.lock().unwrap_or_else(|e| e.into_inner());
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
    if app.get_window("main").is_none() {
        crate::window::open(app)?;
    }
    show(app)
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
        .on_new_window(move |target, _| {
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
                crate::desktop_notifications::pause_tracking_for(&load_app, &load_id);
                crate::connection::set_for(
                    &load_app,
                    &load_id,
                    crate::connection::Connection::Connecting,
                );
            }
        });
    // The migrated primary service retains Tauri's original default data directory.
    if service.id != "chatplus" {
        builder = builder.data_directory(
            app.path()
                .app_local_data_dir()
                .map_err(|_| "Could not resolve service profile.")?
                .join("services")
                .join(&service.id),
        );
    }
    if service.provider.definition().theme {
        builder = builder.initialization_script(format!(
            "window.__chatplusTheme = {};\n{}",
            serde_json::to_string(&settings.theme).unwrap(),
            include_str!("../theme-bootstrap.js")
        ));
    }
    let view = window
        .add_child(
            builder,
            tauri::LogicalPosition::new(56., 0.),
            tauri::LogicalSize::new(1224., 850.),
        )
        .map_err(|_| "Could not create service WebView. Check WebView2 installation.")?;
    crate::platform::observe_connection(app, &view, &service.id)
        .map_err(|_| "Could not observe service connection.")?;
    crate::notification_bridge::attach(app, &view, service)
        .map_err(|_| "Could not attach service bridge.")?;
    crate::menu::restore_zoom(app, &view).map_err(|_| "Could not restore zoom.")?;
    Ok(())
}
