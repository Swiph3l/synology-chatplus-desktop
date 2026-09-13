use crate::{
    project::{self, Link, PROJECT},
    shell,
    state::{self, Theme},
    updates, window,
};
use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Manager,
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
pub fn restore_zoom(app: &AppHandle, window: &tauri::WebviewWindow) -> tauri::Result<()> {
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
fn content(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Open ChatPlus first.".into())
}
pub fn dispatch(app: &AppHandle, action: Action) -> Result<(), String> {
    match action {
        Action::Open => window::open(app),
        Action::Settings => shell::settings(app).map_err(|_| "Could not open Settings.".into()),
        Action::About => shell::about(app).map_err(|_| "Could not open About.".into()),
        Action::Reload => content(app)?
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
            if app.get_webview_window("main").is_some() {
                window::reopen(app)?;
            }
            window::apply_theme(app)
        }
        Action::ZoomIn | Action::ZoomOut | Action::ZoomReset => {
            let window = content(app)?;
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
        Action::Minimize => content(app)?
            .minimize()
            .map_err(|_| "Could not minimize ChatPlus.".into()),
        Action::Hide => content(app)?
            .hide()
            .map_err(|_| "Could not hide ChatPlus.".into()),
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
            .get_webview_window("fixture")
            .or_else(|| app.get_webview_window("main"))
            .ok_or("Open a webview first.")?
            .reload()
            .map_err(|_| "Could not reload webview.".into()),
        #[cfg(debug_assertions)]
        Action::DevTools => {
            let w = app
                .get_webview_window("fixture")
                .or_else(|| app.get_webview_window("main"))
                .ok_or("Open a webview first.")?;
            w.open_devtools();
            Ok(())
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
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
}
