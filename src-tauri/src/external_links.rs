//! Provider links leave ChatPlus only after a fresh, bundled local confirmation.
use crate::{navigation, providers::ServiceConfig, state};
use serde::Serialize;
use std::{
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_opener::OpenerExt;

const LABEL: &str = "external-link";
const PROMPT_LIFETIME: Duration = Duration::from_secs(5 * 60);

#[derive(Default)]
pub struct Service(Mutex<Option<Pending>>);

#[derive(Clone)]
struct Context {
    service: ServiceConfig,
    target: url::Url,
    display: navigation::ExternalTarget,
    parent: tauri::Window,
    source: tauri::Webview,
    source_url: url::Url,
}

struct Pending {
    request_id: String,
    context: Context,
    created: Instant,
    built: bool,
    mounted: bool,
    shown: bool,
    parent_disabled: bool,
    finished: mpsc::Sender<()>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptPayload {
    request_id: String,
    url: String,
    origin: String,
    insecure_http: bool,
    theme: state::Theme,
    language: state::Language,
}

fn permitted(settings: &state::Settings, service: &ServiceConfig, target: &url::Url) -> bool {
    settings.external_links
        && settings.services.iter().any(|current| {
            current.enabled
                && current.id == service.id
                && current.provider == service.provider
                && current.url == service.url
        })
        && navigation::external_target(target).is_some()
}

fn open_confirmed(
    accepted: bool,
    settings: &state::Settings,
    service: &ServiceConfig,
    target: &url::Url,
    open: impl FnOnce(&str) -> Result<(), ()>,
) -> Result<(), ()> {
    if accepted && permitted(settings, service, target) {
        open(target.as_str())?;
    }
    Ok(())
}

pub fn request(app: &AppHandle, service: &ServiceConfig, target: &url::Url, source_window: &str) {
    if !permitted(&state::current(app), service, target) {
        return;
    }
    let Some(display) = navigation::external_target(target) else {
        return;
    };
    let Some(parent) = app.get_window(source_window) else {
        return;
    };
    let source_label = if source_window == "main" {
        crate::services::label(&service.id)
    } else {
        source_window.into()
    };
    let Some(source) = app.get_webview(&source_label) else {
        return;
    };
    let Ok(source_url) = source.url() else {
        return;
    };
    let Ok(target) = url::Url::parse(&display.url) else {
        return;
    };
    let Ok(request_id) = request_id() else {
        failed(app);
        return;
    };
    let context = Context {
        service: service.clone(),
        target,
        display,
        parent,
        source,
        source_url,
    };
    if !context_live(app, &context) {
        return;
    }
    let (finished, receiver) = mpsc::channel();
    let pending = Pending {
        request_id: request_id.clone(),
        context,
        created: Instant::now(),
        built: false,
        mounted: false,
        shown: false,
        parent_disabled: false,
        finished,
    };
    {
        let service = app.state::<Service>();
        let mut slot = service.0.lock().unwrap_or_else(|error| error.into_inner());
        // Swiph3l: Duplicate navigation/popup callbacks cannot stack dialogs, and
        // a later click cannot reuse an earlier request's destination or approval.
        if slot.is_some() || app.get_webview_window(LABEL).is_some() {
            return;
        }
        *slot = Some(pending);
    }
    let handle = app.clone();
    let worker_id = request_id.clone();
    // Swiph3l: Build on a worker after NavigationStarting returns. Waiting for a
    // local WebView on the originating UI callback can deadlock WebView2 startup.
    if std::thread::Builder::new()
        .name("external-link-confirmation".into())
        .spawn(move || {
            if create_window(&handle, &worker_id).is_err() {
                cancel(&handle, &worker_id);
                failed(&handle);
                return;
            }
            loop {
                match receiver.recv_timeout(Duration::from_secs(1)) {
                    Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        // Swiph3l: Main can close to tray without being destroyed.
                        // Cancel a hidden/changed source instead of leaving its owner disabled.
                        if !pending_context(&handle, Some(&worker_id))
                            .is_some_and(|context| context_live(&handle, &context))
                        {
                            cancel(&handle, &worker_id);
                            break;
                        }
                    }
                }
            }
        })
        .is_err()
    {
        cancel(app, &request_id);
        failed(app);
    }
}

fn failed(app: &AppHandle) {
    crate::shell::report(app, crate::i18n::t(app, "externalLink.failed"));
}

fn context_live(app: &AppHandle, context: &Context) -> bool {
    permitted(&state::current(app), &context.service, &context.target)
        && context.parent.is_visible().unwrap_or(false)
        && !context.parent.is_minimized().unwrap_or(true)
        && context.source.url().is_ok_and(|source| {
            source_matches(
                &context.service,
                context.parent.label() == "main",
                &context.source_url,
                &source,
            )
        })
}

fn source_matches(
    service: &ServiceConfig,
    main: bool,
    expected: &url::Url,
    current: &url::Url,
) -> bool {
    current == expected
        && if main {
            navigation::provider_document(service, current)
        } else {
            crate::downloads::popup_allowed(service, current)
        }
}

fn pending_context(app: &AppHandle, request_id: Option<&str>) -> Option<Context> {
    let service = app.state::<Service>();
    let pending = service.0.lock().unwrap_or_else(|error| error.into_inner());
    pending
        .as_ref()
        .filter(|pending| {
            request_id.is_none_or(|id| id == pending.request_id)
                && pending.created.elapsed() < PROMPT_LIFETIME
        })
        .map(|pending| pending.context.clone())
}

pub fn prompt(app: &AppHandle) -> Result<PromptPayload, String> {
    let service = app.state::<Service>();
    let (request_id, context) = {
        let pending = service.0.lock().unwrap_or_else(|error| error.into_inner());
        let pending = pending
            .as_ref()
            .filter(|pending| pending.created.elapsed() < PROMPT_LIFETIME)
            .ok_or("External-link request is no longer available.")?;
        (pending.request_id.clone(), pending.context.clone())
    };
    if !context_live(app, &context) {
        cancel(app, &request_id);
        return Err("External-link request is no longer available.".into());
    }
    let settings = state::current(app);
    Ok(PromptPayload {
        request_id,
        url: context.display.url,
        origin: context.display.origin,
        insecure_http: context.display.insecure_http,
        theme: settings.theme,
        language: settings.language,
    })
}

pub fn ready(app: &AppHandle, request_id: &str) -> Result<(), String> {
    if pending_context(app, Some(request_id)).is_none() {
        return Err("External-link request is no longer available.".into());
    }
    let handle = app.clone();
    let request_id = request_id.to_owned();
    app.run_on_main_thread(move || {
        {
            let service = handle.state::<Service>();
            let mut slot = service.0.lock().unwrap_or_else(|error| error.into_inner());
            if let Some(pending) = slot
                .as_mut()
                .filter(|pending| pending.request_id == request_id)
            {
                pending.mounted = true;
            }
        }
        show_if_ready(&handle, &request_id);
    })
    .map_err(|_| "Could not display the external-link confirmation.".into())
}

fn show_if_ready(app: &AppHandle, request_id: &str) {
    let context = {
        let service = app.state::<Service>();
        let mut slot = service.0.lock().unwrap_or_else(|error| error.into_inner());
        let Some(pending) = slot
            .as_mut()
            .filter(|pending| pending.request_id == request_id)
        else {
            return;
        };
        if !mark_shown(pending.built, pending.mounted, &mut pending.shown) {
            return;
        }
        pending.context.clone()
    };
    let Some(window) = app.get_webview_window(LABEL) else {
        complete(app, request_id, false);
        return;
    };
    if !context_live(app, &context) || !context.parent.is_enabled().unwrap_or(false) {
        complete(app, request_id, false);
        return;
    }
    if context.parent.set_enabled(false).is_err() {
        complete(app, request_id, false);
        failed(app);
        return;
    }
    {
        let service = app.state::<Service>();
        let mut slot = service.0.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(pending) = slot
            .as_mut()
            .filter(|pending| pending.request_id == request_id)
        {
            pending.parent_disabled = true;
        }
    }
    if crate::window::focus(&window.as_ref().window()).is_err() {
        complete(app, request_id, false);
        failed(app);
        return;
    }
    if state::current(app).notification_sound {
        crate::platform::gentle_prompt_sound();
    }
}

pub fn respond(app: &AppHandle, request_id: &str, accepted: bool) -> Result<(), String> {
    if pending_context(app, Some(request_id)).is_none() {
        return Err("External-link request is no longer available.".into());
    }
    let handle = app.clone();
    let request_id = request_id.to_owned();
    app.run_on_main_thread(move || complete(&handle, &request_id, accepted))
        .map_err(|_| "Could not close the external-link confirmation.".into())
}

fn cancel(app: &AppHandle, request_id: &str) {
    let handle = app.clone();
    let request_id = request_id.to_owned();
    let _ = app.run_on_main_thread(move || complete(&handle, &request_id, false));
}

fn take_pending(slot: &mut Option<Pending>, request_id: &str) -> Option<Pending> {
    take_matching(slot, |pending| pending.request_id == request_id)
}

fn take_matching<T>(slot: &mut Option<T>, matches: impl FnOnce(&T) -> bool) -> Option<T> {
    if slot.as_ref().is_some_and(matches) {
        slot.take()
    } else {
        None
    }
}

fn mark_shown(built: bool, mounted: bool, shown: &mut bool) -> bool {
    if !built || !mounted || *shown {
        return false;
    }
    *shown = true;
    true
}

fn complete(app: &AppHandle, request_id: &str, accepted: bool) {
    let pending = {
        let service = app.state::<Service>();
        let mut slot = service.0.lock().unwrap_or_else(|error| error.into_inner());
        take_pending(&mut slot, request_id)
    };
    let Some(pending) = pending else {
        return;
    };
    let valid = accepted
        && pending.shown
        && pending.created.elapsed() < PROMPT_LIFETIME
        && prompt_active(app)
        && context_live(app, &pending.context);
    if pending.parent_disabled {
        let _ = pending.context.parent.set_enabled(true);
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.close();
    }
    let _ = pending.finished.send(());
    // Swiph3l: Consume the one-shot request before any browser launch. Frontend
    // responses carry only a nonce and decision, never a replacement URL.
    if open_confirmed(
        valid,
        &state::current(app),
        &pending.context.service,
        &pending.context.target,
        |url| app.opener().open_url(url, None::<&str>).map_err(|_| ()),
    )
    .is_err()
    {
        failed(app);
    }
}

fn prompt_active(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window(LABEL) else {
        return false;
    };
    if !window.is_visible().unwrap_or(false)
        || !window.is_enabled().unwrap_or(false)
        || window.is_minimized().unwrap_or(true)
    {
        return false;
    }
    #[cfg(windows)]
    return window.hwnd().is_ok_and(|handle| unsafe {
        windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow() == handle
    });
    #[cfg(not(windows))]
    false
}

#[cfg(windows)]
fn request_id() -> Result<String, ()> {
    windows::core::GUID::new()
        .map(|id| format!("{id:?}"))
        .map_err(|_| ())
}

#[cfg(not(windows))]
fn request_id() -> Result<String, ()> {
    Err(())
}

#[cfg(windows)]
fn create_window(app: &AppHandle, request_id: &str) -> Result<(), ()> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let context = pending_context(app, Some(request_id)).ok_or(())?;
    if !context_live(app, &context) {
        return Err(());
    }
    let theme = state::current(app).theme;
    let bootstrap = format!("document.addEventListener('DOMContentLoaded',()=>{{document.documentElement.dataset.theme={}}},{{once:true}})", serde_json::to_string(&theme).map_err(|_| ())?);
    let window = WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::App("index.html?page=external-link".into()),
    )
    .title(crate::i18n::t(app, "externalLink.title"))
    .inner_size(620., 360.)
    .min_inner_size(420., 300.)
    .center()
    .resizable(true)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(true)
    .visible(false)
    .focused(false)
    .theme(theme.native())
    .owner_raw(context.parent.hwnd().map_err(|_| ())?)
    .initialization_script(bootstrap)
    .on_navigation(navigation::local_settings)
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .build()
    .map_err(|_| ())?;
    window.remove_menu().map_err(|_| ())?;
    crate::shell::theme_window(&window, &theme).map_err(|_| ())?;
    let handle = app.clone();
    let close_id = request_id.to_owned();
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
        ) {
            complete(&handle, &close_id, false);
        }
    });
    let handle = app.clone();
    let request_id = request_id.to_owned();
    app.run_on_main_thread(move || {
        {
            let service = handle.state::<Service>();
            let mut slot = service.0.lock().unwrap_or_else(|error| error.into_inner());
            if let Some(pending) = slot
                .as_mut()
                .filter(|pending| pending.request_id == request_id)
            {
                pending.built = true;
            }
        }
        show_if_ready(&handle, &request_id);
    })
    .map_err(|_| ())
}

#[cfg(not(windows))]
fn create_window(_: &AppHandle, _: &str) -> Result<(), ()> {
    Err(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (state::Settings, ServiceConfig, url::Url) {
        let mut settings = state::Settings::default();
        let service = ServiceConfig {
            id: "account-a".into(),
            provider: crate::providers::ProviderId::Whatsapp,
            name: "Account A".into(),
            url: "https://web.whatsapp.com/".into(),
            enabled: true,
            notifications: true,
            notification_color: crate::providers::NotificationColor::Auto,
        };
        settings.external_links = true;
        settings.services = vec![service.clone()];
        (
            settings,
            service,
            "https://example.com/path?value=1".parse().unwrap(),
        )
    }

    #[test]
    fn retained_url_is_rechecked_against_current_preference_and_service() {
        let (mut settings, service, url) = fixture();
        assert!(permitted(&settings, &service, &url));
        settings.external_links = false;
        assert!(!permitted(&settings, &service, &url));
        settings.external_links = true;
        settings.services[0].enabled = false;
        assert!(!permitted(&settings, &service, &url));
        settings.services[0].enabled = true;
        settings.services[0].url = "https://discord.com/app/".into();
        assert!(!permitted(&settings, &service, &url));
        settings.services = vec![service.clone()];
        settings.services[0].id = "account-b".into();
        assert!(!permitted(&settings, &service, &url));
        settings.services.clear();
        assert!(!permitted(&settings, &service, &url));
    }

    #[test]
    fn credentials_and_non_web_schemes_cannot_enter_the_opener_path() {
        let (settings, service, _) = fixture();
        for input in [
            "https://user:secret@example.com/",
            "file:///C:/Windows/system32/cmd.exe",
            "javascript:alert(1)",
            "data:text/html,test",
            "blob:https://web.whatsapp.com/private",
            "ms-settings:notifications",
        ] {
            assert!(!permitted(&settings, &service, &input.parse().unwrap()));
        }
    }

    #[test]
    fn cancelled_or_failed_prompt_releases_only_its_own_pending_slot() {
        let mut slot = Some((
            "request-b",
            "https://example.com/retained?token=exact%2Fvalue",
        ));
        assert!(take_matching(&mut slot, |pending| pending.0 == "request-a").is_none());
        assert!(slot.is_some());
        let accepted = take_matching(&mut slot, |pending| pending.0 == "request-b").unwrap();
        assert_eq!(
            accepted.1,
            "https://example.com/retained?token=exact%2Fvalue"
        );
        assert!(slot.is_none());
        assert!(take_matching(&mut slot, |pending| pending.0 == "request-b").is_none());
        slot = Some(("request-c", "https://example.com/new"));
        assert!(take_matching(&mut slot, |pending| pending.0 == "request-b").is_none());
        assert_eq!(slot.unwrap().0, "request-c");
    }

    #[test]
    fn a_prompt_shows_once_only_after_native_build_and_frontend_mount() {
        let mut shown = false;
        assert!(!mark_shown(false, true, &mut shown));
        assert!(!shown);
        assert!(!mark_shown(true, false, &mut shown));
        assert!(!shown);
        assert!(mark_shown(true, true, &mut shown));
        assert!(shown);
        assert!(!mark_shown(true, true, &mut shown));
    }

    #[test]
    fn prompt_payload_is_a_display_allowlist_not_a_settings_or_source_dump() {
        let payload = PromptPayload {
            request_id: "one-shot-request".into(),
            url: "https://example.com/exact?value=%2F".into(),
            origin: "https://example.com".into(),
            insecure_http: false,
            theme: state::Theme::Dark,
            language: state::Language::Pl,
        };
        let json = serde_json::to_value(payload).unwrap();
        assert_eq!(json.as_object().unwrap().len(), 6);
        assert_eq!(json["url"], "https://example.com/exact?value=%2F");
        assert_eq!(json["theme"], "dark");
        assert_eq!(json["language"], "pl");
        for forbidden in [
            "settings",
            "service",
            "sourceUrl",
            "credentials",
            "profile",
            "command",
        ] {
            assert!(json.get(forbidden).is_none());
        }
    }

    #[test]
    fn approval_requires_the_original_allowed_source_document() {
        let (_, service, _) = fixture();
        let original: url::Url = "https://web.whatsapp.com/".parse().unwrap();
        assert!(source_matches(&service, true, &original, &original));
        assert!(!source_matches(
            &service,
            true,
            &original,
            &"https://web.whatsapp.com/other".parse().unwrap()
        ));
        assert!(!source_matches(
            &service,
            true,
            &original,
            &"https://example.com/".parse().unwrap()
        ));
        let foreign: url::Url = "https://example.com/".parse().unwrap();
        assert!(!source_matches(&service, true, &foreign, &foreign));
        let blank: url::Url = "about:blank".parse().unwrap();
        assert!(!source_matches(&service, true, &blank, &blank));
        assert!(source_matches(&service, false, &blank, &blank));
        let foreign_blob: url::Url = "blob:https://example.com/attachment".parse().unwrap();
        assert!(!source_matches(
            &service,
            false,
            &foreign_blob,
            &foreign_blob
        ));
    }

    #[test]
    fn cancel_never_opens_and_accept_opens_the_exact_retained_url_once() {
        let (settings, service, url) = fixture();
        let opened = std::cell::RefCell::new(Vec::new());
        let opener = |target: &str| {
            opened.borrow_mut().push(target.to_owned());
            Ok(())
        };
        open_confirmed(false, &settings, &service, &url, opener).unwrap();
        assert!(opened.borrow().is_empty());
        open_confirmed(true, &settings, &service, &url, opener).unwrap();
        assert_eq!(*opened.borrow(), vec![url.as_str().to_owned()]);
    }

    #[test]
    fn accepting_a_stale_prompt_never_reopens_removed_or_changed_service() {
        let (mut settings, service, url) = fixture();
        settings.services.clear();
        open_confirmed(true, &settings, &service, &url, |_| panic!("must not open")).unwrap();
        settings.services.push(service.clone());
        settings.external_links = false;
        open_confirmed(true, &settings, &service, &url, |_| panic!("must not open")).unwrap();
        settings.external_links = true;
        assert!(open_confirmed(true, &settings, &service, &url, |_| Err(())).is_err());
    }
}
