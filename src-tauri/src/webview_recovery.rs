//! Recovery starts a new GET at the configured entry, never a reload of an
//! authentication form, attachment transfer or conversation navigation.
use crate::{
    connection::{self, Connection},
    providers::ServiceConfig,
    services::LoadTicket,
};
use std::{
    hash::{BuildHasher, RandomState},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, Webview};
use url::Url;
use webview2_com::{
    CoTaskMemPWSTR, Microsoft::Web::WebView2::Win32::*, NavigationCompletedEventHandler,
    NavigationStartingEventHandler, ProcessFailedEventHandler,
};
use windows::core::{Interface, PWSTR};

const ATTEMPT_LIMIT: u8 = 4;
const STABLE_DOCUMENT: Duration = Duration::from_secs(60);

#[derive(Default)]
struct Recovery {
    // Retain only whether the last top-level request matched the public entry.
    navigation: Option<(u64, bool)>,
    serial: u64,
    pending: bool,
    attempts: u8,
    connected_since: Option<Instant>,
}

impl Recovery {
    fn started(&mut self, navigation: u64, at_entry: bool) {
        self.navigation = Some((navigation, at_entry));
        self.pending = false;
    }

    fn connected(&mut self, now: Instant) {
        self.pending = false;
        self.connected_since.get_or_insert(now);
    }

    fn reserve(&mut self, now: Instant, jitter: u64) -> Option<(u64, Duration)> {
        if self.pending {
            return None;
        }
        if self
            .connected_since
            .take()
            .is_some_and(|since| now.duration_since(since) >= STABLE_DOCUMENT)
        {
            self.attempts = 0;
        }
        if self.attempts >= ATTEMPT_LIMIT {
            return None;
        }
        let delay = Duration::from_millis((1000 << self.attempts) + jitter % 501);
        self.attempts += 1;
        self.serial += 1;
        self.pending = true;
        Some((self.serial, delay))
    }

    fn take(&mut self, serial: u64) -> bool {
        self.serial == serial && std::mem::take(&mut self.pending)
    }
}

fn retryable(status: COREWEBVIEW2_WEB_ERROR_STATUS, http: i32) -> bool {
    if http != 0 {
        return matches!(http, 502..=504);
    }
    matches!(
        status,
        COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED
            | COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED
            | COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT
            | COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE
            | COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT
            | COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET
    )
}

#[derive(Clone)]
struct Session {
    app: AppHandle,
    service: ServiceConfig,
    ticket: LoadTicket,
    entry: Url,
    recovery: Arc<Mutex<Recovery>>,
}

impl Session {
    fn live(&self) -> bool {
        self.ticket.current(&self.app) && crate::services::configured(&self.app, &self.service)
    }

    fn recover(&self) {
        let jitter = RandomState::new().hash_one(&self.service.id);
        let next = self
            .recovery
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .reserve(Instant::now(), jitter);
        let Some((serial, delay)) = next else { return };
        let session = self.clone();
        // No COM handle or WebView is kept alive by the timer. Validate on the
        // UI thread immediately before navigating, including label reuse.
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(delay).await;
            let dispatcher = session.app.clone();
            let _ = dispatcher.run_on_main_thread(move || {
                if !session.live()
                    || !session
                        .recovery
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .take(serial)
                {
                    return;
                }
                if let Some(view) = session
                    .app
                    .get_webview(&crate::services::label(&session.service.id))
                {
                    let _ = view.navigate(session.entry);
                }
            });
        });
    }
}

pub(crate) fn observe_connection(
    app: &AppHandle,
    view: &Webview,
    service: &ServiceConfig,
    ticket: &LoadTicket,
    entry: &Url,
) -> tauri::Result<()> {
    let session = Session {
        app: app.clone(),
        service: service.clone(),
        ticket: ticket.clone(),
        entry: entry.clone(),
        recovery: Arc::default(),
    };
    view.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let starting = session.clone();
        let track_navigation = core
            .add_NavigationStarting(
                &NavigationStartingEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args {
                        let mut id = 0;
                        args.NavigationId(&mut id)?;
                        let mut uri = PWSTR::null();
                        args.Uri(&mut uri)?;
                        let at_entry =
                            CoTaskMemPWSTR::from(uri).to_string() == starting.entry.as_str();
                        starting
                            .recovery
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .started(id, at_entry);
                    }
                    Ok(())
                })),
                &mut 0,
            )
            .is_ok();
        let completed = session.clone();
        let result = core.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
                let Some(args) = args else { return Ok(()) };
                if !completed.live() {
                    return Ok(());
                }
                let mut id = 0;
                args.NavigationId(&mut id)?;
                let navigation = completed
                    .recovery
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .navigation;
                let at_entry = match navigation {
                    Some((latest, _)) if latest != id => return Ok(()),
                    Some((_, at_entry)) => at_entry,
                    // The native child may have started its first navigation
                    // before the observer was attached.
                    None => sender.is_some_and(|core| {
                        let mut source = PWSTR::null();
                        core.Source(&mut source).is_ok()
                            && CoTaskMemPWSTR::from(source).to_string() == completed.entry.as_str()
                    }),
                };
                let mut success = Default::default();
                args.IsSuccess(&mut success)?;
                let http = args
                    .cast::<ICoreWebView2NavigationCompletedEventArgs2>()
                    .ok()
                    .and_then(|details| {
                        let mut code = 0;
                        details.HttpStatusCode(&mut code).ok().map(|_| code)
                    })
                    .unwrap_or(0);
                let state = if success.as_bool() && http < 400 {
                    completed
                        .recovery
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .connected(Instant::now());
                    crate::unread::sync_presentation(&completed.app);
                    Connection::Connected
                } else {
                    let mut status = Default::default();
                    args.WebErrorStatus(&mut status)?;
                    if status == COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED {
                        return Ok(());
                    }
                    if track_navigation && at_entry && retryable(status, http) {
                        completed.recover();
                    } else {
                        completed
                            .recovery
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .connected_since = None;
                    }
                    if status == COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED {
                        Connection::Offline
                    } else {
                        Connection::Error
                    }
                };
                connection::set_for(&completed.app, &completed.service.id, state);
                Ok(())
            })),
            &mut 0,
        );
        if result.is_err() && session.live() {
            connection::set_for(&session.app, &session.service.id, Connection::Unknown);
        }
        let _ = core.add_ProcessFailed(
            &ProcessFailedEventHandler::create(Box::new(move |sender, args| {
                let Some(args) = args else { return Ok(()) };
                if !session.live() {
                    return Ok(());
                }
                let mut kind = Default::default();
                args.ProcessFailedKind(&mut kind)?;
                if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED
                    || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                {
                    connection::set_for(&session.app, &session.service.id, Connection::Error);
                    crate::unread::invalidate_presentation(&session.app, &session.service.id);
                }
                if track_navigation
                    && kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                {
                    if let Some(core) = sender {
                        let mut source = PWSTR::null();
                        core.Source(&mut source)?;
                        if Url::parse(&CoTaskMemPWSTR::from(source).to_string()).is_ok_and(|url| {
                            crate::navigation::provider_document(&session.service, &url)
                        }) {
                            session.recover();
                        }
                    }
                }
                Ok(())
            })),
            &mut 0,
        );
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_outage_recovery_deduplicates_cancels_stale_work_and_requires_stable_success_to_rearm(
    ) {
        let now = Instant::now();
        let mut state = Recovery::default();
        let (stale, _) = state.reserve(now, 0).unwrap();
        assert!(state.reserve(now, 0).is_none());
        state.started(2, false);
        assert!(!state.take(stale));
        for attempt in 1..ATTEMPT_LIMIT {
            state.connected(now);
            let (id, delay) = state.reserve(now, 500).unwrap();
            assert_eq!(delay.as_millis(), (1000 << attempt) + 500);
            assert!(!state.take(stale));
            assert!(state.take(id));
            assert!(!state.take(id));
        }
        assert!(state.reserve(now, 0).is_none());
        state.connected(now);
        let (id, delay) = state.reserve(now + STABLE_DOCUMENT, 0).unwrap();
        assert_eq!(delay, Duration::from_secs(1));
        state.connected(now + STABLE_DOCUMENT);
        assert!(!state.take(id));
    }

    #[test]
    fn only_transient_transport_or_gateway_failures_can_schedule_an_entry_get() {
        assert!(retryable(
            COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED,
            0
        ));
        assert!(retryable(COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN, 503));
        for code in [200, 401, 403, 404, 429, 500] {
            assert!(!retryable(COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT, code));
        }
        for status in [
            COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED,
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED,
            COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN,
        ] {
            assert!(!retryable(status, 0));
        }
    }
}
