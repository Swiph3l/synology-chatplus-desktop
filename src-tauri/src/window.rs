use crate::state::{self, Theme};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

pub fn focus(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    window.unminimize()?;
    window.show()?;
    window.set_focus()
}
fn open_external(app: &AppHandle, url: &url::Url) {
    if state::current(app).external_links
        && matches!(url.scheme(), "https" | "http")
        && url.username().is_empty()
        && url.password().is_none()
    {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}
pub fn open(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        return focus(&w).map_err(|_| "Could not focus ChatPlus.".into());
    }
    let settings = state::current(app);
    if settings.server_url.is_empty() {
        return crate::shell::settings(app).map_err(|_| "Could not open setup.".into());
    }
    let url = url::Url::parse(&settings.server_url).map_err(|_| "Invalid server URL.")?;
    let origin = url.origin();
    let popup_origin = origin.clone();
    let navigation_app = app.clone();
    let load_app = app.clone();
    let popup_app = app.clone();
    let script = format!(
        "window.__chatplusTheme = {};\n{}",
        serde_json::to_string(&settings.theme).unwrap(),
        include_str!("../theme-bootstrap.js")
    );
    let native_theme = match settings.theme {
        Theme::System => None,
        Theme::Light => Some(tauri::Theme::Light),
        Theme::Dark => Some(tauri::Theme::Dark),
    };
    let dark = match settings.theme {
        Theme::Dark => true,
        Theme::Light => false,
        Theme::System => true,
    };
    let color = if dark {
        tauri::window::Color(15, 17, 21, 255)
    } else {
        tauri::window::Color(255, 255, 255, 255)
    };
    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .visible(false)
        .title("ChatPlus Desktop")
        .inner_size(1280., 850.)
        .min_inner_size(900., 600.)
        .theme(native_theme)
        .background_color(color)
        .initialization_script(&script)
        .disable_drag_drop_handler()
        .on_page_load(move |_, payload| {
            let value = match payload.event() {
                tauri::webview::PageLoadEvent::Started => {
                    crate::desktop_notifications::pause_tracking(&load_app);
                    crate::connection::Connection::Connecting
                }
                // A generic page-finished event does not establish successful transport.
                tauri::webview::PageLoadEvent::Finished => {
                    if cfg!(windows) {
                        return;
                    }
                    crate::connection::Connection::Unknown
                }
            };
            crate::connection::set(&load_app, value);
        })
        .on_navigation(move |target| {
            if crate::navigation::same_server(target, &origin) {
                true
            } else {
                open_external(&navigation_app, target);
                false
            }
        })
        .on_new_window(move |target, _| {
            if crate::navigation::same_server(&target, &popup_origin) {
                if let Some(w) = popup_app.get_webview_window("main") {
                    let _ = w.navigate(target);
                }
            } else {
                open_external(&popup_app, &target);
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build()
        .map_err(|_| "Could not create the ChatPlus window. Check WebView installation.")?;
    crate::platform::observe_connection(app, &window)
        .map_err(|_| "Could not observe WebView connection state.")?;
    crate::notification_bridge::attach(app, &window)
        .map_err(|_| "Could not attach browser notification events.")?;
    crate::menu::restore_zoom(app, &window).map_err(|_| "Could not restore zoom.")?;
    apply_theme(app)?;
    focus(&window).map_err(|_| "Could not show ChatPlus.")?;
    let handle = app.clone();
    let event_window = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            let _ = handle.save_window_state(StateFlags::all());
            if state::current(&handle).close_to_tray {
                if event_window.hide().is_ok() {
                    api.prevent_close();
                }
            } else {
                handle.exit(0);
            }
        }
        WindowEvent::Resized(_)
            if state::current(&handle).minimize_to_tray
                && event_window.is_minimized().unwrap_or(false) =>
        {
            let _ = event_window.hide();
        }
        WindowEvent::ThemeChanged(theme)
            if matches!(state::current(&handle).theme, Theme::System) =>
        {
            let color = if *theme == tauri::Theme::Dark {
                tauri::window::Color(15, 17, 21, 255)
            } else {
                tauri::window::Color(255, 255, 255, 255)
            };
            let _ = event_window.set_background_color(Some(color));
        }
        _ => {}
    });
    Ok(())
}
pub fn reopen(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = app.save_window_state(StateFlags::all());
        window
            .destroy()
            .map_err(|_| "Could not close ChatPlus for settings update.")?;
        // Window destruction is queued on the UI thread. Wait for its label to
        // be released before rebuilding, otherwise open() can focus a stale handle.
        for _ in 0..100 {
            if app.get_webview_window("main").is_none() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        if app.get_webview_window("main").is_some() {
            return Err("Settings saved. Restart ChatPlus to apply them.".into());
        }
    }
    open(app)
}
pub fn apply_theme(app: &AppHandle) -> Result<(), String> {
    let settings = state::current(app);
    for window in app.webview_windows().values() {
        crate::shell::theme_window(window, &settings.theme)
            .map_err(|_| "Could not update window theme.")?;
        if window.label() != "main" {
            window
                .eval(&format!(
                    "document.documentElement.dataset.theme = {}",
                    serde_json::to_string(&settings.theme).unwrap()
                ))
                .map_err(|_| "Could not update page theme.")?;
        }
    }
    if let Some(w) = app.get_webview_window("main") {
        let theme = match settings.theme {
            Theme::System => None,
            Theme::Dark => Some(tauri::Theme::Dark),
            Theme::Light => Some(tauri::Theme::Light),
        };
        w.set_theme(theme)
            .map_err(|_| "Could not apply window theme.")?;
        let dark = match settings.theme {
            Theme::Dark => true,
            Theme::Light => false,
            Theme::System => w.theme().ok() == Some(tauri::Theme::Dark),
        };
        w.set_background_color(Some(if dark {
            tauri::window::Color(15, 17, 21, 255)
        } else {
            tauri::window::Color(255, 255, 255, 255)
        }))
        .map_err(|_| "Could not apply background.")?;
        w.eval(&format!(
            "window.__chatplusSetTheme?.({})",
            serde_json::to_string(&settings.theme).unwrap()
        ))
        .map_err(|_| "Could not apply page theme.")?;
    }
    Ok(())
}
