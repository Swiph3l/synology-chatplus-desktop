//! Desktop notification policy and platform adapters. No content is logged/persisted.
use crate::state::NotificationPreview;
use std::{
    collections::HashMap,
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
    recent: HashMap<u64, Instant>,
    pub last_status: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum NativeState {
    Enabled,
    NotRegistered,
    Blocked,
    Unavailable,
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
    // Swiph3l: Native Windows sender state and WebView Notification.permission are separate notification paths.
    let plugin_state = app.notification().permission_state().ok();
    let native = native_state(app);
    let available = app
        .state::<Service>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .bridge_available;
    let (state, native_granted, mut message) = match native {
        NativeState::Enabled => (
            "enabled",
            true,
            "Windows notifications are available for ChatPlus Desktop.",
        ),
        NativeState::NotRegistered => (
            "not-registered",
            false,
            "ChatPlus Desktop is not yet registered as a Windows notification sender.",
        ),
        NativeState::Blocked => (
            "blocked",
            false,
            "Windows notifications are disabled for ChatPlus Desktop.",
        ),
        NativeState::Unavailable => (
            "unavailable",
            true,
            "Windows notification status is unavailable right now.",
        ),
    };
    let mut granted = native_granted;
    if matches!(plugin_state, Some(tauri::plugin::PermissionState::Denied)) {
        granted = false;
        message = "Windows notifications are blocked by system policy for this app.";
    };
    Permission {
        webview_state: "unknown".into(),
        granted,
        state: state.into(),
        bridge_available: available,
        message: message.into(),
    }
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
fn native_state(app: &AppHandle) -> NativeState {
    #[cfg(windows)]
    {
        use windows::{
            core::HSTRING,
            UI::Notifications::{NotificationSetting, ToastNotificationManager},
        };
        // Swiph3l: The installed shortcut AUMID and toast notifier AUMID must match exactly.
        // Swiph3l: Validate the installed .lnk property store, not only generated NSIS.
        let Ok(notifier) = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(
            &app.config().identifier,
        )) else {
            return NativeState::NotRegistered;
        };
        return match notifier.Setting() {
            Ok(NotificationSetting::Enabled) => NativeState::Enabled,
            Ok(NotificationSetting::DisabledForApplication)
            | Ok(NotificationSetting::DisabledForUser)
            | Ok(NotificationSetting::DisabledByGroupPolicy)
            | Ok(NotificationSetting::DisabledByManifest) => NativeState::Blocked,
            // TODO(Swiph3l): verify sender registration on a clean Windows profile.
            Err(_) => NativeState::Unavailable,
            _ => NativeState::Unavailable,
        };
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        NativeState::Enabled
    }
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
    let _ = focused;
    enabled && granted && active
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
    // Swiph3l: Cooldown suppresses repeated toasts only; unread state must always update.
    // Swiph3l: First toast is immediate, regardless of the selected cooldown.
    let key = conversation_key(tag);
    {
        let service = app.state::<Service>();
        let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
        if cooldown_suppressed(
            &mut tracking,
            key,
            Instant::now(),
            settings.notification_cooldown,
        ) {
            println!(
                "notification: conversation={} action=suppressed reason=cooldown",
                key
            );
            return false;
        }
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
    println!(
        "notification: conversation={} action={} reason=delivery",
        key,
        if result.is_ok() { "shown" } else { "failed" }
    );
    result.is_ok()
}

fn cooldown_suppressed(tracking: &mut Tracking, key: u64, now: Instant, cooldown: u16) -> bool {
    let cooldown = crate::state::normalize_notification_cooldown_seconds(cooldown) as u64;
    if cooldown == 0 {
        tracking.recent.clear();
        return false;
    }
    let window = Duration::from_secs(cooldown);
    tracking
        .recent
        .retain(|_, at| now.duration_since(*at) < window);
    if tracking
        .recent
        .get(&key)
        .is_some_and(|at| now.duration_since(*at) < window)
    {
        return true;
    }
    tracking.recent.insert(key, now);
    false
}

fn conversation_key(tag: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    let normalized = tag.trim();
    if normalized.is_empty() {
        "global".hash(&mut hasher);
    } else {
        normalized.hash(&mut hasher);
    }
    hasher.finish()
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
        assert!(should_notify(true, true, true, true));
        for values in [
            (false, true, false, true),
            (true, false, false, true),
            (true, true, false, false),
        ] {
            assert!(!should_notify(values.0, values.1, values.2, values.3));
        }
    }

    #[test]
    fn conversation_cooldown_uses_tag_with_global_fallback() {
        let global_a = conversation_key("");
        let global_b = conversation_key("   ");
        assert_eq!(global_a, global_b);
        assert_eq!(
            conversation_key("room:alpha"),
            conversation_key("room:alpha")
        );
        assert_ne!(
            conversation_key("room:alpha"),
            conversation_key("room:beta")
        );
    }

    #[test]
    fn first_toast_is_immediate_then_suppressed_within_selected_window() {
        let mut tracking = Tracking::default();
        let key = conversation_key("room:alpha");
        let now = Instant::now();
        assert!(!cooldown_suppressed(&mut tracking, key, now, 60));
        assert!(cooldown_suppressed(
            &mut tracking,
            key,
            now + Duration::from_secs(10),
            60
        ));
        assert!(!cooldown_suppressed(
            &mut tracking,
            key,
            now + Duration::from_secs(61),
            60
        ));
    }

    #[test]
    fn cooldown_is_per_conversation_and_zero_disables_suppression() {
        let mut tracking = Tracking::default();
        let now = Instant::now();
        let alpha = conversation_key("room:alpha");
        let beta = conversation_key("room:beta");
        assert!(!cooldown_suppressed(&mut tracking, alpha, now, 60));
        assert!(!cooldown_suppressed(
            &mut tracking,
            beta,
            now + Duration::from_secs(5),
            60
        ));
        assert!(!cooldown_suppressed(
            &mut tracking,
            alpha,
            now + Duration::from_secs(6),
            0
        ));
        assert!(!cooldown_suppressed(
            &mut tracking,
            alpha,
            now + Duration::from_secs(7),
            0
        ));
    }
}
