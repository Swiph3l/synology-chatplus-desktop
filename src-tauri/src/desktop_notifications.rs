//! Desktop notification policy and platform adapters. No content is logged/persisted.
use crate::state::NotificationPreview;
use std::{
    collections::VecDeque,
    hash::{Hash, Hasher},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
#[derive(Default)]
pub struct Service(pub Mutex<Tracking>);
#[derive(Default)]
pub struct Tracking {
    pub bridge_available: bool,
    pub active_after: Option<Instant>,
    recent: VecDeque<(u64, Instant)>,
    pub last_status: String,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Permission {
    pub webview_state: String,
    pub granted: bool,
    pub state: String,
    pub bridge_available: bool,
    pub message: String,
}
pub fn permission(app: &AppHandle) -> Permission {
    let plugin_granted = matches!(
        app.notification().permission_state(),
        Ok(tauri::plugin::PermissionState::Granted)
    );
    let os_granted = os_permission(app);
    let available = app
        .state::<Service>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .bridge_available;
    Permission {webview_state:"unknown".into(),granted:plugin_granted && os_granted,state:if plugin_granted&&os_granted{"granted"}else{"denied"}.into(),bridge_available:available,message:if plugin_granted&&os_granted{"Windows notifications are available. Enable browser notifications in ChatPlus as well."}else{"Windows notifications are blocked or unavailable for ChatPlus Desktop. Open Windows notification settings to check access."}.into()}
}
pub fn request_permission(app: &AppHandle) -> Result<Permission, String> {
    if !matches!(
        app.notification().permission_state(),
        Ok(tauri::plugin::PermissionState::Granted)
    ) {
        app.notification()
            .request_permission()
            .map_err(|_| "Could not request notification permission.")?;
    }
    Ok(permission(app))
}
pub fn send_test(app: &AppHandle, sound: bool) -> Result<(), String> {
    // Explicit local user action: independent of unread, focus and tracking state.
    let mut permission = permission(app);
    if !permission.granted {
        permission = request_permission(app)?;
    }
    if !permission.granted {
        return Err(permission.message);
    }
    show(app, "ChatPlus Desktop", "Notifications are working.", sound)
}
#[cfg(windows)]
fn os_permission(app: &AppHandle) -> bool {
    use windows::{
        core::HSTRING,
        UI::Notifications::{NotificationSetting, ToastNotificationManager},
    };
    ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(&app.config().identifier))
        .and_then(|notifier| notifier.Setting())
        .is_ok_and(|value| value == NotificationSetting::Enabled)
}
#[cfg(not(windows))]
fn os_permission(_: &AppHandle) -> bool {
    true
}
pub fn preview(mode: &NotificationPreview, title: &str, body: &str) -> (String, String) {
    let clean = |value: &str, limit| {
        value
            .chars()
            .filter(|c| !c.is_control() || *c == '\n')
            .take(limit)
            .collect::<String>()
    };
    match mode {
        NotificationPreview::Full => (clean(title, 160), clean(body, 500)),
        NotificationPreview::Sender => (clean(title, 160), "New message".into()),
        NotificationPreview::Generic => {
            ("ChatPlus Desktop".into(), "You have a new message.".into())
        }
    }
}
pub fn should_notify(enabled: bool, granted: bool, focused: bool, active: bool) -> bool {
    enabled && granted && !focused && active
}
pub fn begin_tracking(app: &AppHandle) {
    let service = app.state::<Service>();
    let mut state = service.0.lock().unwrap_or_else(|e| e.into_inner());
    state.active_after = Some(Instant::now() + Duration::from_secs(2));
    state.recent.clear();
}
pub fn pause_tracking(app: &AppHandle) {
    app.state::<Service>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .active_after = None;
}
pub fn deliver(app: &AppHandle, title: &str, body: &str, tag: &str) -> bool {
    let settings = crate::state::current(app);
    let focused = app.get_webview_window("main").is_some_and(|w| {
        w.is_focused().unwrap_or(false)
            && w.is_visible().unwrap_or(false)
            && !w.is_minimized().unwrap_or(true)
    });
    let active = app
        .state::<Service>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .active_after
        .is_some_and(|at| Instant::now() >= at);
    if !should_notify(
        settings.desktop_notifications,
        permission(app).granted,
        focused,
        active,
    ) {
        return false;
    }
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    (title, body, tag).hash(&mut hasher);
    let key = hasher.finish();
    {
        let service = app.state::<Service>();
        let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        tracking
            .recent
            .retain(|(_, at)| now.duration_since(*at) < Duration::from_secs(2));
        if tracking.recent.iter().any(|(previous, _)| *previous == key)
            || tracking.recent.len() >= 5
        {
            return false;
        }
        tracking.recent.push_back((key, now));
    }
    let (title, body) = preview(&settings.notification_preview, title, body);
    let result = show(app, &title, &body, settings.notification_sound);
    app.state::<Service>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .last_status = if result.is_ok() {
        "Notification submitted to the system."
    } else {
        "The system could not display the notification."
    }
    .into();
    result.is_ok()
}
#[cfg(windows)]
fn show(app: &AppHandle, title: &str, body: &str, sound: bool) -> Result<(), String> {
    // The official plugin handles permission policy. Its current desktop API
    // drops click handlers and errors, so Windows uses its Tauri WinRT backend
    // directly for activation and explicit silence; no second toast is sent.
    use tauri_winrt_notification::{Sound, Toast};
    let handle = app.clone();
    Toast::new(&app.config().identifier)
        .title(title)
        .text1(body)
        .sound(if sound { Some(Sound::IM) } else { None })
        .on_activated(move |_| {
            let app = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                let _ = crate::window::open(&app);
            });
            Ok(())
        })
        .show()
        .map_err(|_| "Could not show Windows notification.".into())
}
#[cfg(not(windows))]
fn show(app: &AppHandle, title: &str, body: &str, sound: bool) -> Result<(), String> {
    let mut builder = app.notification().builder().title(title).body(body);
    if sound {
        builder = builder.sound("message-new-instant");
    }
    builder
        .show()
        .map_err(|_| "Could not show notification.".into())
}
pub struct Icons {
    pub normal: tauri::image::Image<'static>,
    pub unread: tauri::image::Image<'static>,
    pub overlay: tauri::image::Image<'static>,
}
pub fn icons(app: &AppHandle) {
    let source = app.default_window_icon().expect("bundled icon");
    let (width, height) = (source.width(), source.height());
    let normal = tauri::image::Image::new_owned(source.rgba().to_vec(), width, height);
    let mut bytes = normal.rgba().to_vec();
    for y in 0..height {
        for x in 0..width {
            let distance = ((x as f32 - width as f32 * 0.79).powi(2)
                + (y as f32 - height as f32 * 0.79).powi(2))
            .sqrt();
            if distance < width as f32 * 0.19 {
                let color = if distance > width as f32 * 0.15 {
                    [255, 255, 255, 255]
                } else {
                    [235, 55, 68, 255]
                };
                bytes[((y * width + x) * 4) as usize..((y * width + x) * 4 + 4) as usize]
                    .copy_from_slice(&color);
            }
        }
    }
    let mut overlay = vec![0; 32 * 32 * 4];
    for y in 0..32 {
        for x in 0..32 {
            let d = ((x as f32 - 16.).powi(2) + (y as f32 - 16.).powi(2)).sqrt();
            if d < 13. {
                let color = if d > 10. {
                    [255, 255, 255, 255]
                } else {
                    [235, 55, 68, 255]
                };
                overlay[(y * 32 + x) * 4..(y * 32 + x) * 4 + 4].copy_from_slice(&color);
            }
        }
    }
    app.manage(Icons {
        normal,
        unread: tauri::image::Image::new_owned(bytes, width, height),
        overlay: tauri::image::Image::new_owned(overlay, 32, 32),
    });
}
pub fn taskbar(window: &tauri::WebviewWindow, unread: &crate::unread::Unread) {
    #[cfg(windows)]
    {
        let icon = unread
            .has_unread
            .then(|| window.app_handle().state::<Icons>().overlay.clone());
        let _ = window.set_overlay_icon(icon);
    }
    #[cfg(target_os = "macos")]
    {
        let _ = window.set_badge_count(
            unread
                .has_unread
                .then_some(unread.total_unread_count.unwrap_or(1) as i64),
        );
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = (window, unread);
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn privacy_modes_never_leak_body_when_hidden() {
        assert_eq!(
            preview(&NotificationPreview::Full, "Sender - chat", "private text"),
            ("Sender - chat".into(), "private text".into())
        );
        assert_eq!(
            preview(
                &NotificationPreview::Sender,
                "Sender - chat",
                "private text"
            ),
            ("Sender - chat".into(), "New message".into())
        );
        assert_eq!(
            preview(
                &NotificationPreview::Generic,
                "Sender - chat",
                "private text"
            ),
            ("ChatPlus Desktop".into(), "You have a new message.".into())
        );
    }
    #[test]
    fn permission_focus_and_startup_gate_notifications() {
        assert!(should_notify(true, true, false, true));
        for values in [
            (false, true, false, true),
            (true, false, false, true),
            (true, true, true, true),
            (true, true, false, false),
        ] {
            assert!(!should_notify(values.0, values.1, values.2, values.3));
        }
    }
}
