//! Related provider windows preserve the browser's request, opener and profile.
use crate::{providers::ServiceConfig, state};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{webview::NewWindowResponse, AppHandle, Manager};

const MAX_POPUPS: usize = 8;
static NEXT: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub struct Service(Mutex<HashMap<String, ServiceConfig>>);

impl Service {
    fn reserve(&self, owner: &ServiceConfig) -> Option<String> {
        let mut owners = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if owners.len() >= MAX_POPUPS {
            return None;
        }
        let label = format!("attachment-{}", NEXT.fetch_add(1, Ordering::Relaxed));
        owners.insert(label.clone(), owner.clone());
        Some(label)
    }

    fn forget(&self, label: &str) {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(label);
    }
}

pub fn allowed(service: &ServiceConfig, target: &url::Url) -> bool {
    target.as_str() == "about:blank"
        || service.provider.allows(&service.url, target)
        || crate::navigation::authentication_document(service, target)
        || crate::downloads::attachment_popup(service, target)
}

pub fn is_popup_label(label: &str) -> bool {
    label.strip_prefix("attachment-").is_some_and(|serial| {
        !serial.is_empty() && serial.bytes().all(|byte| byte.is_ascii_digit())
    })
}

fn stale_owner_labels(
    owners: &HashMap<String, ServiceConfig>,
    settings: &state::Settings,
) -> Vec<String> {
    owners
        .iter()
        .filter(|(_, owner)| !crate::services::configured_identity(settings, owner))
        .map(|(label, _)| label.clone())
        .collect()
}

fn forget(app: &AppHandle, label: &str) {
    app.state::<Service>().forget(label);
}

/// Close all windows for a removed, disabled or replaced session. A name or
/// preference change keeps the same session, and switching accounts keeps each
/// account's independent related windows alive.
pub fn reconcile(app: &AppHandle) -> Result<(), String> {
    let settings = state::current(app);
    let labels = stale_owner_labels(
        &app.state::<Service>()
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner()),
        &settings,
    );
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            // Destroyed callbacks remove ownership. Never hold the registry lock
            // across native calls, which may synchronously deliver those events.
            window
                .destroy()
                .or_else(|_| window.close())
                .map_err(|_| "Settings saved. Restart to close outdated service windows.")?;
        }
        // A reserved window may still be inside build() and absent from Manager.
        // Keep its slot until create() rechecks the owner and releases failure.
    }
    Ok(())
}

/// Both the provider and every related child use the browser's original new
/// window request. Replaying the URL with navigate() would lose POST data and
/// the new WindowProxy, including an initially blank authentication window.
pub fn request(
    app: &AppHandle,
    service: &ServiceConfig,
    target: &url::Url,
    features: tauri::webview::NewWindowFeatures,
    source_window: &str,
) -> NewWindowResponse<tauri::Wry> {
    if !crate::services::configured(app, service) {
        return NewWindowResponse::Deny;
    }
    if !allowed(service, target) {
        crate::services::external(app, service, target, source_window);
        return NewWindowResponse::Deny;
    }
    // WebView creation pumps native messages and can reenter this callback before
    // Manager registers the window. Reserve its owner/slot before any native call.
    let Some(label) = app.state::<Service>().reserve(service) else {
        crate::shell::report(app, "Close a service window before opening another.".into());
        return NewWindowResponse::Deny;
    };
    match create(app, service, features, label.clone()) {
        Ok(window) => NewWindowResponse::Create { window },
        Err(_) => {
            // build/setup can fail before Destroyed is installed or delivered.
            // This is also safe after a synchronous Destroyed callback.
            forget(app, &label);
            crate::shell::report(app, "Could not open the service window. Try again.".into());
            NewWindowResponse::Deny
        }
    }
}

fn popup_background(theme: &state::Theme, system: tauri::Theme) -> tauri::window::Color {
    crate::shell::themed_background_color(theme, system)
}

/// Update only app-owned chrome/default canvas, never provider or PDF document CSS.
pub fn apply_popup_appearance(
    window: &tauri::WebviewWindow,
    theme: &state::Theme,
) -> tauri::Result<()> {
    if !is_popup_label(window.label()) {
        return Ok(());
    }
    // This auxiliary frame has no menu. Native per-window theme updates are safe
    // here without changing the main window's menu/theme lifecycle.
    window.set_theme(theme.native())?;
    window.set_background_color(Some(popup_background(theme, window.theme()?)))?;
    window.set_title(&crate::i18n::t(
        window.app_handle(),
        "window.attachmentTitle",
    ))
}

#[cfg(windows)]
fn attach_script_close(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use std::sync::{atomic::AtomicBool, Arc};
    use webview2_com::WindowCloseRequestedEventHandler;

    let installed = Arc::new(AtomicBool::new(false));
    let confirmed = installed.clone();
    let app = window.app_handle().clone();
    let label = window.label().to_owned();
    window.with_webview(move |view| unsafe {
        let result = (|| -> windows::core::Result<()> {
            let core = view.controller().CoreWebView2()?;
            core.add_WindowCloseRequested(
                &WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                    // Wry closes its child HWND for window.close(), leaving the
                    // Tauri frame alive. destroy() queues a runtime event rather
                    // than destroying the WebView inside this COM callback.
                    if let Some(window) = app.get_webview_window(&label) {
                        let _ = window.destroy();
                    }
                    Ok(())
                })),
                &mut 0,
            )
        })();
        confirmed.store(result.is_ok(), Ordering::Release);
    })?;
    // create() runs on the UI thread, where with_webview executes inline. Require
    // actual handler installation, not merely successful callback scheduling.
    if !installed.load(Ordering::Acquire) {
        return Err(std::io::Error::other("Could not observe service window closing.").into());
    }
    Ok(())
}

fn create(
    app: &AppHandle,
    service: &ServiceConfig,
    features: tauri::webview::NewWindowFeatures,
    label: String,
) -> tauri::Result<tauri::WebviewWindow> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let configured = service.clone();
    let popup_service = service.clone();
    let nav_app = app.clone();
    let popup_app = app.clone();
    let popup_label = label.clone();
    let nav_label = label.clone();
    let theme = state::current(app).theme;
    let system = app
        .get_window("main")
        .and_then(|window| window.theme().ok())
        .unwrap_or(tauri::Theme::Light);
    let center = features.position().is_none();
    let mut builder = WebviewWindowBuilder::new(
        app,
        label.clone(),
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title(crate::i18n::t(app, "window.attachmentTitle"))
    .visible(false)
    .theme(theme.native())
    .background_color(popup_background(&theme, system))
    .inner_size(900., 650.)
    // Defaults precede opener features so explicit size/position survive. The
    // actual opener supplies the related environment/configuration on each OS.
    .window_features(features)
    .on_navigation(move |target| {
        if !crate::services::configured(&nav_app, &configured) {
            return false;
        }
        if allowed(&configured, target) {
            true
        } else {
            crate::services::external(&nav_app, &configured, target, &nav_label);
            false
        }
    })
    .on_new_window(move |target, features| {
        request(&popup_app, &popup_service, &target, features, &popup_label)
    });
    if center {
        builder = builder.center();
    }
    #[cfg(windows)]
    if let Some(main) = app.get_window("main") {
        builder = builder.owner_raw(main.hwnd()?);
    }
    let window = builder.build()?;
    let event_app = app.clone();
    let themed_window = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Destroyed => forget(&event_app, &label),
        tauri::WindowEvent::ThemeChanged(system) => {
            if state::current(&event_app).theme == state::Theme::System {
                // No provider CSS reinjection or recursive set_theme call.
                let _ = themed_window
                    .set_background_color(Some(popup_background(&state::Theme::System, *system)));
            }
        }
        _ => {}
    });
    let setup = (|| -> tauri::Result<()> {
        // Configure chrome before the initially blank related view is visible.
        // Do not inherit the desktop's File/View/Window/Help menu.
        #[cfg(not(target_os = "macos"))]
        window.remove_menu()?;
        #[cfg(windows)]
        attach_script_close(&window)?;
        apply_popup_appearance(&window, &theme)?;
        crate::downloads::attach(app, window.as_ref(), &service.id)?;
        // A settings worker may have invalidated this owner while build() ran.
        // Ownership was reserved before build(), so reconciliation sees pending
        // windows as well; stale pending windows are destroyed at this check.
        if !crate::services::configured(app, service) {
            return Err(std::io::Error::other("The originating service changed.").into());
        }
        window.show()
    })();
    if let Err(error) = setup {
        // build() registered this hidden window; dropping a handle cannot close it.
        if window.destroy().is_err() {
            let _ = window.close();
        }
        return Err(error);
    }
    Ok(window)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{NotificationColor, ProviderId};

    fn service(id: &str) -> ServiceConfig {
        ServiceConfig {
            id: id.into(),
            provider: ProviderId::SynologyChatplus,
            name: id.into(),
            url: "https://chat.example.com/chat/".into(),
            enabled: true,
            notifications: true,
            notification_color: NotificationColor::Auto,
        }
    }

    #[test]
    fn attachment_canvas_respects_explicit_and_system_theme_without_touching_document_content() {
        use state::Theme;
        for (theme, system, expected) in [
            (Theme::Dark, tauri::Theme::Light, (22, 26, 32, 255)),
            (Theme::Light, tauri::Theme::Dark, (246, 247, 249, 255)),
            (Theme::Retro, tauri::Theme::Dark, (192, 192, 192, 255)),
            (Theme::Retro, tauri::Theme::Light, (192, 192, 192, 255)),
            (Theme::System, tauri::Theme::Dark, (22, 26, 32, 255)),
            (Theme::System, tauri::Theme::Light, (246, 247, 249, 255)),
        ] {
            let color = popup_background(&theme, system);
            assert_eq!((color.0, color.1, color.2, color.3), expected);
        }
    }

    #[test]
    fn attachment_chrome_updates_are_scoped_to_app_generated_popup_labels() {
        for label in ["attachment-0", "attachment-123"] {
            assert!(is_popup_label(label));
        }
        for label in [
            "main",
            "settings",
            "service-attachment-1",
            "external-link-1",
            "attachment-",
            "attachment-private",
        ] {
            assert!(!is_popup_label(label));
        }
    }

    #[test]
    fn provider_popup_keeps_same_origin_authentication_without_allowing_external_or_opaque_targets()
    {
        let service = service("first");
        for target in [
            "about:blank",
            "https://chat.example.com/attachment?id=opaque",
            "blob:https://chat.example.com/opaque",
        ] {
            assert!(allowed(&service, &target.parse().unwrap()), "{target}");
        }
        for target in [
            "https://other.example.com/file.pdf",
            "https://chat.example.com.evil.example/file.pdf",
            "blob:null/opaque",
            "blob:https://other.example.com/opaque",
            "file:///file.pdf",
            "data:text/html,hello",
        ] {
            assert!(!allowed(&service, &target.parse().unwrap()), "{target}");
        }
    }

    #[test]
    fn messenger_verification_popup_keeps_google_and_facebook_in_the_related_session() {
        let mut messenger = service("messenger");
        messenger.provider = ProviderId::Messenger;
        messenger.url = "https://www.facebook.com/messages/".into();
        for target in [
            "about:blank",
            "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic",
            "https://accounts.google.com/v3/signin/challenge/pwd?state=synthetic",
            "https://www.facebook.com/checkpoint/?state=synthetic",
        ] {
            assert!(allowed(&messenger, &target.parse().unwrap()), "{target}");
        }
        for target in [
            "http://accounts.google.com/",
            "https://accounts.google.com:444/",
            "https://accounts.google.com.evil.example/",
            "https://user:secret@accounts.google.com/",
            "https://www.google.com/",
            "blob:https://accounts.google.com/opaque",
        ] {
            assert!(!allowed(&messenger, &target.parse().unwrap()), "{target}");
        }
        assert!(!allowed(
            &service("other-provider"),
            &"https://accounts.google.com/".parse().unwrap()
        ));
    }

    #[test]
    fn popup_limit_includes_pending_builds_and_failed_creation_releases_its_slot() {
        let registry = Service::default();
        let owner = service("first");
        // None of these windows has reached build()/Manager registration yet.
        let labels: Vec<_> = (0..MAX_POPUPS)
            .map(|_| registry.reserve(&owner).unwrap())
            .collect();
        assert!(labels.iter().all(|label| is_popup_label(label)));
        assert!(registry.reserve(&service("second")).is_none());
        // The same release path serves failed creation and Destroyed. Duplicate
        // callbacks for the old window must never release another owner's slot.
        registry.forget(&labels[3]);
        registry.forget(&labels[3]);
        let replacement = registry.reserve(&service("second")).unwrap();
        assert!(!labels.contains(&replacement));
        registry.forget(&labels[3]);
        assert!(registry.reserve(&owner).is_none());
        registry.forget(&replacement);
        assert!(registry.reserve(&owner).is_some());
    }

    #[test]
    fn popup_cleanup_tracks_exact_session_and_preserves_other_accounts_and_preferences() {
        let first = service("first");
        let second = service("second");
        let owners = HashMap::from([
            ("attachment-0".into(), first.clone()),
            ("attachment-1".into(), first.clone()),
            ("attachment-2".into(), second.clone()),
        ]);
        let settings = state::Settings {
            services: vec![first, second],
            active_service: Some("first".into()),
            ..Default::default()
        };
        let mut renamed = settings.clone();
        renamed.services[0].name = "New display name".into();
        renamed.services[0].notifications = false;
        renamed.active_service = Some("second".into());
        assert!(stale_owner_labels(&owners, &renamed).is_empty());
        for change in 0..4 {
            let mut changed = settings.clone();
            match change {
                0 => {
                    changed.services.remove(0);
                }
                1 => changed.services[0].enabled = false,
                2 => changed.services[0].url = "https://new.example.com/chat/".into(),
                _ => changed.services[0].provider = ProviderId::SynologyChat,
            }
            let mut stale = stale_owner_labels(&owners, &changed);
            stale.sort();
            assert_eq!(stale, ["attachment-0", "attachment-1"], "change {change}");
        }
    }
}
