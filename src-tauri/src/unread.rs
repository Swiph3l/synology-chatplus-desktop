//! Provider observations and desktop presentation are separate. Focus never marks messages read.
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Source {
    ChatPlusDom,
}
#[derive(Clone, Default, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Unread {
    pub total_unread_count: Option<u32>,
    pub has_unread: bool,
    pub mention_count: Option<u32>,
    pub last_update: Option<u64>,
}
#[derive(Default)]
pub struct Service(Mutex<Tracking>);
#[derive(Default)]
struct Tracking {
    observations: HashMap<String, Unread>,
    foreground_service: Option<String>,
    presentation_generation: u64,
}
pub fn remove(app: &AppHandle, id: &str) {
    app.state::<Service>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .observations
        .remove(id);
    refresh(app);
}
pub fn observations(app: &AppHandle) -> HashMap<String, Unread> {
    app.state::<Service>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .observations
        .clone()
}

pub fn invalidate_presentation(app: &AppHandle, id: &str) {
    let service = app.state::<Service>();
    let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
    if tracking.foreground_service.as_deref() == Some(id) {
        // Swiph3l: Navigation can deliver queued messages from the old document; its interaction generation must not acknowledge the new page.
        tracking.foreground_service = None;
        tracking.presentation_generation += 1;
    }
}

pub fn sync_presentation(app: &AppHandle) {
    let settings = crate::state::current(app);
    let foreground = crate::window::is_foreground(app)
        .then(|| settings.active_service.clone())
        .flatten();
    let generation = {
        let service = app.state::<Service>();
        let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
        if tracking.foreground_service != foreground {
            tracking.foreground_service = foreground.clone();
            tracking.presentation_generation += 1;
        }
        tracking.presentation_generation
    };
    for service in settings
        .services
        .iter()
        .filter(|s| s.enabled && s.provider.definition().unread)
    {
        if let Some(view) = app.get_webview(&crate::services::label(&service.id)) {
            // Swiph3l: WebView focus survives minimize/background transitions; only the native frame knows real visibility.
            let _ = view.eval(&format!(
                "window.__chatplusSetForeground?.({}, {})",
                foreground.as_deref() == Some(&service.id),
                generation
            ));
        }
    }
}

pub fn incoming_for(app: &AppHandle, id: &str, first_observation: bool) {
    let settings = crate::state::current(app);
    let foreground =
        settings.active_service.as_deref() == Some(id) && crate::window::is_foreground(app);
    let service = app.state::<Service>();
    let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
    let (revoked, changed) =
        observe_browser_event(&mut tracking, id, foreground, now(), first_observation);
    drop(tracking);
    if revoked {
        sync_presentation(app);
    }
    if changed {
        refresh(app);
    }
}

fn observe_browser_event(
    tracking: &mut Tracking,
    id: &str,
    foreground: bool,
    at: u64,
    first_observation: bool,
) -> (bool, bool) {
    // Swiph3l: Only a new browser event owns unread; a duplicate native retry must not resurrect a message already acknowledged by the user.
    if first_observation {
        observe_incoming(tracking, id, foreground, at)
    } else {
        (false, false)
    }
}

fn observe_incoming(tracking: &mut Tracking, id: &str, foreground: bool, at: u64) -> (bool, bool) {
    let revoked = tracking.foreground_service.as_deref() == Some(id);
    if revoked {
        // Swiph3l: An earlier gesture must not read a later message, even when both native events occur in the same foreground session.
        tracking.presentation_generation += 1;
    }
    let changed = !foreground && observe(&mut tracking.observations, id, true, false, at);
    (revoked, changed)
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn aggregate<'a>(values: impl Iterator<Item = &'a Unread>) -> Unread {
    values.fold(Unread::default(), |mut result, value| {
        result.has_unread |= value.has_unread;
        result.last_update = result.last_update.max(value.last_update);
        result
    })
}
pub fn current(app: &AppHandle) -> Unread {
    let settings = crate::state::current(app);
    let states = observations(app);
    aggregate(
        settings
            .services
            .iter()
            .filter(|s| s.enabled)
            .filter_map(|s| states.get(&s.id)),
    )
}
pub fn title(value: &Unread, enabled: bool) -> String {
    if enabled && value.has_unread {
        "ChatPlus Desktop •".into()
    } else {
        "ChatPlus Desktop".into()
    }
}
pub fn publish_for(
    app: &AppHandle,
    id: &str,
    _count: Option<u32>,
    has_unread: bool,
    _source: Source,
    _reason: &str,
    acknowledgement: Option<u64>,
) {
    let settings = crate::state::current(app);
    let foreground =
        settings.active_service.as_deref() == Some(id) && crate::window::is_foreground(app);
    let service = app.state::<Service>();
    let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
    let acknowledged = read_acknowledged(&tracking, id, foreground, acknowledgement);
    let at = now();
    if !observe(&mut tracking.observations, id, has_unread, acknowledged, at) {
        return;
    }
    drop(tracking);
    refresh(app);
}

fn read_acknowledged(
    tracking: &Tracking,
    id: &str,
    foreground: bool,
    acknowledgement: Option<u64>,
) -> bool {
    // Swiph3l: Revalidate visibility and generation at receipt so queued input cannot clear a service after minimize or a service switch.
    foreground
        && tracking.foreground_service.as_deref() == Some(id)
        && acknowledgement == Some(tracking.presentation_generation)
}

fn observe(
    states: &mut HashMap<String, Unread>,
    id: &str,
    has_unread: bool,
    acknowledged: bool,
    at: u64,
) -> bool {
    // Swiph3l: A provider can remove badges while its selected WebView is backgrounded; only a current user acknowledgement clears cached unread.
    if states
        .get(id)
        .is_some_and(|value| value.has_unread && !has_unread && !acknowledged)
        || states
            .get(id)
            .is_some_and(|value| value.has_unread == has_unread)
    {
        return false;
    }
    states.insert(
        id.into(),
        Unread {
            has_unread,
            last_update: Some(at),
            ..Unread::default()
        },
    );
    true
}
pub fn refresh(app: &AppHandle) {
    let unread = current(app);
    let settings = crate::state::current(app);
    if let Some(window) = app.get_window("main") {
        let _ = window.set_title(&title(&unread, settings.unread_title));
        crate::desktop_notifications::taskbar(&window, &unread);
        let _ = app.emit_to("main", "service-unread", observations(app));
    }
    crate::tray::refresh(app);
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn desktop_aggregation_preserves_other_services() {
        let values = [
            Unread {
                has_unread: true,
                last_update: Some(1),
                ..Unread::default()
            },
            Unread {
                has_unread: false,
                last_update: Some(2),
                ..Unread::default()
            },
        ];
        let result = aggregate(values.iter());
        assert!(result.has_unread);
        assert_eq!(result.total_unread_count, None);
        assert_eq!(title(&result, true), "ChatPlus Desktop •");
        assert_eq!(title(&result, false), "ChatPlus Desktop");
    }
    #[test]
    fn selected_service_unread_survives_minimize_and_clears_only_on_current_user_acknowledgement() {
        let mut tracking = Tracking {
            foreground_service: Some("selected".into()),
            presentation_generation: 4,
            ..Default::default()
        };
        assert!(observe(
            &mut tracking.observations,
            "selected",
            true,
            false,
            1
        ));
        for (foreground, acknowledgement) in [(false, Some(4)), (true, None), (true, Some(3))] {
            let accepted = read_acknowledged(&tracking, "selected", foreground, acknowledgement);
            assert!(!observe(
                &mut tracking.observations,
                "selected",
                false,
                accepted,
                2
            ));
            assert!(tracking.observations["selected"].has_unread);
        }
        let accepted = read_acknowledged(&tracking, "selected", true, Some(4));
        assert!(observe(
            &mut tracking.observations,
            "selected",
            false,
            accepted,
            3
        ));
        assert!(!tracking.observations["selected"].has_unread);
    }
    #[test]
    fn acknowledgement_cannot_clear_another_service_or_remove_its_aggregate_badge() {
        let mut tracking = Tracking {
            foreground_service: Some("first".into()),
            presentation_generation: 2,
            ..Default::default()
        };
        observe(&mut tracking.observations, "first", true, false, 1);
        observe(&mut tracking.observations, "second", true, false, 1);
        assert!(!read_acknowledged(&tracking, "second", true, Some(2)));
        let accepted = read_acknowledged(&tracking, "first", true, Some(2));
        observe(&mut tracking.observations, "first", false, accepted, 2);
        assert!(!tracking.observations["first"].has_unread);
        assert!(tracking.observations["second"].has_unread);
        assert!(aggregate(tracking.observations.values()).has_unread);
    }
    #[test]
    fn initial_empty_provider_observation_is_known_but_cannot_clear_existing_unread() {
        let mut states = HashMap::new();
        assert!(observe(&mut states, "service", false, false, 1));
        assert_eq!(states["service"].last_update, Some(1));
        assert!(observe(&mut states, "service", true, false, 2));
        assert!(!observe(&mut states, "service", false, false, 3));
        assert_eq!(states["service"].last_update, Some(2));
    }
    #[test]
    fn new_native_message_revokes_earlier_input_but_does_not_invent_unread_for_a_viewed_conversation(
    ) {
        let mut tracking = Tracking {
            foreground_service: Some("selected".into()),
            presentation_generation: 4,
            ..Default::default()
        };
        assert_eq!(
            observe_incoming(&mut tracking, "selected", true, 1),
            (true, false)
        );
        assert!(tracking.observations.is_empty());
        assert!(!read_acknowledged(&tracking, "selected", true, Some(4)));
        assert_eq!(tracking.presentation_generation, 5);
        assert_eq!(
            observe_incoming(&mut tracking, "selected", false, 2),
            (true, true)
        );
        assert!(tracking.observations["selected"].has_unread);
        assert!(!read_acknowledged(&tracking, "selected", false, Some(6)));
        assert_eq!(
            observe_incoming(&mut tracking, "other", false, 3),
            (false, true)
        );
        assert_eq!(
            tracking.presentation_generation, 6,
            "another service's message must not invalidate this conversation's read token"
        );
        assert!(tracking.observations["other"].has_unread);
    }
    #[test]
    fn duplicate_native_callback_cannot_resurrect_acknowledged_unread_after_minimize() {
        let mut tracking = Tracking::default();
        assert_eq!(
            observe_browser_event(&mut tracking, "origin", false, 1, true),
            (false, true)
        );
        tracking.foreground_service = Some("origin".into());
        tracking.presentation_generation = 1;
        let acknowledged = read_acknowledged(&tracking, "origin", true, Some(1));
        assert!(observe(
            &mut tracking.observations,
            "origin",
            false,
            acknowledged,
            2
        ));
        tracking.foreground_service = None;
        tracking.presentation_generation = 2;
        assert_eq!(
            observe_browser_event(&mut tracking, "origin", false, 3, false),
            (false, false)
        );
        assert!(!tracking.observations["origin"].has_unread);
        assert_eq!(tracking.presentation_generation, 2);
        assert_eq!(
            observe_browser_event(&mut tracking, "origin", false, 4, true),
            (false, true)
        );
        assert!(
            tracking.observations["origin"].has_unread,
            "a legitimate new message still updates unread independently of toast policy"
        );
    }
}
