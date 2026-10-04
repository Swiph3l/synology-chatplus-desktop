use crate::state::{self, Theme};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

pub fn is_foreground(app: &AppHandle) -> bool {
    app.get_window("main").is_some_and(|window| {
        foreground_state(
            window.is_focused().unwrap_or(false),
            window.is_visible().unwrap_or(false),
            window.is_minimized().unwrap_or(true),
        )
    })
}

fn foreground_state(focused: bool, visible: bool, minimized: bool) -> bool {
    // Swiph3l: Native focus can remain reported during minimize/hide; suppression and read acknowledgement require all three facts.
    focused && visible && !minimized
}

pub fn focus(window: &tauri::Window) -> tauri::Result<()> {
    window.unminimize()?;
    window.show()?;
    window.set_focus()?;
    if window.label() == "main" {
        if let Some(view) = crate::services::active(window.app_handle()) {
            view.set_focus()?;
        }
        crate::unread::sync_presentation(window.app_handle());
    }
    Ok(())
}

pub fn activate_notification(app: &AppHandle, service_id: Option<&str>) -> Result<(), String> {
    // Swiph3l: Restore the native frame before focusing its provider; a toast click routes the existing instance and never marks it read.
    open(app)?;
    let settings = state::current(app);
    if let Some(id) = notification_destination(&settings, service_id) {
        crate::services::activate(app, id)?;
    }
    Ok(())
}

fn notification_destination<'a>(
    settings: &state::Settings,
    service_id: Option<&'a str>,
) -> Option<&'a str> {
    service_id.filter(|id| settings.services.iter().any(|s| s.id == *id && s.enabled))
}

pub fn restore_existing(app: &AppHandle) -> Result<bool, String> {
    if let Some(w) = app.get_window("main") {
        focus(&w).map_err(|_| "Could not focus ChatPlus.".to_string())?;
        return Ok(true);
    }
    if let Some(w) = app.get_webview_window("settings") {
        focus(&w.as_ref().window()).map_err(|_| "Could not focus setup.".to_string())?;
        return Ok(true);
    }
    if let Some(w) = app.get_webview_window("about") {
        focus(&w.as_ref().window()).map_err(|_| "Could not focus About.".to_string())?;
        return Ok(true);
    }
    Ok(false)
}

pub fn open(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_window("main") {
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
    // Swiph3l: Leave room for the native title/menu frame on 1366x768 laptops; saved window geometry still restores normally.
    .inner_size(1280., 680.)
    .min_inner_size(900., 600.)
    .theme(settings.theme.native())
    .on_navigation(crate::navigation::local_settings)
    .build()
    .map_err(|_| "Could not create desktop window.")?;
    crate::services::show(app)?;
    apply_theme(app)?;
    focus(&window.as_ref().window()).map_err(|_| "Could not show ChatPlus.")?;
    let handle = app.clone();
    let event_window = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            let _ = handle.save_window_state(StateFlags::all());
            if state::current(&handle).close_to_tray {
                if event_window.hide().is_ok() {
                    api.prevent_close();
                    crate::unread::sync_presentation(&handle);
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
            crate::unread::sync_presentation(&handle);
        }
        WindowEvent::Resized(_) => {
            crate::services::layout(&handle);
            crate::unread::sync_presentation(&handle);
        }
        WindowEvent::Focused(_) => crate::unread::sync_presentation(&handle),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_visibility_distinguishes_foreground_from_minimized_hidden_and_background() {
        assert!(foreground_state(true, true, false));
        assert!(!foreground_state(true, true, true));
        assert!(!foreground_state(true, false, false));
        assert!(!foreground_state(false, true, false));
    }

    #[test]
    fn notification_activation_targets_its_origin_and_ignores_removed_services() {
        let mut settings = state::Settings::default();
        settings.services = ["selected", "origin"]
            .into_iter()
            .map(|id| crate::providers::ServiceConfig {
                id: id.into(),
                provider: crate::providers::ProviderId::SynologyChatplus,
                name: id.into(),
                url: "https://example.com/chat/".into(),
                enabled: true,
                notifications: true,
            })
            .collect();
        settings.active_service = Some("selected".into());
        assert_eq!(
            notification_destination(&settings, Some("origin")),
            Some("origin")
        );
        assert_eq!(notification_destination(&settings, Some("missing")), None);
        assert_eq!(notification_destination(&settings, None), None);
        settings.services[1].enabled = false;
        assert_eq!(notification_destination(&settings, Some("origin")), None);
    }
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
    if let Some(w) = app.get_window("main") {
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
        if let Some(rail) = app.get_webview("main") {
            let _ = rail.eval(&format!(
                "document.documentElement.dataset.theme = {}",
                serde_json::to_string(&settings.theme).unwrap()
            ));
        }
    }
    Ok(())
}
