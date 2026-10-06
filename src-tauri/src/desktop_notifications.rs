//! Desktop notification policy and platform adapters. No content is logged/persisted.
use crate::state::NotificationPreview;
use std::{
    collections::HashMap,
    hash::{Hash, Hasher},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
#[derive(Default)]
pub struct Service(pub Mutex<Tracking>);
#[derive(Default)]
pub struct Tracking {
    pub bridge_available: bool,
    duplicates: HashMap<u64, Instant>,
    retryable: HashMap<u64, Instant>,
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
            crate::i18n::t(app, "notification.permissionEnabled"),
        ),
        NativeState::NotRegistered => (
            "not-registered",
            false,
            crate::i18n::t(app, "notification.permissionNotRegistered"),
        ),
        NativeState::Blocked => (
            "blocked",
            false,
            crate::i18n::t(app, "notification.permissionBlocked"),
        ),
        NativeState::Unavailable => (
            "unavailable",
            true,
            crate::i18n::t(app, "notification.permissionUnavailable"),
        ),
    };
    let mut granted = native_granted;
    if matches!(plugin_state, Some(tauri::plugin::PermissionState::Denied)) {
        granted = false;
        message = crate::i18n::t(app, "notification.permissionPolicyBlocked");
    };
    Permission {
        webview_state: "unknown".into(),
        granted,
        state: state.into(),
        bridge_available: available,
        message,
    }
}
pub fn request_permission(app: &AppHandle) -> Result<Permission, String> {
    if !matches!(
        app.notification().permission_state(),
        Ok(tauri::plugin::PermissionState::Granted)
    ) {
        app.notification()
            .request_permission()
            .map_err(|_| crate::i18n::t(app, "notification.permissionRequestFailed"))?;
    }
    Ok(permission(app))
}
pub fn send_test(app: &AppHandle, sound: bool) -> Result<(), String> {
    // Swiph3l: The user's explicit test must work independently of provider unread and focus suppression.
    let mut permission = permission(app);
    if !permission.granted {
        permission = request_permission(app)?;
    }
    if !permission.granted {
        return Err(permission.message);
    }
    show(
        app,
        "ChatPlus Desktop",
        &crate::i18n::t(app, "notification.testBody"),
        sound,
        None,
        0,
    )
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
pub fn preview(
    mode: &NotificationPreview,
    title: &str,
    body: &str,
    language: &crate::state::Language,
) -> (String, String) {
    let clean = |value: &str, limit| {
        value
            .chars()
            .filter(|c| !c.is_control() || *c == '\n')
            .take(limit)
            .collect::<String>()
    };
    match mode {
        NotificationPreview::Full => (clean(title, 160), clean(body, 500)),
        NotificationPreview::Sender => (
            clean(title, 160),
            crate::i18n::text(language, "notification.newMessage"),
        ),
        NotificationPreview::Generic => (
            "ChatPlus Desktop".into(),
            crate::i18n::text(language, "notification.genericBody"),
        ),
    }
}
pub fn should_notify(enabled: bool, granted: bool, focused: bool) -> bool {
    enabled && granted && !focused
}

fn suppression_reason(
    enabled: bool,
    granted: bool,
    service_notifications: bool,
    focused: bool,
) -> Option<crate::diagnostics::NotificationReason> {
    use crate::diagnostics::NotificationReason as Reason;
    if !service_notifications {
        Some(Reason::ServiceMuted)
    } else if !enabled {
        Some(Reason::GlobalDisabled)
    } else if !granted {
        Some(Reason::PermissionDenied)
    } else if !should_notify(enabled, granted, focused) {
        Some(Reason::ConversationViewed)
    } else {
        None
    }
}
pub fn deliver_for(
    app: &AppHandle,
    id: &str,
    title: &str,
    body: &str,
    _tag: &str,
    identity: &str,
    first_observation: bool,
    generation: u64,
    provider_viewed: bool,
    arrival_generation: u64,
) -> bool {
    let settings = crate::state::current(app);
    use crate::diagnostics::{
        notification, NotificationEvent as Event, NotificationReason as Reason,
    };
    let suppress = |reason| {
        notification(app, id, Event::ToastSuppressed, reason, arrival_generation);
        false
    };
    let Some(config) = settings.services.iter().find(|s| s.id == id && s.enabled) else {
        return false;
    };
    let focused = crate::unread::actively_viewed(app, id, generation, provider_viewed);
    // Swiph3l: A trusted live browser notification is already an incoming event; a post-navigation delay silently drops real messages.
    if let Some(reason) = suppression_reason(
        settings.desktop_notifications,
        permission(app).granted,
        config.notifications && config.provider.definition().notifications,
        focused,
    ) {
        return suppress(reason);
    }
    // Swiph3l: Distinct messages remain eligible even in the same conversation;
    // only exact native event identity deduplicates delivery, never a cooldown.
    let duplicate = event_key(&format!("{id}:{identity}"));
    let at = Instant::now();
    let reserved = {
        let service = app.state::<Service>();
        let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
        reserve_delivery(&mut tracking, duplicate, at, first_observation)
    };
    // Swiph3l: Diagnostics can query the native window; release delivery tracking
    // before crossing that UI boundary so another callback cannot deadlock on it.
    if !reserved {
        return suppress(Reason::DuplicateEvent);
    }
    let (title, body) = preview(
        &settings.notification_preview,
        title,
        body,
        &settings.language,
    );
    let result = show(
        app,
        &title,
        &body,
        settings.notification_sound,
        Some(id.to_string()),
        arrival_generation,
    );
    let service = app.state::<Service>();
    let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
    if result.is_err() {
        // Swiph3l: Failed native delivery must release only its own reservation so a retry is possible without undoing a newer event.
        release_failed_delivery(&mut tracking, duplicate, at);
    }
    if result.is_ok() {
        tracking.retryable.remove(&duplicate);
    }
    tracking.last_status = if result.is_ok() {
        crate::i18n::t(app, "notification.submitSuccess")
    } else {
        crate::i18n::t(app, "notification.submitFailed")
    };
    drop(tracking);
    if result.is_err() {
        let _ = app.emit_to("main", "notification-issue", ());
    }
    notification(
        app,
        id,
        if result.is_ok() {
            Event::ToastSubmitted
        } else {
            Event::ToastSuppressed
        },
        if result.is_ok() {
            Reason::NativeSubmission
        } else {
            Reason::SubmitFailed
        },
        arrival_generation,
    );
    result.is_ok()
}

fn reserve_delivery(
    tracking: &mut Tracking,
    duplicate: u64,
    at: Instant,
    first_observation: bool,
) -> bool {
    tracking
        .retryable
        .retain(|_, failed| at.duration_since(*failed) < Duration::from_secs(5));
    // Swiph3l: Repeated callbacks are never new messages; only a previously failed native submission may retry delivery.
    if !first_observation && !tracking.retryable.contains_key(&duplicate) {
        return false;
    }
    !duplicate_suppressed(tracking, duplicate, at)
}

fn release_failed_delivery(tracking: &mut Tracking, duplicate: u64, at: Instant) {
    if tracking.duplicates.get(&duplicate) == Some(&at) {
        tracking.duplicates.remove(&duplicate);
    }
    tracking.retryable.insert(duplicate, at);
}

fn event_key(identity: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    identity.hash(&mut hasher);
    hasher.finish()
}
#[cfg(windows)]
fn show(
    app: &AppHandle,
    title: &str,
    body: &str,
    sound: bool,
    service_id: Option<String>,
    arrival_generation: u64,
) -> Result<(), String> {
    // Swiph3l: The desktop plugin drops activation callbacks/errors; use its WinRT backend once for routing and explicit silence.
    use tauri_winrt_notification::{Sound, Toast};
    let handle = app.clone();
    Toast::new(&app.config().identifier)
        .title(title)
        .text1(body)
        .sound(if sound { Some(Sound::IM) } else { None })
        .on_activated(move |_| {
            let app = handle.clone();
            let id = service_id.clone();
            let dispatcher = app.clone();
            let _ = dispatcher.run_on_main_thread(move || {
                // Swiph3l: WinRT activation is off-thread; restore and WebView activation must run on the existing UI thread.
                if let Some(id) = id.as_deref() {
                    crate::diagnostics::notification(
                        &app,
                        id,
                        crate::diagnostics::NotificationEvent::ToastActivated,
                        crate::diagnostics::NotificationReason::ExistingWindow,
                        arrival_generation,
                    );
                }
                let _ = crate::window::activate_notification(&app, id.as_deref());
            });
            Ok(())
        })
        .show()
        .map_err(|_| crate::i18n::t(app, "notification.showWindowsFailed"))
}
#[cfg(not(windows))]
fn show(
    app: &AppHandle,
    title: &str,
    body: &str,
    sound: bool,
    _service_id: Option<String>,
    _arrival_generation: u64,
) -> Result<(), String> {
    let mut builder = app.notification().builder().title(title).body(body);
    if sound {
        builder = builder.sound("message-new-instant");
    }
    builder
        .show()
        .map_err(|_| crate::i18n::t(app, "notification.showFailed"))
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
pub fn taskbar(window: &tauri::Window, unread: &crate::unread::Unread) {
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
    fn consecutive_distinct_messages_in_one_conversation_both_deliver_and_duplicates_do_not() {
        let mut tracking = Tracking::default();
        let at = Instant::now();
        let first = event_key("service:room:message-1");
        let second = event_key("service:room:message-2");
        assert!(reserve_delivery(&mut tracking, first, at, true));
        assert!(reserve_delivery(
            &mut tracking,
            second,
            at + Duration::from_millis(1),
            true
        ));
        assert!(!reserve_delivery(
            &mut tracking,
            first,
            at + Duration::from_millis(2),
            false
        ));
        assert!(!reserve_delivery(
            &mut tracking,
            second,
            at + Duration::from_secs(6),
            false
        ));
    }
    #[test]
    fn selected_user_a_or_other_service_minimized_native_event_is_toast_eligible_for_all_three_providers(
    ) {
        for provider in [
            crate::providers::ProviderId::SynologyChatplus,
            crate::providers::ProviderId::SynologyChat,
            crate::providers::ProviderId::Discord,
        ] {
            for selected in ["origin", "other"] {
                let focused =
                    selected == "origin" && crate::window::foreground_state(true, true, true);
                assert!(provider.definition().notifications && should_notify(true, true, focused), "{provider:?}/{selected}: retained WebView focus cannot suppress a minimized notification");
                let mut tracking = Tracking::default();
                let at = Instant::now();
                assert!(suppression_reason(
                    true,
                    true,
                    provider.definition().notifications,
                    focused
                )
                .is_none());
                assert!(
                    reserve_delivery(&mut tracking, 1, at, true),
                    "a first User A event must reach native submission policy"
                );
                assert!(!reserve_delivery(&mut tracking, 1, at, false));
            }
        }
    }
    #[test]
    fn exact_event_reservations_are_scoped_to_service() {
        let mut tracking = Tracking::default();
        let at = Instant::now();
        let alpha = event_key("service-a:room:message");
        let beta = event_key("service-b:room:message");
        assert!(reserve_delivery(&mut tracking, alpha, at, true));
        assert!(!reserve_delivery(
            &mut tracking,
            alpha,
            at + Duration::from_secs(1),
            false
        ));
        assert!(reserve_delivery(&mut tracking, beta, at, true));
        assert!(!reserve_delivery(
            &mut tracking,
            alpha,
            at + Duration::from_secs(7),
            false
        ));
    }
    #[test]
    fn privacy_modes_never_leak_body_when_hidden() {
        assert_eq!(
            preview(
                &NotificationPreview::Full,
                "Sender - chat",
                "private text",
                &crate::state::Language::En
            ),
            ("Sender - chat".into(), "private text".into())
        );
        assert_eq!(
            preview(
                &NotificationPreview::Sender,
                "Sender - chat",
                "private text",
                &crate::state::Language::En,
            ),
            ("Sender - chat".into(), "New message".into())
        );
        assert_eq!(
            preview(
                &NotificationPreview::Generic,
                "Sender - chat",
                "private text",
                &crate::state::Language::En,
            ),
            ("ChatPlus Desktop".into(), "You have a new message.".into())
        );
    }
    #[test]
    fn permission_and_real_foreground_gate_notifications_without_a_startup_delay() {
        use crate::diagnostics::NotificationReason as Reason;
        assert!(suppression_reason(true, true, true, false).is_none());
        assert!(matches!(
            suppression_reason(false, true, true, false),
            Some(Reason::GlobalDisabled)
        ));
        assert!(matches!(
            suppression_reason(true, false, true, false),
            Some(Reason::PermissionDenied)
        ));
        assert!(matches!(
            suppression_reason(true, true, false, false),
            Some(Reason::ServiceMuted)
        ));
        assert!(matches!(
            suppression_reason(true, true, true, true),
            Some(Reason::ConversationViewed)
        ));
        assert!(should_notify(true, true, false));
        assert!(!should_notify(true, true, true));
        for values in [(false, true, false), (true, false, false)] {
            assert!(!should_notify(values.0, values.1, values.2));
        }
    }

    #[test]
    fn distinct_message_events_with_identical_content_are_not_deduplicated() {
        let mut tracking = Tracking::default();
        let at = Instant::now();
        let first = event_key("service:browser-event:timestamp-1");
        let next = event_key("service:browser-event:timestamp-2");
        assert!(reserve_delivery(&mut tracking, first, at, true));
        assert!(!reserve_delivery(
            &mut tracking,
            first,
            at + Duration::from_secs(1),
            false
        ));
        assert!(reserve_delivery(
            &mut tracking,
            next,
            at + Duration::from_secs(1),
            true
        ));
        assert!(
            !reserve_delivery(&mut tracking, first, at + Duration::from_secs(5), false),
            "a duplicate callback never becomes a new message when history expires"
        );
    }

    #[test]
    fn failed_delivery_can_retry_without_releasing_a_newer_event_reservation() {
        let mut tracking = Tracking::default();
        let at = Instant::now();
        assert!(reserve_delivery(&mut tracking, 1, at, true));
        release_failed_delivery(&mut tracking, 1, at);
        assert!(reserve_delivery(&mut tracking, 1, at, false));
        let newer = at + Duration::from_secs(1);
        tracking.duplicates.insert(1, newer);
        assert!(reserve_delivery(&mut tracking, 2, newer, true));
        release_failed_delivery(&mut tracking, 1, at);
        assert_eq!(tracking.duplicates.get(&1), Some(&newer));
        assert_eq!(tracking.duplicates.get(&2), Some(&newer));
        assert!(!reserve_delivery(&mut tracking, 1, newer, false));
    }
    #[test]
    fn duplicate_event_delivery_requires_a_failed_reservation_even_after_delivery_history_expires()
    {
        let mut tracking = Tracking::default();
        let at = Instant::now();
        assert!(reserve_delivery(&mut tracking, 1, at, true));
        assert!(!reserve_delivery(
            &mut tracking,
            1,
            at + Duration::from_secs(6),
            false
        ));
        assert!(
            !reserve_delivery(&mut tracking, 3, at + Duration::from_secs(6), false),
            "a muted or focus-suppressed original event cannot become a new notification later"
        );
        assert!(reserve_delivery(
            &mut tracking,
            3,
            at + Duration::from_secs(6),
            true
        ));
        let failed = at + Duration::from_secs(6);
        release_failed_delivery(&mut tracking, 3, failed);
        assert!(reserve_delivery(
            &mut tracking,
            3,
            failed + Duration::from_secs(1),
            false
        ));
        tracking.retryable.remove(&3);
        assert!(!reserve_delivery(
            &mut tracking,
            3,
            failed + Duration::from_secs(7),
            false
        ));
    }
}

fn duplicate_suppressed(tracking: &mut Tracking, key: u64, at: Instant) -> bool {
    // Swiph3l: Keep a bounded event-identity history independent of user cooldown; duplicate callbacks do not extend their lifetime.
    tracking
        .duplicates
        .retain(|_, seen| at.duration_since(*seen) < Duration::from_secs(5));
    if tracking.duplicates.contains_key(&key) {
        return true;
    }
    tracking.duplicates.insert(key, at);
    false
}
