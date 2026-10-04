use crate::state::{self, Theme};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub fn broadcast_settings(app: &AppHandle) {
    let settings = state::current(app);
    let _ = app.emit_to("settings", "settings-changed", &settings);
    let _ = app.emit_to("main", "services-changed", &settings);
    let _ = app.emit_to("about", "theme-changed", &settings.theme);
    let _ = app.emit_to("license", "theme-changed", &settings.theme);
    let _ = app.emit_to("update", "theme-changed", &settings.theme);
    for label in ["about", "license", "update"] {
        let _ = app.emit_to(label, "settings-changed", &settings);
    }
    #[cfg(debug_assertions)]
    let _ = app.emit_to("fixture", "theme-changed", &settings.theme);
}
pub fn theme_window(window: &tauri::WebviewWindow, theme: &Theme) -> tauri::Result<()> {
    // Swiph3l: Live native theme switching on Windows can make the menu bar unstable.
    // Keep native frame theme unchanged at runtime; page/theme colors are still updated.
    #[cfg(not(windows))]
    window.set_theme(theme.native())?;
    let dark = match theme {
        Theme::Dark => true,
        Theme::Light => false,
        Theme::System => window.theme()? == tauri::Theme::Dark,
    };
    window.set_background_color(Some(if dark {
        tauri::window::Color(15, 17, 21, 255)
    } else {
        tauri::window::Color(243, 245, 248, 255)
    }))
}
fn open(
    app: &AppHandle,
    label: &str,
    path: &str,
    title: &str,
    size: (f64, f64),
    resizable: bool,
) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(label) {
        return crate::window::focus(&window.as_ref().window());
    }
    let theme = state::current(app).theme;
    let bootstrap=format!("(()=>{{const apply=()=>{{if(!document.documentElement)return false;document.documentElement.dataset.theme={};return true}};if(!apply()){{const observer=new MutationObserver(()=>{{if(apply())observer.disconnect()}});observer.observe(document,{{childList:true}})}}}})()",serde_json::to_string(&theme).unwrap());
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App(path.into()))
        .title(title)
        .inner_size(size.0, size.1)
        .resizable(resizable)
        .center()
        .visible(false)
        .theme(theme.native())
        .initialization_script(&bootstrap)
        .on_navigation(crate::navigation::local_settings)
        .build()?;
    // Only the main window participates in window-state restoration.
    #[cfg(not(target_os = "macos"))]
    window.remove_menu()?;
    if resizable {
        window.set_min_size(Some(tauri::LogicalSize::new(420., size.1.min(480.))))?;
    }
    theme_window(&window, &theme)?;
    crate::window::focus(&window.as_ref().window())
}
pub fn settings(app: &AppHandle) -> tauri::Result<()> {
    settings_section(app, "general")
}
pub fn settings_section(app: &AppHandle, section: &str) -> tauri::Result<()> {
    let section = match section {
        "notifications" | "updates" | "services" | "changelog" | "about" => section,
        _ => "general",
    };
    let first_run = state::current(app).services.is_empty();
    let existing = app.get_webview_window("settings").is_some();
    let path = format!("index.html?section={section}");
    open(
        app,
        "settings",
        &path,
        "ChatPlus Desktop",
        if first_run {
            (460., 280.)
        } else {
            (720., 600.)
        },
        true,
    )?;
    // Swiph3l: New windows read the route from their URL; existing windows receive it after restore without losing unsaved drafts.
    if existing {
        let _ = app.emit_to("settings", "settings-section-requested", section);
    }
    Ok(())
}
pub fn about(app: &AppHandle) -> tauri::Result<()> {
    open(
        app,
        "about",
        "index.html?page=about",
        "ChatPlus Desktop",
        (500., 400.),
        false,
    )
}
pub fn license(app: &AppHandle) -> tauri::Result<()> {
    open(
        app,
        "license",
        "index.html?page=license",
        "ChatPlus Desktop - License",
        (720., 640.),
        true,
    )
}
#[cfg(debug_assertions)]
pub fn fixture(app: &AppHandle) -> tauri::Result<()> {
    open(
        app,
        "fixture",
        "index.html?page=fixture",
        "ChatPlus Desktop - Development Fixture",
        (1000., 740.),
        true,
    )
}

pub fn report(app: &AppHandle, message: String) {
    *app.state::<state::Status>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(message);
    let _ = settings(app);
    let _ = app.emit_to("settings", "operation-error", ());
}
