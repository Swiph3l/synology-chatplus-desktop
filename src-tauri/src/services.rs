//! Native service sessions live behind a local rail; provider pages have no Tauri capability.
use crate::{providers::ServiceConfig, state};
use std::{
    collections::HashMap,
    sync::{Condvar, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, Webview, WebviewBuilder, WebviewUrl};

#[derive(Default)]
pub struct Lifecycle(Mutex<()>, Mutex<Startup>, Condvar);

impl Lifecycle {
    fn stop(&self) {
        self.1
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .stopping = true;
        self.2.notify_all();
    }
}

const STARTUP_GAP: Duration = Duration::from_millis(750);
const STARTUP_LOAD_LIMIT: Duration = Duration::from_secs(8);

#[derive(Clone, PartialEq, Eq)]
struct SessionIdentity {
    id: String,
    provider: crate::providers::ProviderId,
    url: String,
}

impl From<&ServiceConfig> for SessionIdentity {
    fn from(service: &ServiceConfig) -> Self {
        Self {
            id: service.id.clone(),
            provider: service.provider,
            url: service.url.clone(),
        }
    }
}

#[derive(Clone)]
struct LoadTicket {
    identity: SessionIdentity,
    generation: u64,
    started: Instant,
}

struct StartupLoad {
    ticket: LoadTicket,
    finished: bool,
}

#[derive(Default)]
struct Startup {
    running: bool,
    stopping: bool,
    generation: u64,
    attempted: Vec<SessionIdentity>,
    loads: HashMap<String, StartupLoad>,
    creating: Option<LoadTicket>,
    presentation: Option<SessionIdentity>,
}

impl Startup {
    fn begin(&mut self) -> bool {
        if self.running || self.stopping {
            return false;
        }
        self.running = true;
        self.attempted.clear();
        true
    }

    fn register(&mut self, service: &ServiceConfig, now: Instant) -> LoadTicket {
        self.generation += 1;
        let ticket = LoadTicket {
            identity: service.into(),
            generation: self.generation,
            started: now,
        };
        self.loads.insert(
            service.id.clone(),
            StartupLoad {
                ticket: ticket.clone(),
                finished: false,
            },
        );
        ticket
    }

    fn loaded(&mut self, ticket: &LoadTicket, finished: bool) -> bool {
        if let Some(load) = self.loads.get_mut(&ticket.identity.id) {
            // Swiph3l: A closed/reconfigured view may still deliver its old load callback.
            if load.ticket.generation == ticket.generation {
                load.finished = finished;
                return true;
            }
        }
        false
    }

    fn defer_presentation(&mut self, service: &ServiceConfig) -> bool {
        if self.reserved(&service.id) {
            self.presentation = Some(service.into());
            true
        } else {
            false
        }
    }

    fn reserved(&self, id: &str) -> bool {
        self.creating
            .as_ref()
            .is_some_and(|ticket| ticket.identity.id == id)
    }

    fn release(&mut self, ticket: &LoadTicket) {
        if self
            .creating
            .as_ref()
            .is_some_and(|current| current.generation == ticket.generation)
        {
            self.creating = None;
        }
    }

    fn current(&self, ticket: &LoadTicket) -> bool {
        !self.stopping && self.owns(ticket)
    }

    fn owns(&self, ticket: &LoadTicket) -> bool {
        self.loads
            .get(&ticket.identity.id)
            .is_some_and(|load| load.ticket.generation == ticket.generation)
    }

    fn remaining(&self, ticket: &LoadTicket, settings: &state::Settings, now: Instant) -> Duration {
        if self.stopping
            || !settings
                .services
                .iter()
                .any(|service| service.enabled && SessionIdentity::from(service) == ticket.identity)
        {
            return Duration::ZERO;
        }
        let Some(load) = self
            .loads
            .get(&ticket.identity.id)
            .filter(|load| load.ticket.generation == ticket.generation)
        else {
            return Duration::ZERO;
        };
        let elapsed = now.saturating_duration_since(ticket.started);
        let limit = if load.finished {
            STARTUP_GAP
        } else {
            STARTUP_LOAD_LIMIT
        };
        limit.saturating_sub(elapsed)
    }

    fn next(
        &mut self,
        settings: &state::Settings,
        exists: impl Fn(&str) -> bool,
    ) -> Option<ServiceConfig> {
        if self.stopping {
            return None;
        }
        let next = settings.services.iter().find(|service| {
            service.enabled
                && !exists(&service.id)
                && !self.attempted.contains(&SessionIdentity::from(*service))
        })?;
        self.attempted.push(next.into());
        Some(next.clone())
    }
}

/// Start configured sessions after the selected service has opened normally.
pub fn start_configured(app: &AppHandle) {
    let lifecycle = app.state::<Lifecycle>();
    let mut startup = lifecycle
        .1
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if !startup.begin() {
        lifecycle.2.notify_all();
        return;
    }
    let previous = state::current(app)
        .active_service
        .as_ref()
        .and_then(|id| startup.loads.get(id))
        .map(|load| load.ticket.clone());
    drop(startup);
    let handle = app.clone();
    if std::thread::Builder::new()
        .name("chatplus-service-startup".into())
        .spawn(move || run_startup(&handle, previous))
        .is_err()
    {
        lifecycle
            .1
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .running = false;
        eprintln!("[services] Could not queue background service startup.");
    }
}

fn wait_for_startup(app: &AppHandle, ticket: &LoadTicket) {
    let lifecycle = app.state::<Lifecycle>();
    let mut startup = lifecycle
        .1
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    loop {
        let remaining = startup.remaining(ticket, &state::current(app), Instant::now());
        if remaining.is_zero() {
            return;
        }
        startup = lifecycle
            .2
            .wait_timeout(startup, remaining)
            .unwrap_or_else(|error| error.into_inner())
            .0;
    }
}

fn run_startup(app: &AppHandle, mut previous: Option<LoadTicket>) {
    let lifecycle = app.state::<Lifecycle>();
    loop {
        if let Some(ticket) = previous.take() {
            wait_for_startup(app, &ticket);
        }
        let (service, ticket) = {
            let _transition = lifecycle
                .0
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let settings = state::current(app);
            let mut startup = lifecycle
                .1
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let next = app
                .get_window("main")
                .and_then(|_| startup.next(&settings, |id| app.get_webview(&label(id)).is_some()));
            let Some(service) = next else {
                startup.running = false;
                return;
            };
            let ticket = startup.register(&service, Instant::now());
            startup.creating = Some(ticket.clone());
            (service, ticket)
        };
        // Swiph3l: add_child waits for the UI. Never retain the lifecycle lock
        // across it: a toast/menu callback on that UI may need the same lock.
        // The reservation defers competing activation, and completion rechecks
        // identity so removal/reconfiguration cannot resurrect a stale session.
        let created = create_registered(app, &service, &ticket, true);
        let valid = configured(app, &service)
            && lifecycle
                .1
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .current(&ticket);
        if !valid {
            if let Ok(view) = &created {
                let _ = view.close();
            }
        }
        let requested = {
            let _transition = lifecycle
                .0
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let mut startup = lifecycle
                .1
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            startup.release(&ticket);
            if created.is_err() {
                startup.loaded(&ticket, true);
            }
            let requested = startup.presentation.as_ref() == Some(&ticket.identity);
            if requested {
                startup.presentation = None;
            }
            requested
        };
        lifecycle.2.notify_all();
        if valid {
            if let Ok(view) = created {
                let handle = app.clone();
                let completed = ticket.clone();
                let _ = app.run_on_main_thread(move || {
                    let state = handle.state::<Lifecycle>();
                    let startup = state.1.lock().unwrap_or_else(|error| error.into_inner());
                    // Swiph3l: Webview::close unregisters by label. An old
                    // completion must never close/unregister a newer view that
                    // already reused that stable service label.
                    if !startup.owns(&completed) {
                        return;
                    }
                    let current = startup.current(&completed);
                    drop(startup);
                    if !current || !configured(&handle, &service) {
                        let _ = view.close();
                        return;
                    }
                    let selected = state::current(&handle).active_service.as_deref()
                        == Some(service.id.as_str());
                    if selected {
                        let _ = view.show();
                    } else {
                        let _ = view.hide();
                    }
                    if selected && requested && crate::window::is_foreground(&handle) {
                        let _ = view.set_focus();
                    }
                    layout(&handle);
                    crate::unread::sync_presentation(&handle);
                });
            } else {
                // Do not open Settings, focus a window or include account URLs in logs.
                eprintln!(
                    "[services] Background service startup failed; open the service to retry."
                );
            }
        }
        previous = Some(ticket);
    }
}

pub fn shutdown(app: &AppHandle) {
    if let Some(lifecycle) = app.try_state::<Lifecycle>() {
        // Swiph3l: Exit must wake a waiting worker without blocking the native UI
        // on a WebView creation that may itself be dispatched to that UI thread.
        lifecycle.stop();
    }
}

const RAIL_WIDTH: f64 = 56.;
// Swiph3l: Native provider WebViews cover the shell, so this must match the 30px CSS footer height.
const FOOTER_HEIGHT: f64 = 30.;

fn service_size(width: f64, height: f64) -> tauri::LogicalSize<f64> {
    tauri::LogicalSize::new(
        (width - RAIL_WIDTH).max(1.),
        (height - FOOTER_HEIGHT).max(1.),
    )
}

fn creation_position(selected: bool, width: f64) -> tauri::LogicalPosition<f64> {
    tauri::LogicalPosition::new(if selected { RAIL_WIDTH } else { -width - 1. }, 0.)
}

pub struct ServiceSession {
    pub config: ServiceConfig,
    pub webview_label: String,
}
impl ServiceSession {
    fn new(config: &ServiceConfig) -> Self {
        Self {
            config: config.clone(),
            webview_label: label(&config.id),
        }
    }
}

pub fn label(id: &str) -> String {
    format!("service-{id}")
}
pub fn active(app: &AppHandle) -> Option<Webview> {
    state::current(app).active().and_then(|s| {
        let creating = app
            .state::<Lifecycle>()
            .1
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .creating
            .as_ref()
            .is_some_and(|ticket| ticket.identity.id == s.id);
        (!creating)
            .then(|| app.get_webview(&label(&s.id)))
            .flatten()
    })
}
pub fn configured(app: &AppHandle, service: &ServiceConfig) -> bool {
    configured_identity(&state::current(app), service)
}
fn configured_identity(settings: &state::Settings, service: &ServiceConfig) -> bool {
    settings.services.iter().any(|current| {
        current.enabled && SessionIdentity::from(current) == SessionIdentity::from(service)
    })
}

/// Validate and mutate a captured session without allowing a settings replacement between them.
pub fn with_configured<T>(
    app: &AppHandle,
    service: &ServiceConfig,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let lifecycle = app.state::<Lifecycle>();
    // Swiph3l: UI callbacks must fail a concurrent transition instead of waiting
    // for a worker that may itself need the UI. The action cannot reenter services
    // transitions or wait for native UI work while this nonreentrant guard lives.
    let _transition = lifecycle
        .0
        .try_lock()
        .map_err(|_| "Service is changing. Try again.")?;
    if !configured_identity(&state::current(app), service) {
        return Err("Service is no longer configured.".into());
    }
    action()
}

pub fn external(app: &AppHandle, service: &ServiceConfig, url: &url::Url, source_window: &str) {
    crate::external_links::request(app, service, url, source_window);
}
pub fn layout(app: &AppHandle) {
    let Some(window) = app.get_window("main") else {
        return;
    };
    let Ok(size) = window.inner_size() else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;
    if let Some(rail) = app.get_webview("main") {
        let _ = rail.set_size(tauri::LogicalSize::new(width, height));
    }
    for service in state::current(app).services {
        if let Some(view) = app.get_webview(&label(&service.id)) {
            // Swiph3l: Resize and deferred selection can run between native
            // registration and hide(). Keep that reserved view offscreen until
            // startup has hidden it; completion reapplies the latest bounds.
            if app
                .state::<Lifecycle>()
                .1
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .reserved(&service.id)
            {
                continue;
            }
            let _ = view.set_position(tauri::LogicalPosition::new(RAIL_WIDTH, 0.));
            let _ = view.set_size(service_size(width, height));
        }
    }
}
pub fn show(app: &AppHandle) -> Result<(), String> {
    let settings = state::current(app);
    let Some(service) = settings.active().cloned() else {
        // A skipped setup or an empty existing profile owns a normal workspace.
        layout(app);
        let _ = app.emit_to("main", "services-changed", &settings);
        crate::unread::refresh(app);
        crate::connection::refresh(app);
        return Ok(());
    };
    let deferred = app
        .state::<Lifecycle>()
        .1
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .defer_presentation(&service);
    let session_label = label(&service.id);
    if !deferred && app.get_webview(&session_label).is_none() {
        create(app, &service)?;
    }
    for configured in &settings.services {
        if let Some(view) = app.get_webview(&label(&configured.id)) {
            if configured.id == service.id {
                if deferred {
                    continue;
                }
                view.show()
            } else {
                view.hide()
            }
            .map_err(|_| "Could not switch service.")?;
        }
    }
    layout(app);
    crate::unread::sync_presentation(app);
    let _ = app.emit_to("main", "services-changed", &settings);
    crate::unread::refresh(app);
    crate::connection::refresh(app);
    if deferred {
        return Ok(());
    }
    // Swiph3l: Switching services preserves provider unread; focus alone is never a read acknowledgement.
    active(app)
        .ok_or("Service unavailable.")?
        .set_focus()
        .map_err(|_| "Could not focus service.".into())
}
pub fn activate(app: &AppHandle, id: &str) -> Result<(), String> {
    let lifecycle = app.state::<Lifecycle>();
    let _transition = lifecycle.0.lock().unwrap_or_else(|e| e.into_inner());
    let mut settings = state::current(app);
    if !settings.services.iter().any(|s| s.id == id && s.enabled) {
        return Err("Choose an enabled configured service.".into());
    }
    settings.active_service = Some(id.into());
    state::persist(app, settings)?;
    show(app)
}

/// Activate only the existing session that produced a retained notification.
pub fn activate_configured(app: &AppHandle, service: &ServiceConfig) -> Result<(), String> {
    let lifecycle = app.state::<Lifecycle>();
    // Swiph3l: Toast COM callbacks belong to the UI apartment. Fail a concurrent
    // settings transition instead of blocking that UI behind native worker calls.
    let _transition = lifecycle
        .0
        .try_lock()
        .map_err(|_| "Service is changing. Try again.")?;
    let mut settings = state::current(app);
    if !configured_identity(&settings, service) {
        return Err("Notification service is no longer configured.".into());
    }
    let startup = lifecycle
        .1
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if startup.stopping
        || startup
            .creating
            .as_ref()
            .is_some_and(|ticket| ticket.identity.id == service.id)
    {
        return Err("Notification service is not ready.".into());
    }
    drop(startup);
    if app.get_webview(&label(&service.id)).is_none() {
        return Err("Notification session is no longer available.".into());
    }
    let window = app
        .get_window("main")
        .ok_or("Desktop window unavailable.")?;
    crate::window::focus(&window).map_err(|_| "Could not restore ChatPlus.")?;
    if settings.active_service.as_deref() != Some(service.id.as_str()) {
        settings.active_service = Some(service.id.clone());
        state::persist(app, settings)?;
    }
    // The authoritative identity and existing view stay protected by the
    // transition lock. This path cannot create a WebView on the COM/UI thread.
    show(app)
}

fn reorder_configuration(settings: &mut state::Settings, ids: &[String]) -> Result<bool, String> {
    let enabled: Vec<_> = settings
        .services
        .iter()
        .filter(|service| service.enabled)
        .collect();
    let unique: std::collections::HashSet<_> = ids.iter().map(String::as_str).collect();
    if ids.len() != enabled.len()
        || unique.len() != ids.len()
        || enabled
            .iter()
            .any(|service| !unique.contains(service.id.as_str()))
    {
        return Err("Services changed. Try ordering them again.".into());
    }
    if enabled
        .iter()
        .zip(ids)
        .all(|(service, id)| service.id == *id)
    {
        return Ok(false);
    }
    let reordered: Vec<ServiceConfig> = ids
        .iter()
        .map(|id| (**enabled.iter().find(|service| service.id == *id).unwrap()).clone())
        .collect();
    // Disabled services retain their full-list slots; the rail orders enabled entries only.
    let mut reordered = reordered.into_iter();
    for service in settings
        .services
        .iter_mut()
        .filter(|service| service.enabled)
    {
        *service = reordered.next().unwrap();
    }
    Ok(true)
}

pub fn reorder(app: &AppHandle, ids: &[String]) -> Result<state::Settings, String> {
    let lifecycle = app.state::<Lifecycle>();
    let _transition = lifecycle
        .0
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    // Apply only order to the authoritative state, preserving current preferences and session IDs.
    let mut settings = state::current(app);
    if reorder_configuration(&mut settings, ids)? {
        state::persist(app, settings)?;
    }
    // Persistence broadcasts Settings and rail snapshots without recreating/focusing provider views.
    Ok(state::current(app))
}
pub fn save(app: &AppHandle, settings: state::Settings) -> Result<(), String> {
    let lifecycle = app.state::<Lifecycle>();
    let _transition = lifecycle.0.lock().unwrap_or_else(|e| e.into_inner());
    // Swiph3l: Persist and reconcile under one lock so removal cannot race service activation or mute.
    let old = state::current(app);
    state::persist(app, settings)?;
    reconcile_current(app, &old).map_err(|error| {
        if error.starts_with("Settings saved.") {
            error
        } else {
            format!("Settings saved. Restart to apply service changes. {error}")
        }
    })
}

pub fn complete_onboarding(app: &AppHandle) -> Result<state::Settings, String> {
    let lifecycle = app.state::<Lifecycle>();
    let _transition = lifecycle.0.lock().unwrap_or_else(|e| e.into_inner());
    let mut settings = state::current(app);
    if !settings.onboarding_completed {
        settings.onboarding_completed = true;
        state::persist(app, settings)?;
    }
    Ok(state::current(app))
}

pub(crate) fn update_notification_config(
    settings: &mut state::Settings,
    id: &str,
    enabled: bool,
) -> Result<(), String> {
    let service = settings
        .services
        .iter_mut()
        .find(|service| service.id == id && service.enabled)
        .ok_or("Choose an enabled configured service.")?;
    if !service.supports_notifications() {
        return Err("Desktop notifications are not supported for this provider.".into());
    }
    service.notifications = enabled;
    Ok(())
}
pub fn set_notifications(app: &AppHandle, id: &str, enabled: bool) -> Result<(), String> {
    let lifecycle = app.state::<Lifecycle>();
    let _transition = lifecycle.0.lock().unwrap_or_else(|e| e.into_inner());
    // Swiph3l: Read under the transition lock so a stale menu cannot resurrect a removed service.
    let mut settings = state::current(app);
    update_notification_config(&mut settings, id, enabled)?;
    state::persist(app, settings)
}

fn remove_configuration(settings: &mut state::Settings, id: &str) -> Result<(), String> {
    let index = settings
        .services
        .iter()
        .position(|service| service.id == id)
        .ok_or("Service is no longer configured.")?;
    settings.services.remove(index);
    // Swiph3l: Mark the schema migrated before removing the last service or legacy settings recreate it.
    settings.service_schema = 1;
    settings.migrate_services()?;
    Ok(())
}

#[cfg(test)]
mod removal_tests {
    use super::*;
    use crate::providers::ProviderId;
    fn settings() -> state::Settings {
        let mut settings = state::Settings {
            service_schema: 1,
            active_service: Some("first".into()),
            services: ["first", "second"]
                .into_iter()
                .map(|id| ServiceConfig {
                    id: id.into(),
                    provider: ProviderId::SynologyChatplus,
                    name: id.into(),
                    url: "https://example.com/chat/".into(),
                    enabled: true,
                    notifications: true,
                    notification_color: crate::providers::NotificationColor::Auto,
                })
                .collect(),
            ..Default::default()
        };
        settings.migrate_services().unwrap();
        settings
    }

    #[test]
    fn captured_session_rejects_replacement_but_accepts_presentation_changes() {
        let original = settings();
        let captured = original.services[0].clone();
        assert!(configured_identity(&original, &captured));

        let mut presentation = original.clone();
        presentation.services[0].name = "Renamed account".into();
        presentation.services[0].notifications = false;
        presentation.active_service = Some(original.services[1].id.clone());
        assert!(configured_identity(&presentation, &captured));

        let mut replacement = original.clone();
        replacement.services[0].url = "https://replacement.example/".into();
        assert!(!configured_identity(&replacement, &captured));
        replacement = original.clone();
        replacement.services[0].provider = ProviderId::Discord;
        assert!(!configured_identity(&replacement, &captured));
        replacement = original.clone();
        replacement.services[0].enabled = false;
        assert!(!configured_identity(&replacement, &captured));
        replacement.services.remove(0);
        assert!(!configured_identity(&replacement, &captured));
    }

    #[test]
    fn startup_keeps_selected_session_and_starts_remaining_enabled_accounts_in_rail_order() {
        let mut settings = settings();
        let mut disabled = settings.services[0].clone();
        disabled.id = "disabled".into();
        disabled.enabled = false;
        let mut last = settings.services[0].clone();
        last.id = "same-provider-other-account".into();
        settings.services.insert(1, disabled);
        settings.services.push(last);
        settings.active_service = Some("second".into());
        let unchanged = serde_json::to_value(&settings).unwrap();
        let mut startup = Startup::default();
        assert!(startup.begin());
        assert!(
            !startup.begin(),
            "reconciliation must not spawn another worker"
        );
        let mut existing = std::collections::HashSet::from(["second".to_string()]);
        let first = startup.next(&settings, |id| existing.contains(id)).unwrap();
        assert_eq!(first.id, "first");
        existing.insert(first.id.clone());
        let last = startup.next(&settings, |id| existing.contains(id)).unwrap();
        assert_eq!(last.id, "same-provider-other-account");
        assert_ne!(
            first.profile_directory(std::path::Path::new("profiles")),
            last.profile_directory(std::path::Path::new("profiles"))
        );
        existing.insert(last.id);
        assert!(startup
            .next(&settings, |id| existing.contains(id))
            .is_none());
        assert_eq!(serde_json::to_value(&settings).unwrap(), unchanged);
    }

    #[test]
    fn startup_waits_for_document_completion_with_a_minimum_gap_and_offline_deadline() {
        let settings = settings();
        let now = Instant::now();
        let mut startup = Startup::default();
        let ticket = startup.register(&settings.services[0], now);
        assert_eq!(
            startup.remaining(&ticket, &settings, now),
            STARTUP_LOAD_LIMIT
        );
        assert_eq!(
            startup.remaining(&ticket, &settings, now + STARTUP_GAP),
            STARTUP_LOAD_LIMIT - STARTUP_GAP
        );
        assert!(startup.loaded(&ticket, true));
        assert_eq!(startup.remaining(&ticket, &settings, now), STARTUP_GAP);
        assert_eq!(
            startup.remaining(&ticket, &settings, now + STARTUP_GAP),
            Duration::ZERO
        );
        assert!(startup.loaded(&ticket, false));
        assert_eq!(
            startup.remaining(&ticket, &settings, now + STARTUP_LOAD_LIMIT),
            Duration::ZERO
        );
    }

    #[test]
    fn startup_rechecks_removed_disabled_reconfigured_and_manually_opened_services() {
        let mut settings = settings();
        let now = Instant::now();
        let mut startup = Startup::default();
        assert!(startup.begin());
        let first = startup.next(&settings, |_| false).unwrap();
        let ticket = startup.register(&first, now);
        settings.services[0].enabled = false;
        assert_eq!(startup.remaining(&ticket, &settings, now), Duration::ZERO);
        settings.services[0].enabled = true;
        settings.services[0].url = "https://changed.example/chat/".into();
        assert_eq!(startup.remaining(&ticket, &settings, now), Duration::ZERO);
        let replacement = startup.next(&settings, |_| false).unwrap();
        assert_eq!(replacement.url, "https://changed.example/chat/");
        let replacement_ticket = startup.register(&replacement, now);
        assert!(
            !startup.loaded(&ticket, true),
            "old view completion cannot release a replacement"
        );
        assert_eq!(
            startup.remaining(&replacement_ticket, &settings, now),
            STARTUP_LOAD_LIMIT
        );
        settings.services.remove(0);
        assert!(
            startup.next(&settings, |id| id == "second").is_none(),
            "a manually opened account must not be recreated"
        );
        assert_eq!(
            settings.active_service.as_deref(),
            Some("first"),
            "queue policy must not change selection"
        );
    }

    #[test]
    fn a_failed_start_is_not_retried_in_a_hot_loop_but_a_later_reconciliation_can_retry() {
        let settings = settings();
        let mut startup = Startup::default();
        assert!(startup.begin());
        assert_eq!(startup.next(&settings, |_| false).unwrap().id, "first");
        assert_eq!(startup.next(&settings, |_| false).unwrap().id, "second");
        assert!(startup.next(&settings, |_| false).is_none());
        startup.running = false;
        assert!(startup.begin());
        assert_eq!(startup.next(&settings, |_| false).unwrap().id, "first");
    }

    #[test]
    fn activation_during_creation_is_deferred_and_old_completion_cannot_release_or_close_replacement(
    ) {
        let mut settings = settings();
        let now = Instant::now();
        let mut startup = Startup::default();
        let old = startup.register(&settings.services[0], now);
        startup.creating = Some(old.clone());
        assert!(
            startup.reserved("first"),
            "layout must leave the in-progress view offscreen"
        );
        assert!(!startup.reserved("second"));
        assert!(startup.defer_presentation(&settings.services[0]));
        settings.services[0].url = "https://replacement.example/chat/".into();
        assert!(
            startup.defer_presentation(&settings.services[0]),
            "same-label replacement waits until old creation is disposed"
        );
        assert!(
            startup.presentation.as_ref() == Some(&SessionIdentity::from(&settings.services[0]))
        );
        assert!(
            startup.reserved("first"),
            "deferred selection/reconfiguration must not expose the view before hide"
        );
        let replacement = startup.register(&settings.services[0], now);
        startup.creating = Some(replacement.clone());
        startup.release(&old);
        assert!(startup
            .creating
            .as_ref()
            .is_some_and(|ticket| ticket.generation == replacement.generation));
        assert!(!startup.owns(&old));
        assert!(startup.current(&replacement));
        assert!(!startup.defer_presentation(&settings.services[1]));
        startup.release(&replacement);
        assert!(
            !startup.reserved("first"),
            "only current completion may rejoin layout"
        );
    }

    #[test]
    fn shutdown_wakes_the_worker_without_waiting_on_the_ui_transition_and_is_terminal() {
        use std::sync::{mpsc, Arc};
        let lifecycle = Arc::new(Lifecycle::default());
        let _transition = lifecycle.0.lock().unwrap();
        let (ready_tx, ready_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let worker_lifecycle = lifecycle.clone();
        let worker = std::thread::spawn(move || {
            let mut startup = worker_lifecycle.1.lock().unwrap();
            ready_tx.send(()).unwrap();
            while !startup.stopping {
                startup = worker_lifecycle.2.wait(startup).unwrap();
            }
            assert!(!startup.begin());
            assert!(startup.next(&settings(), |_| false).is_none());
            done_tx.send(()).unwrap();
        });
        ready_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        lifecycle.stop();
        done_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        worker.join().unwrap();
    }

    #[test]
    fn background_creation_is_staged_outside_the_selected_surface() {
        for width in [1., 300., 900., 1280.] {
            let background = creation_position(false, width);
            assert!(
                background.x + width < 0.,
                "initial provider paint must be outside the window"
            );
            assert_eq!(creation_position(true, width).x, RAIL_WIDTH);
        }
    }
    #[test]
    fn first_service_and_add_another_wait_for_continue_while_skip_opens_an_empty_workspace() {
        use std::cell::RefCell;
        let events = RefCell::new(Vec::new());
        let reconcile = |settings: &state::Settings, main_exists| {
            reconcile_workspace(
                settings,
                main_exists,
                || {
                    events.borrow_mut().push("open-main");
                    Ok(())
                },
                || {
                    events.borrow_mut().push("show-services");
                    Ok(())
                },
            )
            .unwrap();
        };
        let mut onboarding = state::Settings::default();
        for service in settings().services {
            onboarding.services.push(service);
            onboarding.migrate_services().unwrap();
            reconcile(&onboarding, false);
            assert!(
                events.borrow().is_empty(),
                "saving a service must leave Add another/Continue visible"
            );
        }
        onboarding.onboarding_completed = true;
        reconcile(&onboarding, false);
        assert_eq!(*events.borrow(), ["open-main", "show-services"]);
        events.borrow_mut().clear();
        onboarding.services.clear();
        onboarding.migrate_services().unwrap();
        reconcile(&onboarding, false);
        assert_eq!(
            *events.borrow(),
            ["open-main", "show-services"],
            "Skip must open the workspace without a provider"
        );
        events.borrow_mut().clear();
        reconcile(&onboarding, true);
        assert_eq!(
            *events.borrow(),
            ["show-services"],
            "existing Main is never recreated by settings saves"
        );
    }
    #[test]
    fn native_service_geometry_reserves_footer_and_stays_positive_at_any_scale() {
        for scale in [1., 1.25, 1.5, 2.] {
            let size = service_size(1366. / scale, 768. / scale);
            assert_eq!(size.width, 1366. / scale - RAIL_WIDTH);
            assert_eq!(size.height, 768. / scale - FOOTER_HEIGHT);
        }
        assert_eq!(service_size(10., 10.), tauri::LogicalSize::new(1., 1.));
    }
    #[test]
    fn removal_reselects_active_preserves_other_profile_and_survives_restart() {
        let mut settings = settings();
        let profile = settings.services[1].profile_directory(std::path::Path::new("profiles"));
        remove_configuration(&mut settings, "first").unwrap();
        assert_eq!(settings.active_service.as_deref(), Some("second"));
        assert_eq!(settings.services.len(), 1);
        assert_eq!(
            settings.services[0].profile_directory(std::path::Path::new("profiles")),
            profile
        );
        let mut restarted: state::Settings =
            serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
        restarted.migrate_services().unwrap();
        assert_eq!(restarted.services.len(), 1);
        assert_eq!(restarted.services[0].id, "second");
        assert!(remove_configuration(&mut restarted, "first").is_err());
    }
    #[test]
    fn last_service_removal_never_recreates_legacy_configuration() {
        let mut settings = settings();
        remove_configuration(&mut settings, "second").unwrap();
        assert_eq!(settings.active_service.as_deref(), Some("first"));
        settings.service_schema = 0;
        remove_configuration(&mut settings, "first").unwrap();
        assert!(settings.services.is_empty());
        assert!(settings.active_service.is_none());
        assert!(settings.server_url.is_empty());
        assert_eq!(settings.service_schema, 1);
        settings.migrate_services().unwrap();
        assert!(settings.services.is_empty());
    }

    #[test]
    fn mattermost_removal_keeps_the_other_account_and_unrelated_preferences() {
        let mut settings = settings();
        for service in &mut settings.services {
            service.provider = ProviderId::Mattermost;
        }
        settings.theme = state::Theme::Dark;
        settings.unread_title = false;
        settings.migrate_services().unwrap();
        let retained = settings.services[1].clone();
        let profile = retained.profile_directory(std::path::Path::new("profiles"));
        remove_configuration(&mut settings, "first").unwrap();
        assert_eq!(settings.services, vec![retained]);
        assert_eq!(settings.active_service.as_deref(), Some("second"));
        assert!(matches!(settings.theme, state::Theme::Dark));
        assert!(!settings.unread_title);
        assert_eq!(
            settings.services[0].profile_directory(std::path::Path::new("profiles")),
            profile
        );
        let mut restarted: state::Settings =
            serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
        restarted.migrate_services().unwrap();
        assert_eq!(restarted.services, settings.services);
    }

    #[test]
    fn rail_reordering_preserves_disabled_slots_profiles_active_and_preferences() {
        let mut settings = settings();
        let mut hidden = settings.services[0].clone();
        hidden.id = "hidden".into();
        hidden.enabled = false;
        hidden.notifications = false;
        settings.services.insert(1, hidden.clone());
        settings.theme = state::Theme::Dark;
        settings.unread_title = false;
        let profiles: Vec<_> = settings
            .services
            .iter()
            .map(|service| {
                (
                    service.id.clone(),
                    service.profile_directory(std::path::Path::new("profiles")),
                )
            })
            .collect();
        assert!(reorder_configuration(&mut settings, &["second".into(), "first".into()]).unwrap());
        assert_eq!(
            settings
                .services
                .iter()
                .map(|service| service.id.as_str())
                .collect::<Vec<_>>(),
            vec!["second", "hidden", "first"]
        );
        assert_eq!(settings.services[1], hidden);
        assert_eq!(settings.active_service.as_deref(), Some("first"));
        assert!(matches!(settings.theme, state::Theme::Dark));
        assert!(!settings.unread_title);
        for service in &settings.services {
            assert_eq!(
                service.profile_directory(std::path::Path::new("profiles")),
                profiles.iter().find(|(id, _)| id == &service.id).unwrap().1
            );
        }
        let restarted: state::Settings =
            serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
        assert_eq!(restarted.services, settings.services);
        assert!(!reorder_configuration(&mut settings, &["second".into(), "first".into()]).unwrap());
    }

    #[test]
    fn rail_reordering_rejects_stale_missing_duplicate_disabled_and_unknown_ids_atomically() {
        let original = settings();
        for ids in [
            vec!["first"],
            vec!["first", "first"],
            vec!["first", "unknown"],
            vec!["first", "second", "extra"],
            vec![],
        ] {
            let mut current = original.clone();
            let before = serde_json::to_value(&current).unwrap();
            assert!(reorder_configuration(
                &mut current,
                &ids.into_iter().map(String::from).collect::<Vec<_>>()
            )
            .is_err());
            assert_eq!(serde_json::to_value(&current).unwrap(), before);
        }
        let mut current = original;
        current.services[1].enabled = false;
        assert!(reorder_configuration(&mut current, &["second".into(), "first".into()]).is_err());
    }
}

pub fn remove(app: &AppHandle, id: &str) -> Result<(), String> {
    let lifecycle = app.state::<Lifecycle>();
    let _transition = lifecycle.0.lock().unwrap_or_else(|e| e.into_inner());
    let old = state::current(app);
    let mut settings = old.clone();
    remove_configuration(&mut settings, id)?;
    state::persist(app, settings)?;
    reconcile_current(app, &old)
}

fn reconcile_current(app: &AppHandle, old: &state::Settings) -> Result<(), String> {
    let settings = state::current(app);
    for service in &old.services {
        if !settings.services.iter().any(|s| {
            s.id == service.id
                && s.enabled
                && s.provider == service.provider
                && s.url == service.url
        }) {
            if let Some(view) = app.get_webview(&label(&service.id)) {
                view.close()
                    .map_err(|_| "Settings saved. Restart to apply service changes.")?;
            }
            crate::unread::remove(app, &service.id);
        }
    }
    reconcile_workspace(
        &settings,
        app.get_window("main").is_some(),
        || crate::window::open(app),
        || show(app),
    )?;
    if app.get_window("main").is_some() {
        start_configured(app);
    }
    Ok(())
}

fn reconcile_workspace(
    settings: &state::Settings,
    main_exists: bool,
    open: impl FnOnce() -> Result<(), String>,
    show: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if !main_exists {
        // Reuse normal service validation/persistence during first run, but let
        // the user add another service before opening any provider WebViews.
        if !settings.onboarding_completed {
            return Ok(());
        }
        open()?;
    }
    show()
}
fn create(app: &AppHandle, service: &ServiceConfig) -> Result<LoadTicket, String> {
    let lifecycle = app.state::<Lifecycle>();
    let ticket = {
        let mut startup = lifecycle
            .1
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if startup.stopping {
            return Err("Application is shutting down.".into());
        }
        startup.register(service, Instant::now())
    };
    if let Err(error) = create_registered(app, service, &ticket, false) {
        lifecycle
            .1
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .loaded(&ticket, true);
        lifecycle.2.notify_all();
        return Err(error);
    }
    Ok(ticket)
}

fn create_registered(
    app: &AppHandle,
    service: &ServiceConfig,
    ticket: &LoadTicket,
    background: bool,
) -> Result<Webview, String> {
    let session = ServiceSession::new(service);
    let service = &session.config;
    let window = app
        .get_window("main")
        .ok_or("Desktop window unavailable.")?;
    let settings = state::current(app);
    let nav_service = service.clone();
    let popup_service = service.clone();
    let nav_app = app.clone();
    let popup_app = app.clone();
    let load_app = app.clone();
    let load_id = service.id.clone();
    let load_ticket = ticket.clone();
    let url = service
        .provider
        .validate_url(&service.url)?
        .parse()
        .map_err(|_| "Invalid service URL.")?;
    let mut builder = WebviewBuilder::new(&session.webview_label, WebviewUrl::External(url))
        .focused(false)
        .disable_drag_drop_handler()
        .on_navigation(move |target| {
            if !configured(&nav_app, &nav_service) {
                return false;
            }
            if crate::navigation::provider_document(&nav_service, target) {
                true
            } else {
                if crate::downloads::attachment_popup(&nav_service, target) {
                    let _ = crate::downloads::open_attachment_popup(&nav_app, &nav_service, target);
                } else {
                    external(&nav_app, &nav_service, target, "main");
                }
                false
            }
        })
        .on_new_window(move |target, features| {
            if !configured(&popup_app, &popup_service) {
                return tauri::webview::NewWindowResponse::Deny;
            }
            if crate::downloads::popup_allowed(&popup_service, &target) {
                return match crate::downloads::popup(&popup_app, &popup_service, features) {
                    Ok(window) => tauri::webview::NewWindowResponse::Create { window },
                    Err(_) => {
                        crate::shell::report(
                            &popup_app,
                            "Could not open the attachment. Try the download again.".into(),
                        );
                        tauri::webview::NewWindowResponse::Deny
                    }
                };
            }
            external(&popup_app, &popup_service, &target, "main");
            tauri::webview::NewWindowResponse::Deny
        })
        .on_page_load(move |_, payload| {
            if let Some(lifecycle) = load_app.try_state::<Lifecycle>() {
                let current = lifecycle
                    .1
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .loaded(
                        &load_ticket,
                        matches!(payload.event(), tauri::webview::PageLoadEvent::Finished),
                    );
                lifecycle.2.notify_all();
                if !current {
                    return;
                }
            }
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                crate::unread::invalidate_presentation(&load_app, &load_id);
                crate::connection::set_for(
                    &load_app,
                    &load_id,
                    crate::connection::Connection::Connecting,
                );
            }
        });
    // Swiph3l: The migrated primary service retains its original profile so existing logins survive migration.
    if let Some(profile) = service.profile_directory(
        &app.path()
            .app_local_data_dir()
            .map_err(|_| "Could not resolve service profile.")?,
    ) {
        builder = builder.data_directory(profile);
    }
    if service.provider.definition().theme {
        let dark = match settings.theme {
            state::Theme::Dark => true,
            state::Theme::Light => false,
            state::Theme::System => window.theme().ok() == Some(tauri::Theme::Dark),
        };
        // Swiph3l: Document-start CSS cannot color the child WebView's native
        // pre-document/navigation frame. Match the opt-in provider's theme early.
        builder = builder.background_color(if dark {
            tauri::window::Color(15, 17, 21, 255)
        } else {
            tauri::window::Color(255, 255, 255, 255)
        });
        builder = builder.initialization_script(format!(
            "window.__chatplusTheme = {};\n{}",
            serde_json::to_string(&settings.theme).unwrap(),
            include_str!("../theme-bootstrap.js")
        ));
    }
    if service.supports_unread() {
        // Swiph3l: Unread adapters are provider-specific and independent of theme support; Discord and Synology Chat must never receive ChatPlus styling.
        builder = builder.initialization_script(format!(
            "window.__chatplusProvider = {};\n{}",
            serde_json::to_string(&service.unread_source_provider()).unwrap(),
            include_str!("../unread-bootstrap.js")
        ));
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    let size = window
        .inner_size()
        .map_err(|_| "Could not measure desktop window.")?;
    let bounds = service_size(size.width as f64 / scale, size.height as f64 / scale);
    let selected = !background && settings.active_service.as_deref() == Some(service.id.as_str());
    let view = window
        .add_child(
            builder,
            // Swiph3l: Tauri has no hidden child-builder flag. Stage background
            // controllers fully outside the client area before hiding them, so
            // initial provider paint cannot cover the selected conversation.
            creation_position(selected, bounds.width),
            bounds,
        )
        .map_err(|_| "Could not create service WebView. Check WebView2 installation.")?;
    let attach = || -> Result<(), String> {
        if !configured(app, service)
            || !app
                .state::<Lifecycle>()
                .1
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .current(ticket)
        {
            return Err("Service changed during startup.".into());
        }
        if !selected {
            view.hide()
                .map_err(|_| "Could not hide background service.")?;
            view.set_position(tauri::LogicalPosition::new(RAIL_WIDTH, 0.))
                .map_err(|_| "Could not position background service.")?;
        }
        crate::native_shortcuts::attach(app, &view)
            .map_err(|_| "Could not register service shortcuts.")?;
        crate::platform::observe_connection(app, &view, &service.id)
            .map_err(|_| "Could not observe service connection.")?;
        crate::downloads::attach(app, &view, &service.id)
            .map_err(|_| "Could not observe attachment downloads.")?;
        crate::notification_bridge::attach(app, &view, service)
            .map_err(|_| "Could not attach service bridge.")?;
        crate::menu::restore_zoom(app, &view).map_err(|_| "Could not restore zoom.")?;
        Ok(())
    };
    if let Err(error) = attach() {
        let _ = view.close();
        return Err(error);
    }
    Ok(view)
}
