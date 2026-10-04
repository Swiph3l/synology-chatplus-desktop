//! Browser notification events through WebView2; no remote Tauri IPC capability.
#[cfg(any(windows, test))]
const EVENT_HISTORY_LIMIT: usize = 256;

#[cfg(any(windows, test))]
struct EventHistory<T> {
    events: std::collections::VecDeque<(T, u64)>,
    read_generations: std::collections::HashMap<u64, u64>,
    next: u64,
}
#[cfg(any(windows, test))]
impl<T> Default for EventHistory<T> {
    fn default() -> Self {
        Self {
            events: Default::default(),
            read_generations: Default::default(),
            next: 0,
        }
    }
}
#[cfg(any(windows, test))]
impl<T: PartialEq> EventHistory<T> {
    fn observe(&mut self, event: T) -> (u64, bool) {
        if let Some((_, token)) = self.events.iter().find(|(seen, _)| *seen == event) {
            return (*token, false);
        }
        self.next += 1;
        self.events.push_back((event, self.next));
        if self.events.len() > EVENT_HISTORY_LIMIT {
            if let Some((_, token)) = self.events.pop_front() {
                self.read_generations.remove(&token);
            }
        }
        (self.next, true)
    }

    fn read_generation(&self, token: u64) -> Option<u64> {
        self.read_generations.get(&token).copied()
    }

    fn remember_read_generation(&mut self, token: u64, generation: u64) {
        self.read_generations.entry(token).or_insert(generation);
    }
}

pub async fn permission_state(app: &tauri::AppHandle) -> String {
    #[cfg(windows)]
    {
        use windows::core::w;
        let Some(window) = crate::services::active(app) else {
            return "unavailable".into();
        };
        let (tx, rx) = tokio::sync::oneshot::channel();
        if window.with_webview(move |view| unsafe {
            if let Ok(core) = view.controller().CoreWebView2() {
                let _ = core.ExecuteScript(w!("typeof Notification === 'undefined' ? 'unavailable' : Notification.permission"),
                    &webview2_com::ExecuteScriptCompletedHandler::create(Box::new(move |status, value| {
                        let value = if status.is_ok() { serde_json::from_str::<String>(&value).unwrap_or_default() } else { "unknown".into() };
                        let _ = tx.send(value);
                        Ok(())
                    })));
            }
        }).is_ok() {
            if let Ok(Ok(value)) = tokio::time::timeout(std::time::Duration::from_secs(2), rx).await { return value; }
        }
    }
    let _ = app;
    "unknown".into()
}

// Called only by the explicit local Enable notifications action, after OS access
// was checked. Grants only the configured origin; never changes Windows policy.
pub async fn enable_permission(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use windows::core::{Interface, HSTRING};
        let window = crate::services::active(app)
            .ok_or("Open ChatPlus first, then enable notifications.")?;
        let settings = crate::state::current(app);
        let service = settings.active().ok_or("Open a service first.")?;
        if !service.provider.definition().notifications {
            return Err("Desktop notifications are unavailable for this provider.".into());
        }
        let server = service.url.clone();
        let origin = url::Url::parse(&server)
            .map_err(|_| "Configure your ChatPlus server first.")?
            .origin()
            .ascii_serialization();
        let (tx, rx) = tokio::sync::oneshot::channel();
        window
            .with_webview(move |view| unsafe {
                let result = (|| -> windows::core::Result<()> {
                    let core = view
                        .controller()
                        .CoreWebView2()?
                        .cast::<ICoreWebView2_13>()?;
                    let profile = core.Profile()?.cast::<ICoreWebView2Profile4>()?;
                    profile.SetPermissionState(
                        COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS,
                        &HSTRING::from(origin),
                        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                        &webview2_com::SetPermissionStateCompletedHandler::create(Box::new(
                            move |result| {
                                let _ = tx.send(result.is_ok());
                                Ok(())
                            },
                        )),
                    )
                })();
                let _ = result;
            })
            .map_err(|_| "Could not access WebView notification permission.")?;
        return match tokio::time::timeout(std::time::Duration::from_secs(2), rx).await {
            Ok(Ok(true)) => Ok(()),
            _ => Err("Could not enable WebView notifications. Check ChatPlus notification settings and restart the app.".into()),
        };
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(())
    }
}
pub fn trusted_origin(server: &str, sender: &str) -> bool {
    let (Ok(server), Ok(sender)) = (url::Url::parse(server), url::Url::parse(sender)) else {
        return false;
    };
    matches!(sender.scheme(), "http" | "https")
        && sender.username().is_empty()
        && sender.password().is_none()
        && server.origin() == sender.origin()
}

#[cfg(any(windows, test))]
fn viewing_query(tag: &str, title: &str, arrival: u64) -> String {
    let payload = serde_json::json!({
        "tag": tag.chars().take(512).collect::<String>(),
        "title": title.chars().take(160).collect::<String>(),
        "arrival": arrival,
    });
    // Swiph3l: The arrival counter prevents an older query from releasing a newer
    // renderer barrier; missing hooks/unknown tags stay conservative, without exposing bodies.
    format!("(()=>{{try{{return window.__chatplusIsViewingNotification?.({payload})===true}}catch{{return false}}}})()")
}

#[cfg(any(windows, test))]
fn parse_viewing_result(value: &str) -> bool {
    value.len() <= 16 && serde_json::from_str::<bool>(value).unwrap_or(false)
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy)]
enum NotificationField {
    Title,
    Body,
    Tag,
}

#[cfg(any(windows, test))]
struct NotificationContent {
    title: String,
    body: String,
    tag: String,
}

#[cfg(any(windows, test))]
fn read_notification_content<E>(
    mut read: impl FnMut(NotificationField) -> Result<String, E>,
    fallback_title: &str,
    fallback_body: &str,
) -> NotificationContent {
    // Swiph3l: Preview/property failures cannot erase an already trusted arrival;
    // an unavailable tag means unknown conversation evidence, never a guessed ID.
    NotificationContent {
        title: read(NotificationField::Title).unwrap_or_else(|_| fallback_title.into()),
        body: read(NotificationField::Body).unwrap_or_else(|_| fallback_body.into()),
        tag: read(NotificationField::Tag).unwrap_or_default(),
    }
}

#[cfg(any(windows, test))]
enum NotificationDispatch<T, D> {
    Query(T, D),
    Conservative(T),
}

#[cfg(any(windows, test))]
fn notification_dispatch<T, D, E>(
    incoming: T,
    deferral: Result<D, E>,
) -> NotificationDispatch<T, D> {
    // Swiph3l: A failed native deferral disables the asynchronous query, not the
    // verified message; retaining its payload allows immediate conservative delivery.
    match deferral {
        Ok(deferral) => NotificationDispatch::Query(incoming, deferral),
        Err(_) => NotificationDispatch::Conservative(incoming),
    }
}

#[cfg(any(windows, test))]
struct PendingQueries<T> {
    next: u64,
    values: std::collections::HashMap<u64, T>,
}

#[cfg(any(windows, test))]
impl<T> Default for PendingQueries<T> {
    fn default() -> Self {
        Self {
            next: 0,
            values: Default::default(),
        }
    }
}

#[cfg(any(windows, test))]
impl<T> PendingQueries<T> {
    fn insert(&mut self, value: T) -> u64 {
        self.next += 1;
        self.values.insert(self.next, value);
        self.next
    }

    fn take(&mut self, token: u64) -> Option<T> {
        self.values.remove(&token)
    }
}

#[cfg(windows)]
#[derive(Clone)]
struct PendingNotification {
    service: crate::providers::ServiceConfig,
    title: String,
    body: String,
    tag: String,
    identity: String,
    first_observation: bool,
    generation: u64,
    visibility_generation: u64,
}

#[cfg(windows)]
impl PendingNotification {
    fn finish(&self, app: &tauri::AppHandle, provider_viewed: bool) -> bool {
        // Swiph3l: Removed/disabled services and acknowledged events are terminal
        // too; none may leave an arrival pending after its native query ends.
        crate::unread::complete_incoming_for(
            app,
            &self.service.id,
            self.generation,
            self.first_observation,
        );
        if !crate::services::configured(app, &self.service) {
            return false;
        }
        if crate::unread::acknowledged_after(app, &self.service.id, self.generation) {
            crate::unread::accept_read_for(app, &self.service.id, &[self.generation]);
            return false;
        }
        let viewed = if self.service.provider.definition().unread {
            crate::unread::incoming_for(
                app,
                &self.service.id,
                self.first_observation,
                self.generation,
                self.visibility_generation,
                provider_viewed,
            )
        } else {
            crate::unread::actively_viewed(
                app,
                &self.service.id,
                self.visibility_generation,
                provider_viewed,
            )
        };
        // Swiph3l: A readonly query may retire its tag only after native visibility
        // revalidation and only when this arrival owns no cached unread.
        if viewed && !crate::unread::arrival_requires_read(app, &self.service.id, self.generation) {
            crate::unread::accept_read_for(app, &self.service.id, &[self.generation]);
        }
        crate::desktop_notifications::deliver_for(
            app,
            &self.service.id,
            &self.title,
            &self.body,
            &self.tag,
            &self.identity,
            self.first_observation,
            self.visibility_generation,
            provider_viewed,
        )
    }
}

#[cfg(windows)]
struct NotificationQuery {
    notification: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Notification,
    deferral: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Deferral,
    pending: PendingNotification,
    completed: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

#[cfg(windows)]
thread_local! {
    // Swiph3l: Notification and deferral interfaces belong to the WebView UI apartment;
    // async timers carry only a token, never an unsafe cross-thread COM reference.
    static NOTIFICATION_QUERIES: std::cell::RefCell<PendingQueries<NotificationQuery>> = std::cell::RefCell::new(PendingQueries::default());
}

#[cfg(windows)]
fn finish_query(app: &tauri::AppHandle, token: u64, provider_viewed: bool) {
    let query = NOTIFICATION_QUERIES.with(|queries| queries.borrow_mut().take(token));
    let Some(query) = query else {
        return;
    };
    // Swiph3l: Callback, synchronous failure and timeout compete for one record;
    // only the winner may deliver, report shown and complete the native deferral.
    query
        .completed
        .store(true, std::sync::atomic::Ordering::Release);
    let shown = query.pending.finish(app, provider_viewed);
    unsafe {
        if shown {
            let _ = query.notification.ReportShown();
        }
        let _ = query.deferral.Complete();
    }
}

#[cfg(windows)]
fn query_notification_view(
    app: &tauri::AppHandle,
    core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    notification: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Notification,
    deferral: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Deferral,
    pending: PendingNotification,
) {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use windows::core::HSTRING;
    let completed = Arc::new(AtomicBool::new(false));
    let script = HSTRING::from(viewing_query(
        &pending.tag,
        &pending.title,
        pending.generation,
    ));
    let token = NOTIFICATION_QUERIES.with(|queries| {
        queries.borrow_mut().insert(NotificationQuery {
            notification,
            deferral,
            pending,
            completed: completed.clone(),
        })
    });
    let timer_app = app.clone();
    let timer_completed = completed.clone();
    // Swiph3l: A crashed or unresponsive renderer cannot hold native delivery
    // indefinitely; the timeout is an IPC bound, never a delay for clearing unread.
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        if timer_completed.load(Ordering::Acquire) {
            return;
        }
        let dispatcher = timer_app.clone();
        let _ = dispatcher.run_on_main_thread(move || {
            finish_query(&timer_app, token, false);
        });
    });
    let callback_app = app.clone();
    let handler =
        webview2_com::ExecuteScriptCompletedHandler::create(Box::new(move |status, value| {
            finish_query(
                &callback_app,
                token,
                status.is_ok() && parse_viewing_result(&value),
            );
            Ok(())
        }));
    if unsafe { core.ExecuteScript(&script, &handler) }.is_err() {
        finish_query(app, token, false);
    }
}

#[cfg(windows)]
pub fn attach(
    app: &tauri::AppHandle,
    window: &tauri::Webview,
    service: &crate::providers::ServiceConfig,
) -> tauri::Result<()> {
    use crate::desktop_notifications as notifications;
    use tauri::Manager;
    use webview2_com::{
        CoTaskMemPWSTR,
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_24, COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS,
            COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DENY,
        },
        NotificationReceivedEventHandler, PermissionRequestedEventHandler,
    };
    use windows::core::{Interface, PWSTR};
    let app = app.clone();
    let service = service.clone();
    window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let unread_app = app.clone();
        let unread_service = service.clone();
        let _ = core.add_WebMessageReceived(
            &webview2_com::WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut source = PWSTR::null();
                args.Source(&mut source)?;
                let source = CoTaskMemPWSTR::from(source).to_string();
                if !crate::services::configured(&unread_app, &unread_service)
                    || !trusted_origin(&unread_service.url, &source)
                {
                    return Ok(());
                }
                let mut json = PWSTR::null();
                args.TryGetWebMessageAsString(&mut json)?;
                let json = CoTaskMemPWSTR::from(json).to_string();
                if unread_service.provider.definition().unread {
                    if let Some(unread) = parse_unread(&json) {
                        crate::unread::publish_for(
                            &unread_app,
                            &unread_service.id,
                            unread.count,
                            unread.has_unread,
                            unread.source,
                            &unread.reason,
                            unread.acknowledgement,
                            &unread.read_arrivals,
                            unread.proof_only,
                        );
                    }
                }
                Ok(())
            })),
            &mut 0,
        );
        let Ok(extended) = core.cast::<ICoreWebView2_24>() else {
            return;
        };
        let notify_app = app.clone();
        let notify_service = service.clone();
        static NEXT_BRIDGE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let bridge_id = NEXT_BRIDGE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        // Swiph3l: Keep bounded canonical COM references on their WebView apartment so recycled pointers cannot merge distinct message events.
        let mut seen = EventHistory::<windows::core::IUnknown>::default();
        let registered = extended
            .add_NotificationReceived(
                &NotificationReceivedEventHandler::create(Box::new(move |sender, args| {
                    let Some(args) = args else {
                        return Ok(());
                    };
                    // Swiph3l: Own even muted/suppressed events or WebView2 also displays an unfiltered duplicate toast.
                    args.SetHandled(true)?;
                    let mut origin = PWSTR::null();
                    args.SenderOrigin(&mut origin)?;
                    let origin = CoTaskMemPWSTR::from(origin).to_string();
                    if !crate::services::configured(&notify_app, &notify_service)
                        || !notify_service.provider.definition().notifications
                        || !trusted_origin(&notify_service.url, &origin)
                    {
                        return Ok(());
                    }
                    let notification = args.Notification()?;
                    let (token, first_observation) =
                        seen.observe(notification.cast::<windows::core::IUnknown>()?);
                    let identity = format!("{bridge_id}:{token}");
                    // Swiph3l: Duplicate callbacks must not resurrect acknowledged unread; native retry reservations remain a separate lifecycle.
                    let generation = crate::unread::begin_incoming_for(
                        &notify_app,
                        &notify_service.id,
                        first_observation,
                        seen.read_generation(token),
                    );
                    seen.remember_read_generation(token, generation.read);
                    let content = read_notification_content(
                        |field| {
                            let mut value = PWSTR::null();
                            let result = match field {
                                NotificationField::Title => notification.Title(&mut value),
                                NotificationField::Body => notification.Body(&mut value),
                                NotificationField::Tag => notification.Tag(&mut value),
                            };
                            let value = CoTaskMemPWSTR::from(value);
                            result.map(|_| value.to_string())
                        },
                        &notify_service.name,
                        &crate::i18n::t(&notify_app, "notification.newMessage"),
                    );
                    let pending = PendingNotification {
                        service: notify_service.clone(),
                        title: content.title,
                        body: content.body,
                        tag: content.tag,
                        identity,
                        first_observation,
                        generation: generation.read,
                        visibility_generation: generation.visibility,
                    };
                    // Swiph3l: Background events need their tag retained by the
                    // renderer for later exact read proof; current visibility still gates suppression.
                    if let Some(core) = sender {
                        match notification_dispatch(pending, args.GetDeferral()) {
                            NotificationDispatch::Query(pending, deferral) => {
                                query_notification_view(
                                    &notify_app,
                                    &core,
                                    notification,
                                    deferral,
                                    pending,
                                );
                            }
                            NotificationDispatch::Conservative(pending) => {
                                if pending.finish(&notify_app, false) {
                                    let _ = notification.ReportShown();
                                }
                            }
                        }
                    } else if pending.finish(&notify_app, false) {
                        let _ = notification.ReportShown();
                    }
                    Ok(())
                })),
                &mut 0,
            )
            .is_ok();
        app.state::<notifications::Service>()
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .bridge_available = registered;
        if !registered {
            return;
        }
        let permission_app = app.clone();
        let permission_service = service.clone();
        let _ = core.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut kind = Default::default();
                args.PermissionKind(&mut kind)?;
                if kind != COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS {
                    return Ok(());
                }
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                let uri = CoTaskMemPWSTR::from(uri).to_string();
                let settings = crate::state::current(&permission_app);
                let allow = settings.desktop_notifications
                    && crate::services::configured(&permission_app, &permission_service)
                    && settings
                        .services
                        .iter()
                        .any(|s| s.id == permission_service.id && s.notifications)
                    && permission_service.provider.definition().notifications
                    && trusted_origin(&permission_service.url, &uri)
                    && notifications::permission(&permission_app).granted;
                // Swiph3l: The saved notification preference authorizes only this configured origin; other permission kinds retain WebView policy.
                args.SetState(if allow {
                    COREWEBVIEW2_PERMISSION_STATE_ALLOW
                } else {
                    COREWEBVIEW2_PERMISSION_STATE_DENY
                })?;
                Ok(())
            })),
            &mut 0,
        );
    })
}

struct UnreadObservation {
    has_unread: bool,
    count: Option<u32>,
    source: crate::unread::Source,
    reason: String,
    acknowledgement: Option<u64>,
    read_arrivals: Vec<u64>,
    proof_only: bool,
}

fn parse_unread(json: &str) -> Option<UnreadObservation> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Message {
        #[serde(default)]
        chatplus_unread: u8,
        unread: Option<bool>,
        has_unread: Option<bool>,
        source: Option<String>,
        reason: Option<String>,
        acknowledgement: Option<u64>,
        #[serde(default)]
        read_arrivals: Vec<u64>,
        #[serde(default)]
        proof_only: bool,
    }

    // Swiph3l: Up to 256 u64 read proofs can exceed the old tiny badge payload;
    // the overall bound still limits untrusted data before deserialization.
    if json.len() > 8192 {
        return None;
    }
    let value: Message = serde_json::from_str(json).ok()?;
    if value.chatplus_unread != 1 {
        return None;
    }
    let mut proofs = std::collections::HashSet::new();
    if value.read_arrivals.len() > crate::unread::READ_ARRIVAL_LIMIT
        || !value
            .read_arrivals
            .iter()
            .all(|arrival| *arrival > 0 && proofs.insert(*arrival))
    {
        return None;
    }
    if value.proof_only && (value.acknowledgement.is_none() || value.read_arrivals.is_empty()) {
        return None;
    }
    let has_unread = value.has_unread.or(value.unread)?;
    let source = match value.source.as_deref() {
        Some("chatplus-dom") | None => crate::unread::Source::ChatPlusDom,
        Some("synology-chat-dom") => crate::unread::Source::SynologyChatDom,
        Some("discord-dom") => crate::unread::Source::DiscordDom,
        Some("title-fallback") => return None,
        _ => return None,
    };
    let reason = value.reason.unwrap_or_else(|| "event".into());
    if reason.len() > 120 {
        return None;
    }
    Some(UnreadObservation {
        has_unread,
        count: None,
        source,
        reason,
        acknowledgement: value.acknowledgement,
        read_arrivals: value.read_arrivals,
        proof_only: value.proof_only,
    })
}
#[cfg(not(windows))]
pub fn attach(
    _: &tauri::AppHandle,
    _: &tauri::Webview,
    _: &crate::providers::ServiceConfig,
) -> tauri::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_event_identity_is_retained_and_history_is_bounded() {
        #[derive(PartialEq)]
        struct Identity(u64);
        let mut history = EventHistory::default();
        let first = std::rc::Rc::new(Identity(1));
        let weak = std::rc::Rc::downgrade(&first);
        assert_eq!(history.observe(first.clone()), (1, true));
        history.remember_read_generation(1, 7);
        assert_eq!(history.observe(first.clone()), (1, false));
        history.remember_read_generation(1, 9);
        assert_eq!(history.read_generation(1), Some(7));
        drop(first);
        assert!(
            weak.upgrade().is_some(),
            "retaining identity prevents allocator reuse while an event remains deduplicated"
        );
        for id in 2..=EVENT_HISTORY_LIMIT as u64 {
            assert_eq!(history.observe(std::rc::Rc::new(Identity(id))), (id, true));
        }
        assert!(weak.upgrade().is_some());
        let next = EVENT_HISTORY_LIMIT as u64 + 1;
        assert_eq!(
            history.observe(std::rc::Rc::new(Identity(next))),
            (next, true)
        );
        assert!(weak.upgrade().is_none());
        assert_eq!(history.events.len(), EVENT_HISTORY_LIMIT);
        assert_eq!(history.read_generation(1), None);
    }
    #[test]
    fn unread_messages_are_boolean_only() {
        assert_eq!(
            parse_unread(r#"{"chatplusUnread":1,"unread":true}"#).map(|value| value.has_unread),
            Some(true)
        );
        assert_eq!(
            parse_unread(r#"{"chatplusUnread":1,"unread":false}"#).map(|value| value.has_unread),
            Some(false)
        );
        assert_eq!(
            parse_unread(
                r#"{"chatplusUnread":1,"hasUnread":true,"count":3,"source":"chatplus-dom","reason":"badge-created"}"#
            )
            .map(|value| (value.has_unread, value.count)),
            Some((true, None))
        );
        for value in [
            r#"{"chatplusUnread":1,"unread":"true"}"#,
            r#"{"chatplusUnread":1,"source":"unknown","unread":true}"#,
            "null",
            "{}",
        ] {
            assert!(parse_unread(value).is_none());
        }
    }
    #[test]
    fn provider_read_acknowledgements_require_a_numeric_presentation_generation() {
        assert_eq!(
            parse_unread(r#"{"chatplusUnread":1,"hasUnread":false,"acknowledgement":7}"#)
                .map(|value| value.acknowledgement),
            Some(Some(7))
        );
        assert_eq!(
            parse_unread(r#"{"chatplusUnread":1,"hasUnread":false}"#)
                .map(|value| value.acknowledgement),
            Some(None)
        );
        assert!(
            parse_unread(r#"{"chatplusUnread":1,"hasUnread":false,"acknowledgement":"7"}"#)
                .is_none()
        );
    }
    #[test]
    fn exact_read_arrival_proofs_are_optional_bounded_unique_positive_integers() {
        let json = |proofs: serde_json::Value| {
            serde_json::json!({"chatplusUnread":1,"hasUnread":false,"readArrivals":proofs})
                .to_string()
        };
        assert_eq!(
            parse_unread(r#"{"chatplusUnread":1,"hasUnread":false}"#)
                .map(|value| value.read_arrivals),
            Some(vec![])
        );
        assert_eq!(
            parse_unread(&json(serde_json::json!([1, 7]))).map(|value| value.read_arrivals),
            Some(vec![1, 7])
        );
        let bounded = (1..=crate::unread::READ_ARRIVAL_LIMIT as u64).collect::<Vec<_>>();
        assert_eq!(
            parse_unread(&json(serde_json::json!(bounded))).map(|value| value.read_arrivals.len()),
            Some(crate::unread::READ_ARRIVAL_LIMIT)
        );
        for proofs in [
            serde_json::json!(null),
            serde_json::json!(0),
            serde_json::json!("1"),
            serde_json::json!([0]),
            serde_json::json!([-1]),
            serde_json::json!([1.5]),
            serde_json::json!(["1"]),
            serde_json::json!([1, 1]),
            serde_json::json!(
                (1..=crate::unread::READ_ARRIVAL_LIMIT as u64 + 1).collect::<Vec<_>>()
            ),
        ] {
            assert!(parse_unread(&json(proofs)).is_none());
        }
        assert!(parse_unread(&format!(
            "{}{}",
            json(serde_json::json!([])),
            " ".repeat(8192)
        ))
        .is_none());
    }
    #[test]
    fn proof_only_requires_a_strict_boolean_and_nonempty_acknowledged_read_proofs() {
        assert_eq!(
            parse_unread(r#"{"chatplusUnread":1,"hasUnread":false}"#).map(|value| value.proof_only),
            Some(false)
        );
        assert_eq!(parse_unread(r#"{"chatplusUnread":1,"hasUnread":false,"proofOnly":true,"acknowledgement":7,"readArrivals":[1]}"#).map(|value| value.proof_only), Some(true));
        for value in [
            r#"{"chatplusUnread":1,"hasUnread":false,"proofOnly":true,"readArrivals":[1]}"#,
            r#"{"chatplusUnread":1,"hasUnread":false,"proofOnly":true,"acknowledgement":7}"#,
            r#"{"chatplusUnread":1,"hasUnread":false,"proofOnly":true,"acknowledgement":7,"readArrivals":[]}"#,
            r#"{"chatplusUnread":1,"hasUnread":false,"proofOnly":null}"#,
            r#"{"chatplusUnread":1,"hasUnread":false,"proofOnly":"true"}"#,
            r#"{"chatplusUnread":1,"hasUnread":false,"proofOnly":1}"#,
        ] {
            assert!(parse_unread(value).is_none());
        }
    }
    #[test]
    fn independent_provider_sources_are_preserved() {
        for (source, expected) in [
            ("chatplus-dom", crate::unread::Source::ChatPlusDom),
            ("synology-chat-dom", crate::unread::Source::SynologyChatDom),
            ("discord-dom", crate::unread::Source::DiscordDom),
        ] {
            let json = serde_json::json!({"chatplusUnread":1,"hasUnread":false,"source":source})
                .to_string();
            assert_eq!(
                parse_unread(&json).map(|value| value.source),
                Some(expected)
            );
        }
    }
    #[test]
    fn preview_getter_failures_keep_the_trusted_arrival_and_leave_unknown_tag_unmatched() {
        let partial = read_notification_content(
            |field| match field {
                NotificationField::Title | NotificationField::Tag => Err(()),
                NotificationField::Body => Ok("actual body".into()),
            },
            "Configured provider",
            "Localized new message",
        );
        assert_eq!(partial.title, "Configured provider");
        assert_eq!(partial.body, "actual body");
        assert!(partial.tag.is_empty());
        let all_failed = read_notification_content(|_| Err(()), "Provider", "New message");
        assert_eq!(all_failed.title, "Provider");
        assert_eq!(all_failed.body, "New message");
        assert!(all_failed.tag.is_empty());
        assert!(viewing_query(&all_failed.tag, &all_failed.title, 1).contains(r#""tag":"""#));
    }
    #[test]
    fn failed_deferral_retains_identity_and_arrival_for_immediate_conservative_delivery() {
        let arrival = ("service-origin", "stable-event-identity", 42, true);
        let result = notification_dispatch(arrival, Err::<(), _>("GetDeferral failed"));
        let NotificationDispatch::Conservative(preserved) = result else {
            panic!("a failed deferral cannot queue the renderer query");
        };
        assert_eq!(preserved, arrival);
        assert!(crate::desktop_notifications::should_notify(
            true, true, false
        ));
        let result = notification_dispatch(arrival, Ok::<_, ()>("native deferral"));
        let NotificationDispatch::Query(preserved, deferral) = result else {
            panic!("a valid deferral must retain the asynchronous viewing path");
        };
        assert_eq!(preserved, arrival);
        assert_eq!(deferral, "native deferral");
    }
    #[test]
    fn timeout_and_renderer_callback_complete_each_notification_only_once() {
        let mut queries = PendingQueries::default();
        let callback_first = queries.insert("callback-first");
        let timeout_first = queries.insert("timeout-first");
        let synchronous_failure = queries.insert("synchronous-failure");
        assert_eq!(queries.take(callback_first), Some("callback-first"));
        assert_eq!(
            queries.take(callback_first),
            None,
            "the late timer must do nothing"
        );
        assert_eq!(queries.take(timeout_first), Some("timeout-first"));
        assert_eq!(
            queries.take(timeout_first),
            None,
            "the late renderer must do nothing"
        );
        assert_eq!(
            queries.take(synchronous_failure),
            Some("synchronous-failure")
        );
        assert_eq!(queries.take(synchronous_failure), None);
        assert!(queries.values.is_empty());
    }
    #[test]
    fn conversation_queries_require_a_strict_boolean_and_escape_bounded_public_identity() {
        assert!(parse_viewing_result("true"));
        for value in [
            "false",
            "null",
            "\"true\"",
            "1",
            "{}",
            "",
            "true                ",
        ] {
            assert!(!parse_viewing_result(value));
        }
        let query = viewing_query("quoted\"tag\n", "sender\\name", 7);
        assert!(query.contains(r#""arrival":7"#));
        assert!(query.contains("quoted\\\"tag\\n"));
        assert!(query.contains("sender\\\\name"));
        assert!(query.contains("===true"));
        assert!(query.contains("catch{return false}"));
        let query = viewing_query(&"x".repeat(600), &"y".repeat(200), 8);
        assert!(query.contains(r#""arrival":8"#));
        assert!(query.contains(&"x".repeat(512)));
        assert!(!query.contains(&"x".repeat(513)));
        assert!(!query.contains(&"y".repeat(161)));
        assert!(!query.contains("body"));
    }
    #[test]
    fn events_require_exact_configured_origin() {
        assert!(trusted_origin(
            "https://nas.example.com/chat/",
            "https://nas.example.com/"
        ));
        for sender in [
            "https://nas.example.com.evil.example/",
            "http://nas.example.com/",
            "https://nas.example.com:8443/",
            "https://user:password@nas.example.com/",
            "file:///tmp/test",
            "null",
        ] {
            assert!(!trusted_origin("https://nas.example.com/chat/", sender));
        }
    }
}
