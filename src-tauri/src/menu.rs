use crate::{
    project::{self, Link, PROJECT},
    providers::ServiceConfig,
    shell,
    state::{self, Theme},
    updates, window,
};
use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItem, ContextMenu, Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager,
};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Open,
    Settings,
    Reload,
    Quit,
    System,
    Light,
    Dark,
    ZoomIn,
    ZoomOut,
    ZoomReset,
    Fullscreen,
    Minimize,
    Hide,
    About,
    Github,
    Issues,
    Star,
    Support,
    Updates,
    #[cfg(debug_assertions)]
    Fixture,
    #[cfg(debug_assertions)]
    DevReload,
    #[cfg(debug_assertions)]
    DevTools,
}
impl Action {
    pub fn id(self) -> &'static str {
        match self {
            Self::Open => "file.open",
            Self::Settings => "file.settings",
            Self::Reload => "file.reload",
            Self::Quit => "file.quit",
            Self::System => "theme.system",
            Self::Light => "theme.light",
            Self::Dark => "theme.dark",
            Self::ZoomIn => "view.zoom-in",
            Self::ZoomOut => "view.zoom-out",
            Self::ZoomReset => "view.zoom-reset",
            Self::Fullscreen => "view.fullscreen",
            Self::Minimize => "window.minimize",
            Self::Hide => "window.hide",
            Self::About => "help.about",
            Self::Github => "help.github",
            Self::Issues => "help.issues",
            Self::Star => "help.star",
            Self::Support => "help.support",
            Self::Updates => "help.updates",
            #[cfg(debug_assertions)]
            Self::Fixture => "developer.fixture",
            #[cfg(debug_assertions)]
            Self::DevReload => "developer.reload",
            #[cfg(debug_assertions)]
            Self::DevTools => "developer.devtools",
        }
    }
    pub fn all() -> Vec<Self> {
        vec![
            Self::Open,
            Self::Settings,
            Self::Reload,
            Self::Quit,
            Self::System,
            Self::Light,
            Self::Dark,
            Self::ZoomIn,
            Self::ZoomOut,
            Self::ZoomReset,
            Self::Fullscreen,
            Self::Minimize,
            Self::Hide,
            Self::About,
            Self::Github,
            Self::Issues,
            Self::Star,
            Self::Support,
            Self::Updates,
            #[cfg(debug_assertions)]
            Self::Fixture,
            #[cfg(debug_assertions)]
            Self::DevReload,
            #[cfg(debug_assertions)]
            Self::DevTools,
        ]
    }
    pub fn parse(id: &str) -> Option<Self> {
        Self::all().into_iter().find(|action| action.id() == id)
    }
}
#[derive(Default)]
pub struct MenuState {
    themes: Mutex<Vec<(Theme, CheckMenuItem<tauri::Wry>)>>,
    zoom: Mutex<f64>,
    service_menu: Mutex<Option<Menu<tauri::Wry>>>,
    settings_target: Mutex<Option<ServiceSettingsTarget>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ServiceAction {
    Open,
    Mute,
    Unmute,
    Notifications,
    Rename,
    Settings,
    Remove,
}
impl ServiceAction {
    fn key(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Mute => "mute",
            Self::Unmute => "unmute",
            Self::Notifications => "notifications",
            Self::Rename => "rename",
            Self::Settings => "settings",
            Self::Remove => "remove",
        }
    }
    fn title(self) -> &'static str {
        match self {
            Self::Open => "Open",
            Self::Mute => "Mute desktop notifications",
            Self::Unmute => "Unmute desktop notifications",
            Self::Notifications => "Desktop notification settings…",
            Self::Rename => "Rename service…",
            Self::Settings => "Service settings…",
            Self::Remove => "Remove service…",
        }
    }
    fn id(self, service_id: &str) -> String {
        format!("service-context.{}.{service_id}", self.key())
    }
    fn parse(id: &str) -> Option<(Self, &str)> {
        let (action, service_id) = id.strip_prefix("service-context.")?.split_once('.')?;
        if service_id.is_empty()
            || !service_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return None;
        }
        let action = match action {
            "open" => Self::Open,
            "mute" => Self::Mute,
            "unmute" => Self::Unmute,
            "notifications" => Self::Notifications,
            "rename" => Self::Rename,
            "settings" => Self::Settings,
            "remove" => Self::Remove,
            _ => return None,
        };
        Some((action, service_id))
    }
    fn allowed(self, service: &ServiceConfig) -> bool {
        service.enabled
            && match self {
                Self::Mute | Self::Unmute | Self::Notifications => {
                    service.provider.definition().notifications
                }
                _ => true,
            }
    }
    fn settings_field(self) -> Option<&'static str> {
        match self {
            Self::Notifications => Some("notifications"),
            Self::Rename => Some("name"),
            Self::Settings => Some("settings"),
            Self::Remove => Some("remove"),
            _ => None,
        }
    }
}
fn service_actions(service: &ServiceConfig) -> Vec<ServiceAction> {
    if !service.enabled {
        return Vec::new();
    }
    let mut actions = vec![ServiceAction::Open];
    if service.provider.definition().notifications {
        actions.push(if service.notifications {
            ServiceAction::Mute
        } else {
            ServiceAction::Unmute
        });
        actions.push(ServiceAction::Notifications);
    }
    actions.extend([
        ServiceAction::Rename,
        ServiceAction::Settings,
        ServiceAction::Remove,
    ]);
    actions
}

#[derive(serde::Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSettingsTarget {
    pub id: String,
    pub field: &'static str,
}
pub fn take_service_settings_target(app: &AppHandle) -> Option<ServiceSettingsTarget> {
    app.state::<MenuState>()
        .settings_target
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
}
fn configured_service(settings: &state::Settings, id: &str) -> Result<ServiceConfig, String> {
    settings
        .services
        .iter()
        .find(|service| service.id == id && service.enabled)
        .cloned()
        .ok_or_else(|| "Choose an enabled configured service.".into())
}
pub fn dispatch_service(app: &AppHandle, action: ServiceAction, id: &str) -> Result<(), String> {
    let settings = state::current(app);
    let service = configured_service(&settings, id)?;
    if !action.allowed(&service) {
        return Err("This service action is unavailable.".into());
    }
    match action {
        ServiceAction::Open => crate::services::activate(app, id),
        ServiceAction::Mute | ServiceAction::Unmute => {
            // Desired state, not a toggle: a delayed selection must not undo a newer mute.
            crate::services::set_notifications(app, id, action == ServiceAction::Unmute)
        }
        ServiceAction::Notifications
        | ServiceAction::Rename
        | ServiceAction::Settings
        | ServiceAction::Remove => {
            let field = action.settings_field().unwrap();
            *app.state::<MenuState>()
                .settings_target
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(ServiceSettingsTarget {
                id: id.into(),
                field,
            });
            shell::settings(app).map_err(|_| "Could not open service settings.")?;
            // The pending target is read after listener registration, also covering new-window load races.
            let _ = app.emit_to("settings", "service-settings-requested", ());
            Ok(())
        }
    }
}
fn popup_position(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<tauri::LogicalPosition<f64>, String> {
    if !x.is_finite() || !y.is_finite() {
        return Err("Invalid menu position.".into());
    }
    // Reserve room inside the host client viewport, not the 56px rail child.
    // Native menus additionally constrain the popup to the monitor work area.
    Ok(tauri::LogicalPosition::new(
        x.clamp(8., (width - 400.).max(8.)),
        y.clamp(8., (height - 256.).max(8.)),
    ))
}
pub fn service_popup(app: &AppHandle, id: &str, x: f64, y: f64) -> Result<(), String> {
    let service = configured_service(&state::current(app), id)?;
    let window = app.get_window("main").ok_or("Open a service first.")?;
    let size = window
        .inner_size()
        .map_err(|_| "Could not read window size.")?
        .to_logical::<f64>(
            window
                .scale_factor()
                .map_err(|_| "Could not read window scale.")?,
        );
    let position = popup_position(x, y, size.width, size.height)?;
    let menu = Menu::new(app).map_err(|_| "Could not create service menu.")?;
    let mut title: String = service.name.chars().take(24).collect();
    if service.name.chars().count() > 24 {
        title.push('…');
    }
    menu.append(
        &MenuItem::with_id(
            app,
            format!("service-heading.{id}"),
            title,
            false,
            None::<&str>,
        )
        .map_err(|_| "Could not create service menu heading.")?,
    )
    .map_err(|_| "Could not create service menu.")?;
    menu.append(&PredefinedMenuItem::separator(app).map_err(|_| "Could not create service menu.")?)
        .map_err(|_| "Could not create service menu.")?;
    for action in service_actions(&service) {
        if action == ServiceAction::Remove {
            menu.append(
                &PredefinedMenuItem::separator(app)
                    .map_err(|_| "Could not create service menu.")?,
            )
            .map_err(|_| "Could not create service menu.")?;
        }
        menu.append(
            &MenuItem::with_id(app, action.id(id), action.title(), true, None::<&str>)
                .map_err(|_| "Could not create service menu item.")?,
        )
        .map_err(|_| "Could not create service menu.")?;
    }
    // Retain the native menu until replaced, including platforms where popup returns before dismissal.
    *app.state::<MenuState>()
        .service_menu
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(menu.clone());
    menu.popup_at(window, position)
        .map_err(|_| "Could not show service menu.".into())
}
pub fn item(
    app: &AppHandle,
    action: Action,
    title: &str,
    key: Option<&str>,
) -> tauri::Result<MenuItem<tauri::Wry>> {
    MenuItem::with_id(app, action.id(), title, true, key)
}
pub fn themes(app: &AppHandle) -> tauri::Result<Submenu<tauri::Wry>> {
    let menu = Submenu::new(app, "Theme", true)?;
    let selected = state::current(app).theme;
    for (action, title, theme) in [
        (Action::System, "System", Theme::System),
        (Action::Light, "Light", Theme::Light),
        (Action::Dark, "Dark", Theme::Dark),
    ] {
        let item = CheckMenuItem::with_id(
            app,
            action.id(),
            title,
            true,
            selected == theme,
            None::<&str>,
        )?;
        menu.append(&item)?;
        app.state::<MenuState>()
            .themes
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push((theme, item));
    }
    Ok(menu)
}
pub fn refresh(app: &AppHandle) {
    if let Some(menu) = app.try_state::<MenuState>() {
        let selected = state::current(app).theme;
        for (theme, item) in menu.themes.lock().unwrap_or_else(|e| e.into_inner()).iter() {
            let _ = item.set_checked(*theme == selected);
        }
    }
}
pub fn restore_zoom(app: &AppHandle, window: &tauri::Webview) -> tauri::Result<()> {
    let state = app.state::<MenuState>();
    let zoom = *state.zoom.lock().unwrap_or_else(|e| e.into_inner());
    window.set_zoom(zoom)
}
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    app.manage(MenuState {
        zoom: Mutex::new(1.),
        ..MenuState::default()
    });
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item(app, Action::Open, "Open ChatPlus", Some("CmdOrCtrl+O"))?,
            &item(app, Action::Settings, "Settings", Some("CmdOrCtrl+,"))?,
            &item(app, Action::Reload, "Reload ChatPlus", Some("CmdOrCtrl+R"))?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, Action::Quit, "Quit", Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &themes(app)?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, Action::ZoomIn, "Zoom In", Some("CmdOrCtrl+Plus"))?,
            &item(app, Action::ZoomOut, "Zoom Out", Some("CmdOrCtrl+-"))?,
            &item(app, Action::ZoomReset, "Reset Zoom", Some("CmdOrCtrl+0"))?,
            &item(app, Action::Fullscreen, "Fullscreen", Some("F11"))?,
        ],
    )?;
    let windows = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &item(app, Action::Minimize, "Minimize", None)?,
            &item(app, Action::Hide, "Hide to Tray", None)?,
        ],
    )?;
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &item(app, Action::About, "About ChatPlus Desktop", None)?,
            &item(app, Action::Github, "GitHub Repository", None)?,
            &item(app, Action::Issues, "Report an Issue", None)?,
            &item(app, Action::Star, "Star on GitHub", None)?,
        ],
    )?;
    if PROJECT.link(Link::Support).is_some() {
        help.append(&item(app, Action::Support, "Support the Project", None)?)?;
    }
    help.append(&item(app, Action::Updates, "Check for Updates", None)?)?;
    let menu = Menu::with_items(app, &[&file, &view, &windows, &help])?;
    #[cfg(target_os = "macos")]
    menu.prepend(&Submenu::with_items(
        app,
        PROJECT.project_name,
        true,
        &[
            &item(app, Action::About, "About ChatPlus Desktop", None)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
        ],
    )?)?;
    #[cfg(debug_assertions)]
    menu.append(&Submenu::with_items(
        app,
        "Developer",
        true,
        &[
            &item(app, Action::Fixture, "Open Local Fixture", None)?,
            &item(app, Action::DevReload, "Reload WebView", None)?,
            &item(app, Action::DevTools, "Open DevTools", None)?,
        ],
    )?)?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if let Some(action) = Action::parse(event.id().as_ref()) {
            enqueue(app, action);
        } else if let Some((action, id)) = ServiceAction::parse(event.id().as_ref()) {
            let app = app.clone();
            let id = id.to_owned();
            std::thread::spawn(move || {
                if let Err(message) = dispatch_service(&app, action, &id) {
                    shell::report(&app, message);
                }
            });
        }
    });
    Ok(())
}
pub fn enqueue(app: &AppHandle, action: Action) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(message) = dispatch(&app, action) {
            shell::report(&app, message);
        }
    });
}
fn content(app: &AppHandle) -> Result<tauri::Window, String> {
    app.get_window("main")
        .ok_or_else(|| "Open ChatPlus first.".into())
}
pub fn dispatch(app: &AppHandle, action: Action) -> Result<(), String> {
    match action {
        Action::Open => window::open(app),
        Action::Settings => shell::settings(app).map_err(|_| "Could not open Settings.".into()),
        Action::About => shell::about(app).map_err(|_| "Could not open About.".into()),
        Action::Reload => crate::services::active(app)
            .ok_or("Open a service first.")?
            .reload()
            .map_err(|_| "Could not reload ChatPlus.".into()),
        Action::Quit => {
            let _ = app.save_window_state(StateFlags::all());
            app.exit(0);
            Ok(())
        }
        Action::System | Action::Light | Action::Dark => {
            let mut settings = state::current(app);
            settings.theme = match action {
                Action::Light => Theme::Light,
                Action::Dark => Theme::Dark,
                _ => Theme::System,
            };
            state::persist(app, settings)?;
            // Swiph3l: Apply theme live here; reopening the main window can destabilize the Windows menu bar.
            window::apply_theme(app)
        }
        Action::ZoomIn | Action::ZoomOut | Action::ZoomReset => {
            let window = crate::services::active(app).ok_or("Open a service first.")?;
            let state = app.state::<MenuState>();
            let mut zoom = state.zoom.lock().unwrap_or_else(|e| e.into_inner());
            let next = match action {
                Action::ZoomIn => (*zoom + 0.1).min(3.),
                Action::ZoomOut => (*zoom - 0.1).max(0.5),
                _ => 1.,
            };
            window
                .set_zoom(next)
                .map_err(|_| "Could not change zoom.")?;
            *zoom = next;
            Ok(())
        }
        Action::Fullscreen => {
            let w = content(app)?;
            w.set_fullscreen(
                !w.is_fullscreen()
                    .map_err(|_| "Could not read fullscreen state.")?,
            )
            .map_err(|_| "Could not change fullscreen.".into())
        }
        Action::Minimize | Action::Hide => {
            let window = content(app)?;
            match action {
                Action::Minimize => window
                    .minimize()
                    .map_err(|_| "Could not minimize ChatPlus."),
                _ => window.hide().map_err(|_| "Could not hide ChatPlus."),
            }?;
            // Swiph3l: Native events can coalesce during a rapid hide/restore;
            // revoke read gestures immediately rather than relying on a later focus event.
            crate::unread::sync_presentation(app);
            Ok(())
        }
        Action::Github => project::open(app, Link::Github),
        Action::Issues => project::open(app, Link::Issues),
        Action::Star => project::open(app, Link::Star),
        Action::Support => project::open(app, Link::Support),
        Action::Updates => {
            shell::update(app).map_err(|_| "Could not open update status.")?;
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = updates::check(&app, true).await;
            });
            Ok(())
        }
        #[cfg(debug_assertions)]
        Action::Fixture => {
            shell::fixture(app).map_err(|_| "Could not open development fixture.".into())
        }
        #[cfg(debug_assertions)]
        Action::DevReload => app
            .get_webview("fixture")
            .or_else(|| crate::services::active(app))
            .ok_or("Open a webview first.")?
            .reload()
            .map_err(|_| "Could not reload webview.".into()),
        #[cfg(debug_assertions)]
        Action::DevTools => {
            let w = app
                .get_webview("fixture")
                .or_else(|| crate::services::active(app))
                .ok_or("Open a webview first.")?;
            w.open_devtools();
            Ok(())
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::update_notification_config as set_service_notifications;
    #[test]
    fn menu_ids_are_unique_and_routable() {
        let actions = Action::all();
        let mut ids = std::collections::HashSet::new();
        for action in actions {
            assert!(ids.insert(action.id()));
            assert_eq!(Action::parse(action.id()), Some(action));
        }
        assert!(Action::parse("arbitrary-command").is_none());
    }
    #[test]
    fn developer_actions_follow_compilation_mode() {
        assert_eq!(
            Action::all()
                .iter()
                .any(|a| a.id().starts_with("developer.")),
            cfg!(debug_assertions)
        );
    }

    fn configured(id: &str, provider: crate::providers::ProviderId) -> ServiceConfig {
        ServiceConfig {
            id: id.into(),
            provider,
            name: "Test service".into(),
            url: "https://example.com/chat/".into(),
            enabled: true,
            notifications: true,
        }
    }
    #[test]
    fn service_menu_actions_follow_real_capabilities_and_mute_state() {
        use crate::providers::ProviderId;
        let mut service = configured("first", ProviderId::SynologyChatplus);
        assert_eq!(
            service_actions(&service),
            vec![
                ServiceAction::Open,
                ServiceAction::Mute,
                ServiceAction::Notifications,
                ServiceAction::Rename,
                ServiceAction::Settings,
                ServiceAction::Remove
            ]
        );
        service.notifications = false;
        assert!(service_actions(&service).contains(&ServiceAction::Unmute));
        assert!(!service_actions(&service).contains(&ServiceAction::Mute));
        for provider in [
            ProviderId::Slack,
            ProviderId::Discord,
            ProviderId::SynologyChat,
            ProviderId::Mattermost,
        ] {
            service.provider = provider;
            assert_eq!(
                service_actions(&service),
                vec![
                    ServiceAction::Open,
                    ServiceAction::Rename,
                    ServiceAction::Settings,
                    ServiceAction::Remove
                ]
            );
            for action in [
                ServiceAction::Mute,
                ServiceAction::Unmute,
                ServiceAction::Notifications,
            ] {
                assert!(!action.allowed(&service));
            }
        }
        service.enabled = false;
        assert!(service_actions(&service).is_empty());
        assert!(!ServiceAction::Open.allowed(&service));
    }
    #[test]
    fn service_menu_ids_route_the_clicked_instance_without_server_admin_actions() {
        let service = configured("second-123", crate::providers::ProviderId::SynologyChatplus);
        for action in service_actions(&service) {
            let id = action.id(&service.id);
            assert_eq!(ServiceAction::parse(&id), Some((action, "second-123")));
            assert!(Action::parse(&id).is_none());
        }
        for id in [
            "service-context.mark-read.second-123",
            "service-context.leave.second-123",
            "service-context.delete.second-123",
            "service-context.members.second-123",
            "service-context.open.",
            "service-context.open.a.b",
            "service-context.open.../profile",
        ] {
            assert!(ServiceAction::parse(id).is_none());
        }
        assert_eq!(ServiceAction::Rename.settings_field(), Some("name"));
        assert_eq!(ServiceAction::Settings.settings_field(), Some("settings"));
        assert_eq!(ServiceAction::Remove.settings_field(), Some("remove"));
        assert_eq!(
            ServiceAction::Notifications.settings_field(),
            Some("notifications")
        );
    }
    #[test]
    fn mute_updates_only_target_preference_and_revalidates_stale_actions() {
        use crate::providers::ProviderId;
        let mut settings = state::Settings {
            services: vec![
                configured("first", ProviderId::SynologyChatplus),
                configured("second", ProviderId::SynologyChatplus),
                configured("discord", ProviderId::Discord),
            ],
            active_service: Some("first".into()),
            ..Default::default()
        };
        set_service_notifications(&mut settings, "second", false).unwrap();
        assert!(settings.services[0].notifications);
        assert!(!settings.services[1].notifications);
        assert_eq!(settings.active_service.as_deref(), Some("first"));
        assert!(!settings.desktop_notifications);
        assert!(settings.unread_title);
        set_service_notifications(&mut settings, "second", false).unwrap();
        assert!(
            !settings.services[1].notifications,
            "mute is idempotent, not a toggle"
        );
        set_service_notifications(&mut settings, "second", true).unwrap();
        assert!(settings.services[1].notifications);
        assert!(set_service_notifications(&mut settings, "discord", true).is_err());
        settings.services[1].enabled = false;
        assert!(set_service_notifications(&mut settings, "second", false).is_err());
        assert!(set_service_notifications(&mut settings, "missing", false).is_err());
        assert!(configured_service(&settings, "missing").is_err());
    }
    #[test]
    fn menu_position_uses_host_viewport_and_rejects_invalid_coordinates() {
        let top = popup_position(-10., -20., 900., 600.).unwrap();
        assert_eq!((top.x, top.y), (8., 8.));
        let bottom = popup_position(899., 599., 900., 600.).unwrap();
        assert_eq!((bottom.x, bottom.y), (500., 344.));
        let cursor = popup_position(35., 220., 900., 600.).unwrap();
        assert_eq!((cursor.x, cursor.y), (35., 220.));
        assert!(popup_position(f64::NAN, 20., 900., 600.).is_err());
        assert!(popup_position(20., f64::INFINITY, 900., 600.).is_err());
    }

    #[test]
    fn mattermost_menu_routes_instances_by_service_id() {
        let settings = state::Settings {
            services: vec![
                configured(
                    "mattermost-company",
                    crate::providers::ProviderId::Mattermost,
                ),
                configured(
                    "mattermost-private",
                    crate::providers::ProviderId::Mattermost,
                ),
            ],
            active_service: Some("mattermost-company".into()),
            ..Default::default()
        };
        let clicked = configured_service(&settings, "mattermost-private").unwrap();
        assert_eq!(clicked.id, "mattermost-private");
        assert!(configured_service(&settings, "mattermost").is_err());
        for action in service_actions(&clicked) {
            assert_eq!(
                ServiceAction::parse(&action.id(&clicked.id)),
                Some((action, "mattermost-private"))
            );
        }
        assert_eq!(
            service_actions(&clicked),
            vec![
                ServiceAction::Open,
                ServiceAction::Rename,
                ServiceAction::Settings,
                ServiceAction::Remove
            ]
        );
    }
}
