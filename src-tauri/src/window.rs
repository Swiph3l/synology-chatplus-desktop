use crate::state::{self, Theme};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

pub fn focus(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    window.unminimize()?;
    window.show()?;
    window.set_focus()
}

pub fn restore_existing(app: &AppHandle) -> Result<bool, String> {
    if let Some(w) = app.get_webview_window("main") {
        focus(&w).map_err(|_| "Could not focus ChatPlus.".to_string())?;
        return Ok(true);
    }
    if let Some(w) = app.get_webview_window("settings") {
        focus(&w).map_err(|_| "Could not focus setup.".to_string())?;
        return Ok(true);
    }
    if let Some(w) = app.get_webview_window("about") {
        focus(&w).map_err(|_| "Could not focus About.".to_string())?;
        return Ok(true);
    }
    Ok(false)
}

pub fn open(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        return focus(&w).map_err(|_| "Could not focus ChatPlus.".into());
    }
    let settings = state::current(app);
    if settings.server_url.is_empty() {
        return crate::shell::settings(app).map_err(|_| "Could not open setup.".into());
    }
    let window = WebviewWindowBuilder::new(
        app,
        "main",
        WebviewUrl::App("index.html?page=services".into()),
    )
    .visible(false)
    .title("ChatPlus Desktop")
    .inner_size(1280., 850.)
    .min_inner_size(900., 600.)
    .theme(settings.theme.native())
    .on_navigation(crate::navigation::local_settings)
    .build()
    .map_err(|_| "Could not create desktop window.")?;
    crate::services::show(app)?;
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
        WindowEvent::Resized(_) => crate::services::layout(&handle),
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
pub fn apply_theme(app: &AppHandle) -> Result<(), String> {
    let settings = state::current(app);
    for window in app.webview_windows().values() {
        if window.label() == "main" {
            continue;
        }
        crate::shell::theme_window(window, &settings.theme)
            .map_err(|_| "Could not update window theme.")?;
        window
            .eval(&format!(
                "document.documentElement.dataset.theme = {}",
                serde_json::to_string(&settings.theme).unwrap()
            ))
            .map_err(|_| "Could not update page theme.")?;
    }
    if let Some(w) = app.get_webview_window("main") {
        #[cfg(not(windows))]
        let theme = match settings.theme {
            Theme::System => None,
            Theme::Dark => Some(tauri::Theme::Dark),
            Theme::Light => Some(tauri::Theme::Light),
        };
        #[cfg(not(windows))]
        w.set_theme(theme)
            .map_err(|_| "Could not apply window theme.")?;
        // Swiph3l: Live set_theme on Windows can destabilize the native menu bar.
        // Keep the frame stable and apply theme through page/background updates.
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
        for service in &settings.services {
            if !service.provider.definition().theme {
                continue;
            }
            let Some(view) = app.get_webview(&crate::services::label(&service.id)) else {
                continue;
            };
            view.eval(&format!(
                "window.__chatplusSetTheme?.({})",
                serde_json::to_string(&settings.theme).unwrap()
            ))
            .map_err(|_| "Could not apply page theme.")?;
        }
        let _ = w.eval(&format!(
            "document.documentElement.dataset.theme = {}",
            serde_json::to_string(&settings.theme).unwrap()
        ));
    }
    Ok(())
}
