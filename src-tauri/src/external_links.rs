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
const TEARDOWN_LIFETIME: Duration = Duration::from_secs(3);

#[derive(Default)]
pub struct Service(Mutex<PromptLifecycle<Pending>>);

struct PromptLifecycle<T> {
    pending: Option<T>,
    retiring: Option<String>,
}

impl<T> Default for PromptLifecycle<T> {
    fn default() -> Self {
        Self {
            pending: None,
            retiring: None,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum CreationGate {
    Ready,
    Waiting,
    Cancelled,
}

impl<T> PromptLifecycle<T> {
    fn reserve(&mut self, pending: T) -> bool {
        if self.pending.is_some() {
            return false;
        }
        self.pending = Some(pending);
        true
    }

    fn creation_gate(&self, matches: impl FnOnce(&T) -> bool, label_present: bool) -> CreationGate {
        if !self.pending.as_ref().is_some_and(matches) {
            CreationGate::Cancelled
        } else if self.retiring.is_some() || label_present {
            CreationGate::Waiting
        } else {
            CreationGate::Ready
        }
    }

    fn frontend_request(
        &self,
        matches: impl FnOnce(&T) -> bool,
        creating: impl FnOnce(&T) -> bool,
    ) -> Option<&T> {
        self.pending
            .as_ref()
            .filter(|pending| self.retiring.is_none() && matches(pending) && creating(pending))
    }

    fn retire(
        &mut self,
        request_id: &str,
        matches: impl FnOnce(&T) -> bool,
        owns_window: impl FnOnce(&T) -> bool,
    ) -> Option<T> {
        let pending = take_matching(&mut self.pending, matches)?;
        if owns_window(&pending) {
            self.retiring = Some(request_id.to_owned());
        }
        Some(pending)
    }

    fn destroyed(&mut self, request_id: &str) {
        if self.retiring.as_deref() == Some(request_id) {
            self.retiring = None;
        }
    }
}

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
    creating: bool,
    window: Option<tauri::WebviewWindow>,
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
        creating: false,
        window: None,
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
        if !slot.reserve(pending) {
            return;
        }
    }
    let handle = app.clone();
    let worker_id = request_id.clone();
    // Swiph3l: Build on a worker after NavigationStarting returns. Waiting for a
    // local WebView on the originating UI callback can deadlock WebView2 startup.
    if std::thread::Builder::new()
        .name("external-link-confirmation".into())
        .spawn(move || {
            if create_window(&handle, &worker_id).is_err() {
                let requested = pending_context(&handle, Some(&worker_id)).is_some();
                cancel(&handle, &worker_id);
                release_unbuilt(&handle, &worker_id);
                if requested {
                    failed(&handle);
                }
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
        .pending
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
            .frontend_request(
                |pending| pending.created.elapsed() < PROMPT_LIFETIME,
                |pending| pending.creating,
            )
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
    if !frontend_request(app, request_id) {
        return Err("External-link request is no longer available.".into());
    }
    let handle = app.clone();
    let request_id = request_id.to_owned();
    app.run_on_main_thread(move || {
        {
            let service = handle.state::<Service>();
            let mut slot = service.0.lock().unwrap_or_else(|error| error.into_inner());
            if let Some(pending) = slot
                .pending
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
            .pending
            .as_mut()
            .filter(|pending| pending.request_id == request_id)
        else {
            return;
        };
        if !mark_shown(pending.built, pending.mounted, &mut pending.shown) {
            return;
        }
        (pending.context.clone(), pending.window.clone())
    };
    let (context, window) = context;
    let Some(window) = window else {
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
            .pending
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
    if !frontend_request(app, request_id) {
        return Err("External-link request is no longer available.".into());
    }
    let handle = app.clone();
    let request_id = request_id.to_owned();
    app.run_on_main_thread(move || complete(&handle, &request_id, accepted))
        .map_err(|_| "Could not close the external-link confirmation.".into())
}

fn frontend_request(app: &AppHandle, request_id: &str) -> bool {
    app.state::<Service>()
        .0
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .frontend_request(
            |pending| {
                pending.request_id == request_id && pending.created.elapsed() < PROMPT_LIFETIME
            },
            |pending| pending.creating,
        )
        .is_some()
}

fn cancel(app: &AppHandle, request_id: &str) {
    let handle = app.clone();
    let request_id = request_id.to_owned();
    let _ = app.run_on_main_thread(move || complete(&handle, &request_id, false));
}

fn cancel_from_close_event(app: &AppHandle, request_id: &str) {
    let handle = app.clone();
    let request_id = request_id.to_owned();
    // Swiph3l: Main-thread dispatch can execute inline. Leave the native close
    // event before consuming/restoring and posting the one explicit destruction.
    let fallback = app.clone();
    let fallback_id = request_id.clone();
    if std::thread::Builder::new()
        .name("external-link-close".into())
        .spawn(move || cancel(&handle, &request_id))
        .is_err()
    {
        cancel(&fallback, &fallback_id);
    }
}

fn release_unbuilt(app: &AppHandle, request_id: &str) {
    let handle = app.clone();
    let request_id = request_id.to_owned();
    let _ = app.run_on_main_thread(move || {
        if handle.get_webview_window(LABEL).is_none() {
            handle
                .state::<Service>()
                .0
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .destroyed(&request_id);
        }
    });
}

fn destroyed(app: &AppHandle, request_id: &str) {
    finish(app, request_id, false, true);
    app.state::<Service>()
        .0
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .destroyed(request_id);
}

fn take_pending(slot: &mut PromptLifecycle<Pending>, request_id: &str) -> Option<Pending> {
    slot.retire(
        request_id,
        |pending| pending.request_id == request_id,
        |pending| pending.creating || pending.window.is_some(),
    )
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
    finish(app, request_id, accepted, false);
}

fn finish(app: &AppHandle, request_id: &str, accepted: bool, already_destroyed: bool) {
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
        && pending.window.as_ref().is_some_and(prompt_active)
        && context_live(app, &pending.context);
    if pending.parent_disabled {
        let _ = pending.context.parent.set_enabled(true);
    }
    if let Some(window) = pending.window.as_ref().filter(|_| !already_destroyed) {
        // Swiph3l: Closing is asynchronous. Destroy this request's exact window
        // once, without generating a second CloseRequested or touching a successor.
        let _ = window.destroy();
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

#[cfg(windows)]
fn claim_creation(app: &AppHandle, request_id: &str) -> Result<(), ()> {
    let started = Instant::now();
    loop {
        let label_present = app.get_webview_window(LABEL).is_some();
        let gate = {
            let service = app.state::<Service>();
            let mut lifecycle = service.0.lock().unwrap_or_else(|error| error.into_inner());
            let gate = lifecycle.creation_gate(
                |pending| {
                    pending.request_id == request_id && pending.created.elapsed() < PROMPT_LIFETIME
                },
                label_present,
            );
            if gate == CreationGate::Ready {
                if let Some(pending) = lifecycle.pending.as_mut() {
                    pending.creating = true;
                }
            }
            gate
        };
        match gate {
            CreationGate::Ready => return Ok(()),
            CreationGate::Cancelled => return Err(()),
            CreationGate::Waiting if started.elapsed() >= TEARDOWN_LIFETIME => return Err(()),
            CreationGate::Waiting => std::thread::sleep(Duration::from_millis(20)),
        }
    }
}

fn prompt_active(window: &tauri::WebviewWindow) -> bool {
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
    // A new click may arrive before Destroyed unregisters the previous fixed
    // label. Retain that click once and wait off-thread instead of discarding it.
    claim_creation(app, request_id)?;
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
    let handle = app.clone();
    let close_id = request_id.to_owned();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            cancel_from_close_event(&handle, &close_id);
        }
        WindowEvent::Destroyed => destroyed(&handle, &close_id),
        _ => {}
    });
    let attached = {
        let service = app.state::<Service>();
        let mut lifecycle = service.0.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(pending) = lifecycle
            .pending
            .as_mut()
            .filter(|pending| pending.request_id == request_id)
        {
            pending.window = Some(window.clone());
            true
        } else {
            false
        }
    };
    if !attached {
        let _ = window.destroy();
        return Err(());
    }
    window.remove_menu().map_err(|_| ())?;
    crate::shell::theme_window(&window, &theme).map_err(|_| ())?;
    let handle = app.clone();
    let request_id = request_id.to_owned();
    app.run_on_main_thread(move || {
        {
            let service = handle.state::<Service>();
            let mut slot = service.0.lock().unwrap_or_else(|error| error.into_inner());
            if let Some(pending) = slot
                .pending
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

    struct ModelPrompt {
        id: &'static str,
        url: url::Url,
        creating: bool,
        window: Option<&'static str>,
        parent_disabled: bool,
    }

    fn model_prompt(id: &'static str, url: &url::Url, active: bool) -> ModelPrompt {
        ModelPrompt {
            id,
            url: url.clone(),
            creating: active,
            window: active.then_some(id),
            parent_disabled: active,
        }
    }

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
    fn x_cancel_and_accept_allow_an_immediate_new_click_after_async_window_destruction() {
        let (settings, service, first_url) = fixture();
        for decision in ["x", "cancel", "accept"] {
            for next_url in [
                first_url.clone(),
                "https://example.com/second?value=%2F".parse().unwrap(),
            ] {
                let mut lifecycle = PromptLifecycle::default();
                assert!(lifecycle.reserve(model_prompt("first", &first_url, true)));
                let first = lifecycle
                    .retire(
                        "first",
                        |pending| pending.id == "first",
                        |pending| pending.creating || pending.window.is_some(),
                    )
                    .unwrap();
                assert_eq!(first.window, Some("first"));
                assert!(first.parent_disabled);
                let opened = std::cell::RefCell::new(Vec::new());
                let opener = |target: &str| {
                    opened.borrow_mut().push(target.to_owned());
                    Ok(())
                };
                open_confirmed(
                    decision == "accept",
                    &settings,
                    &service,
                    &first.url,
                    opener,
                )
                .unwrap();

                // The parent's next click is accepted while the old label still exists.
                assert!(lifecycle.reserve(model_prompt("second", &next_url, false)));
                assert!(!lifecycle.reserve(model_prompt("duplicate", &next_url, false)));
                assert_eq!(
                    lifecycle.creation_gate(|pending| pending.id == "second", true),
                    CreationGate::Waiting
                );
                assert!(lifecycle
                    .frontend_request(|pending| pending.id == "second", |pending| pending.creating)
                    .is_none());
                assert!(lifecycle
                    .retire("first", |pending| pending.id == "first", |_| true)
                    .is_none());

                // Destroyed can precede removal from Tauri's manager; both gates matter.
                lifecycle.destroyed("first");
                assert_eq!(
                    lifecycle.creation_gate(|pending| pending.id == "second", true),
                    CreationGate::Waiting
                );
                assert_eq!(
                    lifecycle.creation_gate(|pending| pending.id == "second", false),
                    CreationGate::Ready
                );
                let second = lifecycle.pending.as_mut().unwrap();
                second.creating = true;
                second.window = Some("second");
                second.parent_disabled = true;
                assert_eq!(
                    lifecycle
                        .frontend_request(
                            |pending| pending.id == "second",
                            |pending| pending.creating
                        )
                        .unwrap()
                        .url,
                    next_url
                );

                let second = lifecycle
                    .retire(
                        "second",
                        |pending| pending.id == "second",
                        |pending| pending.window.is_some(),
                    )
                    .unwrap();
                assert_eq!(second.window, Some("second"));
                assert!(second.parent_disabled);
                open_confirmed(true, &settings, &service, &second.url, opener).unwrap();
                assert_eq!(opened.borrow().last(), Some(&next_url.as_str().to_owned()));
                assert_eq!(
                    opened.borrow().len(),
                    if decision == "accept" { 2 } else { 1 }
                );
                lifecycle.destroyed("first");
                assert_eq!(lifecycle.retiring.as_deref(), Some("second"));
                lifecycle.destroyed("second");
                assert!(lifecycle.retiring.is_none());
            }
        }
    }

    #[test]
    fn cancelling_a_queued_successor_cannot_retire_or_restore_the_old_window() {
        let (_, _, url) = fixture();
        let mut lifecycle = PromptLifecycle::default();
        assert!(lifecycle.reserve(model_prompt("old", &url, true)));
        lifecycle
            .retire(
                "old",
                |pending| pending.id == "old",
                |pending| pending.window.is_some(),
            )
            .unwrap();
        assert!(lifecycle.reserve(model_prompt("queued", &url, false)));
        let queued = lifecycle
            .retire(
                "queued",
                |pending| pending.id == "queued",
                |pending| pending.creating || pending.window.is_some(),
            )
            .unwrap();
        assert_eq!(queued.window, None);
        assert!(!queued.parent_disabled);
        assert_eq!(lifecycle.retiring.as_deref(), Some("old"));
        lifecycle.destroyed("queued");
        assert_eq!(lifecycle.retiring.as_deref(), Some("old"));
        assert!(lifecycle.reserve(model_prompt("latest", &url, false)));
        lifecycle.destroyed("old");
        assert_eq!(
            lifecycle.creation_gate(|pending| pending.id == "latest", false),
            CreationGate::Ready
        );
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
