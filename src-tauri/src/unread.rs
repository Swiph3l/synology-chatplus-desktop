//! Provider observations and desktop presentation are separate. Focus never marks messages read.
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
pub(crate) const READ_ARRIVAL_LIMIT: usize = 256;
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Source {
    ChatPlusDom,
    SynologyChatDom,
    DiscordDom,
}
impl Source {
    pub fn accepts(self, provider: crate::providers::ProviderId) -> bool {
        matches!(
            (self, provider),
            (
                Self::ChatPlusDom,
                crate::providers::ProviderId::SynologyChatplus
            ) | (
                Self::SynologyChatDom,
                crate::providers::ProviderId::SynologyChat
            ) | (Self::DiscordDom, crate::providers::ProviderId::Discord)
        )
    }
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
    read_generations: HashMap<String, ReadProof>,
    incoming_generations: HashMap<String, u64>,
    pending_generations: HashMap<String, HashSet<u64>>,
    observed_unread_arrivals: HashMap<String, HashSet<u64>>,
    observed_unread_overflow: HashSet<String>,
    incoming_sequence: u64,
    foreground_service: Option<String>,
    presentation_generation: u64,
    visibility_generation: u64,
}
struct ReadProof {
    through: u64,
    excluded: HashSet<u64>,
}
impl ReadProof {
    fn includes(&self, generation: u64) -> bool {
        generation <= self.through && !self.excluded.contains(&generation)
    }
}
pub fn remove(app: &AppHandle, id: &str) {
    let service = app.state::<Service>();
    let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
    tracking.observations.remove(id);
    tracking.read_generations.remove(id);
    tracking.incoming_generations.remove(id);
    tracking.pending_generations.remove(id);
    tracking.observed_unread_arrivals.remove(id);
    tracking.observed_unread_overflow.remove(id);
    drop(tracking);
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
        tracking.visibility_generation += 1;
    }
}

pub fn sync_presentation(app: &AppHandle) {
    let settings = crate::state::current(app);
    let foreground = crate::window::is_foreground(app)
        .then(|| settings.active_service.clone())
        .flatten();
    let projections = {
        let service = app.state::<Service>();
        let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
        if tracking.foreground_service != foreground {
            tracking.foreground_service = foreground.clone();
            tracking.presentation_generation += 1;
            tracking.visibility_generation += 1;
        }
        settings
            .services
            .iter()
            .filter(|s| s.enabled && s.provider.definition().unread)
            .map(|service| {
                (
                    service.id.clone(),
                    presentation_script(&tracking, &service.id),
                )
            })
            .collect::<Vec<_>>()
    };
    for (id, script) in projections {
        if let Some(view) = app.get_webview(&crate::services::label(&id)) {
            // Swiph3l: WebView focus survives minimize/background transitions; only the native frame knows real visibility.
            let _ = view.eval(&script);
        }
    }
}

fn presentation_script(tracking: &Tracking, id: &str) -> String {
    format!(
        "window.__chatplusSetForeground?.({}, {}, {})",
        tracking.foreground_service.as_deref() == Some(id),
        tracking.presentation_generation,
        tracking.incoming_generations.get(id).copied().unwrap_or(0)
    )
}

pub struct IncomingGeneration {
    pub read: u64,
    pub visibility: u64,
}

pub fn begin_incoming_for(
    app: &AppHandle,
    id: &str,
    first_observation: bool,
    previous_generation: Option<u64>,
) -> IncomingGeneration {
    let service = app.state::<Service>();
    let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
    revoke_input(&mut tracking, id, first_observation);
    let read = begin_event(&mut tracking, id, first_observation, previous_generation);
    let generation = IncomingGeneration {
        read,
        visibility: tracking.visibility_generation,
    };
    drop(tracking);
    // Swiph3l: Background arrivals also need a renderer read barrier; retaining
    // each service's latest sequence lets restore retry a missed projection.
    if first_observation {
        sync_presentation(app);
    }
    generation
}

fn revoke_input(tracking: &mut Tracking, id: &str, first_observation: bool) -> bool {
    let revoked = first_observation && tracking.foreground_service.as_deref() == Some(id);
    if revoked {
        // Swiph3l: Revoke old gestures before the asynchronous conversation query;
        // a queued provider acknowledgement must not read a newly arriving message.
        tracking.presentation_generation += 1;
    }
    revoked
}

fn begin_event(
    tracking: &mut Tracking,
    id: &str,
    first_observation: bool,
    previous_generation: Option<u64>,
) -> u64 {
    if !first_observation {
        return previous_generation.unwrap_or(0);
    }
    // Swiph3l: Keep native arrival order separate from WebView gesture generations;
    // later messages must not erase read proof needed by older pending queries.
    tracking.incoming_sequence += 1;
    let generation = tracking.incoming_sequence;
    tracking.incoming_generations.insert(id.into(), generation);
    tracking
        .pending_generations
        .entry(id.into())
        .or_default()
        .insert(generation);
    generation
}

fn record_acknowledgement(tracking: &mut Tracking, id: &str) {
    // Swiph3l: A partial read cannot acknowledge pending or still-unread arrivals;
    // exclusions preserve them across out-of-order queries and duplicate retries.
    let mut excluded = tracking
        .pending_generations
        .get(id)
        .cloned()
        .unwrap_or_default();
    if let Some(arrivals) = tracking.observed_unread_arrivals.get(id) {
        excluded.extend(arrivals);
    }
    let proof = ReadProof {
        through: tracking.incoming_generations.get(id).copied().unwrap_or(0),
        excluded,
    };
    tracking.read_generations.insert(id.into(), proof);
}

fn consume_read_arrivals(tracking: &mut Tracking, id: &str, read_arrivals: &[u64]) -> Vec<u64> {
    // Swiph3l: Empty badges or an unrelated content mutation do not prove that a
    // native message rendered. Each observed arrival needs exact provider read evidence.
    let mut accepted = Vec::new();
    if tracking.observed_unread_overflow.contains(id) {
        return accepted;
    }
    let pending = tracking.pending_generations.get(id);
    if let Some(arrivals) = tracking.observed_unread_arrivals.get_mut(id) {
        for arrival in read_arrivals {
            if !pending.is_some_and(|pending| pending.contains(arrival)) && arrivals.remove(arrival)
            {
                accepted.push(*arrival);
            }
        }
        if arrivals.is_empty() {
            tracking.observed_unread_arrivals.remove(id);
        }
    }
    // Swiph3l: The renderer can miss an accepted-read callback; retrying an already
    // committed token may retire its local tag, without reading an unlisted arrival.
    if let Some(proof) = tracking.read_generations.get(id) {
        for arrival in read_arrivals {
            if proof.includes(*arrival) && !accepted.contains(arrival) {
                accepted.push(*arrival);
            }
        }
    }
    accepted
}

fn native_unread_complete(tracking: &Tracking, id: &str) -> bool {
    !tracking.observed_unread_overflow.contains(id)
        && tracking
            .observed_unread_arrivals
            .get(id)
            .map_or(true, HashSet::is_empty)
}

pub fn accept_read_for(app: &AppHandle, id: &str, arrivals: &[u64]) {
    if !arrivals.is_empty() {
        if let Some(view) = app.get_webview(&crate::services::label(id)) {
            let _ = view.eval(&format!(
                "window.__chatplusAcceptRead?.({})",
                serde_json::to_string(arrivals).unwrap()
            ));
        }
    }
}

pub fn arrival_requires_read(app: &AppHandle, id: &str, arrival: u64) -> bool {
    app.state::<Service>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .observed_unread_arrivals
        .get(id)
        .is_some_and(|arrivals| arrivals.contains(&arrival))
}

fn remember_unread_arrival(tracking: &mut Tracking, id: &str, generation: u64) {
    let arrivals = tracking
        .observed_unread_arrivals
        .entry(id.into())
        .or_default();
    if arrivals.len() < READ_ARRIVAL_LIMIT || arrivals.contains(&generation) {
        arrivals.insert(generation);
    } else {
        // Swiph3l: Bound unproven arrival history without manufacturing zero;
        // dropping proof after overflow must keep this service conservatively unread.
        tracking.observed_unread_overflow.insert(id.into());
    }
}

pub fn complete_incoming_for(app: &AppHandle, id: &str, generation: u64, first_observation: bool) {
    let service = app.state::<Service>();
    let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
    finish_event(&mut tracking, id, generation, first_observation);
}

fn finish_event(tracking: &mut Tracking, id: &str, generation: u64, first_observation: bool) {
    // Swiph3l: A duplicate callback can finish before the original query;
    // it must neither unpend that arrival nor make an old-pane gesture read it.
    if !first_observation {
        return;
    }
    if let Some(pending) = tracking.pending_generations.get_mut(id) {
        pending.remove(&generation);
        if pending.is_empty() {
            tracking.pending_generations.remove(id);
        }
    }
}

pub fn actively_viewed(app: &AppHandle, id: &str, generation: u64, provider_viewed: bool) -> bool {
    let settings = crate::state::current(app);
    let foreground =
        settings.active_service.as_deref() == Some(id) && crate::window::is_foreground(app);
    let service = app.state::<Service>();
    let tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
    viewing_evidence_current(&tracking, id, foreground, generation, provider_viewed)
}

fn viewing_evidence_current(
    tracking: &Tracking,
    id: &str,
    foreground: bool,
    generation: u64,
    provider_viewed: bool,
) -> bool {
    // Swiph3l: A selected foreground provider can still show a different conversation;
    // only current provider evidence for this message can suppress a notification.
    provider_viewed && foreground && tracking.foreground_service.as_deref() == Some(id)
        // Swiph3l: New messages revoke read gestures without changing visibility;
        // overlapping queries for the same viewed conversation must remain valid.
        && generation == tracking.visibility_generation
}

pub fn acknowledged_after(app: &AppHandle, id: &str, generation: u64) -> bool {
    app.state::<Service>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .read_generations
        .get(id)
        .is_some_and(|read| read.includes(generation))
}

pub fn incoming_for(
    app: &AppHandle,
    id: &str,
    first_observation: bool,
    generation: u64,
    visibility: u64,
    provider_viewed: bool,
) -> bool {
    let viewed = actively_viewed(app, id, visibility, provider_viewed);
    let service = app.state::<Service>();
    let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
    let changed = observe_browser_event(
        &mut tracking,
        id,
        viewed,
        now(),
        first_observation,
        generation,
    );
    drop(tracking);
    if changed {
        refresh(app);
    }
    viewed
}

fn observe_browser_event(
    tracking: &mut Tracking,
    id: &str,
    actively_viewed: bool,
    at: u64,
    first_observation: bool,
    generation: u64,
) -> bool {
    finish_event(tracking, id, generation, first_observation);
    // Swiph3l: Only a new browser event owns unread; a duplicate native retry must not resurrect a message already acknowledged by the user.
    // Swiph3l: A genuine empty acknowledgement can overtake the renderer query;
    // a late query/timeout must not re-add a message read after its arrival.
    if tracking
        .read_generations
        .get(id)
        .is_some_and(|read| read.includes(generation))
    {
        return false;
    }
    if first_observation && !actively_viewed {
        remember_unread_arrival(tracking, id, generation);
        observe(&mut tracking.observations, id, true, false, at)
    } else {
        false
    }
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
    source: Source,
    _reason: &str,
    acknowledgement: Option<u64>,
    read_arrivals: &[u64],
    proof_only: bool,
) {
    let settings = crate::state::current(app);
    if !settings
        .services
        .iter()
        .any(|service| service.id == id && service.enabled && source.accepts(service.provider))
    {
        return;
    }
    let foreground =
        settings.active_service.as_deref() == Some(id) && crate::window::is_foreground(app);
    let service = app.state::<Service>();
    let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
    let outcome = observe_provider(
        &mut tracking,
        id,
        has_unread,
        foreground,
        acknowledgement,
        read_arrivals,
        proof_only,
        now(),
    );
    drop(tracking);
    accept_read_for(app, id, &outcome.accepted);
    if outcome.changed {
        refresh(app);
    }
}

struct ProviderObservation {
    changed: bool,
    accepted: Vec<u64>,
}

fn observe_provider(
    tracking: &mut Tracking,
    id: &str,
    has_unread: bool,
    foreground: bool,
    acknowledgement: Option<u64>,
    read_arrivals: &[u64],
    proof_only: bool,
    at: u64,
) -> ProviderObservation {
    let valid_read = read_acknowledged(tracking, id, foreground, acknowledgement);
    let mut accepted = Vec::new();
    if valid_read && !tracking.observed_unread_overflow.contains(id) {
        accepted = consume_read_arrivals(tracking, id, read_arrivals);
        record_acknowledgement(tracking, id);
    }
    // Swiph3l: Exact reads can progress while another conversation remains unread
    // or badges are unknown; an unknown snapshot must never invent an aggregate state.
    if proof_only {
        return ProviderObservation {
            changed: false,
            accepted,
        };
    }
    let acknowledged = valid_read && native_unread_complete(tracking, id);
    let changed = observe(&mut tracking.observations, id, has_unread, acknowledged, at);
    ProviderObservation { changed, accepted }
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
            visibility_generation: 2,
            ..Default::default()
        };
        assert!(revoke_input(&mut tracking, "selected", true));
        let first = begin_event(&mut tracking, "selected", true, None);
        assert!(viewing_evidence_current(
            &tracking, "selected", true, 2, true
        ));
        assert!(!observe_browser_event(
            &mut tracking,
            "selected",
            true,
            1,
            true,
            first
        ));
        assert!(tracking.observations.is_empty());
        assert!(!read_acknowledged(&tracking, "selected", true, Some(4)));
        assert_eq!(tracking.presentation_generation, 5);
        assert!(revoke_input(&mut tracking, "selected", true));
        let second = begin_event(&mut tracking, "selected", true, None);
        assert!(observe_browser_event(
            &mut tracking,
            "selected",
            false,
            2,
            true,
            second
        ));
        assert!(tracking.observations["selected"].has_unread);
        assert!(!read_acknowledged(&tracking, "selected", false, Some(6)));
        assert!(!revoke_input(&mut tracking, "other", true));
        let other = begin_event(&mut tracking, "other", true, None);
        assert!(observe_browser_event(
            &mut tracking,
            "other",
            false,
            3,
            true,
            other
        ));
        assert_eq!(
            tracking.presentation_generation, 6,
            "another service's message must not invalidate this conversation's read token"
        );
        assert!(tracking.observations["other"].has_unread);
    }
    #[test]
    fn duplicate_native_callback_cannot_resurrect_acknowledged_unread_after_minimize() {
        let mut tracking = Tracking::default();
        let first = begin_event(&mut tracking, "origin", true, None);
        assert!(observe_browser_event(
            &mut tracking,
            "origin",
            false,
            1,
            true,
            first
        ));
        tracking.foreground_service = Some("origin".into());
        tracking.presentation_generation = 1;
        let read = observe_provider(
            &mut tracking,
            "origin",
            false,
            true,
            Some(1),
            &[first],
            false,
            2,
        );
        assert!(read.changed);
        assert_eq!(read.accepted, [first]);
        tracking.foreground_service = None;
        tracking.presentation_generation = 2;
        let duplicate = begin_event(&mut tracking, "origin", false, Some(first));
        assert!(!revoke_input(&mut tracking, "origin", false));
        assert!(!observe_browser_event(
            &mut tracking,
            "origin",
            false,
            3,
            false,
            duplicate
        ));
        assert!(!tracking.observations["origin"].has_unread);
        assert_eq!(tracking.presentation_generation, 2);
        let next = begin_event(&mut tracking, "origin", true, None);
        assert!(observe_browser_event(
            &mut tracking,
            "origin",
            false,
            4,
            true,
            next
        ));
        assert!(
            tracking.observations["origin"].has_unread,
            "a legitimate new message still updates unread independently of toast policy"
        );
    }

    #[test]
    fn foreground_suppression_requires_current_conversation_evidence() {
        let tracking = Tracking {
            foreground_service: Some("selected".into()),
            visibility_generation: 3,
            ..Default::default()
        };
        assert!(viewing_evidence_current(
            &tracking, "selected", true, 3, true
        ));
        for (id, foreground, generation, evidence) in [
            ("selected", true, 3, false),
            ("selected", false, 3, true),
            ("selected", true, 2, true),
            ("other", true, 3, true),
        ] {
            assert!(!viewing_evidence_current(
                &tracking, id, foreground, generation, evidence
            ));
        }
    }

    #[test]
    fn projection_scopes_arrival_to_each_service_and_retries_it_after_background_completion() {
        let mut tracking = Tracking {
            foreground_service: Some("selected".into()),
            presentation_generation: 4,
            ..Default::default()
        };
        assert_eq!(
            presentation_script(&tracking, "selected"),
            "window.__chatplusSetForeground?.(true, 4, 0)"
        );
        assert!(!revoke_input(&mut tracking, "background", true));
        let background = begin_event(&mut tracking, "background", true, None);
        assert!(revoke_input(&mut tracking, "selected", true));
        let selected = begin_event(&mut tracking, "selected", true, None);
        assert_eq!(
            presentation_script(&tracking, "selected"),
            "window.__chatplusSetForeground?.(true, 5, 2)"
        );
        assert_eq!(
            presentation_script(&tracking, "background"),
            "window.__chatplusSetForeground?.(false, 5, 1)"
        );
        finish_event(&mut tracking, "background", background, true);
        assert_eq!(
            begin_event(&mut tracking, "background", false, Some(background)),
            background
        );
        assert_eq!(
            tracking.incoming_sequence, selected,
            "duplicate completion cannot project a new arrival"
        );
        tracking.foreground_service = Some("background".into());
        tracking.presentation_generation = 6;
        assert_eq!(
            presentation_script(&tracking, "background"),
            "window.__chatplusSetForeground?.(true, 6, 1)",
            "restore must retry the completed arrival if its background projection failed"
        );
        assert_eq!(
            presentation_script(&tracking, "selected"),
            "window.__chatplusSetForeground?.(false, 6, 2)"
        );
    }

    #[test]
    fn overlapping_viewed_messages_revoke_gestures_without_invalidating_each_others_visibility() {
        let mut tracking = Tracking {
            foreground_service: Some("selected".into()),
            presentation_generation: 4,
            visibility_generation: 2,
            ..Default::default()
        };
        let first_visibility = tracking.visibility_generation;
        assert!(revoke_input(&mut tracking, "selected", true));
        let first = begin_event(&mut tracking, "selected", true, None);
        assert!(revoke_input(&mut tracking, "selected", true));
        let second = begin_event(&mut tracking, "selected", true, None);
        assert_eq!(tracking.presentation_generation, 6);
        assert!(viewing_evidence_current(
            &tracking,
            "selected",
            true,
            first_visibility,
            true
        ));
        assert!(!observe_browser_event(
            &mut tracking,
            "selected",
            true,
            1,
            true,
            first
        ));
        assert!(!observe_browser_event(
            &mut tracking,
            "selected",
            true,
            2,
            true,
            second
        ));
        assert!(tracking.observations.is_empty());
    }

    #[test]
    fn late_query_cannot_resurrect_a_read_message_even_after_a_newer_arrival() {
        let mut tracking = Tracking {
            foreground_service: Some("origin".into()),
            presentation_generation: 1,
            ..Default::default()
        };
        let old = begin_event(&mut tracking, "origin", true, None);
        assert!(observe_browser_event(
            &mut tracking,
            "origin",
            false,
            1,
            true,
            old
        ));
        assert!(
            observe_provider(
                &mut tracking,
                "origin",
                false,
                true,
                Some(1),
                &[old],
                false,
                2
            )
            .changed
        );
        let newer = begin_event(&mut tracking, "origin", true, None);
        assert!(!observe_browser_event(
            &mut tracking,
            "origin",
            false,
            1,
            true,
            old
        ));
        assert!(observe_browser_event(
            &mut tracking,
            "origin",
            false,
            2,
            true,
            newer
        ));
        assert!(tracking.observations["origin"].has_unread);
        let other = begin_event(&mut tracking, "other", true, None);
        assert!(observe_browser_event(
            &mut tracking,
            "other",
            false,
            3,
            true,
            other
        ));
        let read = observe_provider(
            &mut tracking,
            "origin",
            false,
            true,
            Some(1),
            &[newer],
            false,
            4,
        );
        assert!(read.changed);
        assert_eq!(read.accepted, [newer]);
        assert!(!observe_browser_event(
            &mut tracking,
            "origin",
            false,
            4,
            true,
            newer
        ));
        assert!(tracking.observations["other"].has_unread);
    }

    #[test]
    fn old_pane_gesture_cannot_read_a_pending_arrival_before_its_dom_render() {
        let mut tracking = Tracking {
            foreground_service: Some("origin".into()),
            presentation_generation: 4,
            ..Default::default()
        };
        assert!(revoke_input(&mut tracking, "origin", true));
        let incoming = begin_event(&mut tracking, "origin", true, None);
        assert!(read_acknowledged(&tracking, "origin", true, Some(5)));
        record_acknowledgement(&mut tracking, "origin");
        assert!(!tracking.read_generations["origin"].includes(incoming));
        assert!(observe_browser_event(
            &mut tracking,
            "origin",
            false,
            1,
            true,
            incoming
        ));
        assert!(tracking.observations["origin"].has_unread);
        assert!(
            !tracking.read_generations["origin"].includes(incoming),
            "completion cannot retroactively turn old input into read proof"
        );
        let read = observe_provider(
            &mut tracking,
            "origin",
            false,
            true,
            Some(5),
            &[incoming],
            false,
            2,
        );
        assert!(read.changed);
        assert_eq!(read.accepted, [incoming]);
        assert!(tracking.read_generations["origin"].includes(incoming));
        assert!(!observe_browser_event(
            &mut tracking,
            "origin",
            false,
            3,
            false,
            incoming
        ));
        assert!(!tracking.observations["origin"].has_unread);
    }

    #[test]
    fn later_query_completion_does_not_acknowledge_an_earlier_pending_message() {
        let mut tracking = Tracking {
            foreground_service: Some("origin".into()),
            presentation_generation: 1,
            ..Default::default()
        };
        let earlier = begin_event(&mut tracking, "origin", true, None);
        let later = begin_event(&mut tracking, "origin", true, None);
        assert!(observe_browser_event(
            &mut tracking,
            "origin",
            false,
            1,
            true,
            later
        ));
        let read = observe_provider(
            &mut tracking,
            "origin",
            false,
            true,
            Some(1),
            &[later, earlier],
            false,
            2,
        );
        assert!(read.changed);
        assert_eq!(
            read.accepted,
            [later],
            "an exact token still cannot read a pending query"
        );
        assert!(tracking.read_generations["origin"].includes(later));
        assert!(!tracking.read_generations["origin"].includes(earlier));
        assert!(observe_browser_event(
            &mut tracking,
            "origin",
            false,
            3,
            true,
            earlier
        ));
        assert!(tracking.observations["origin"].has_unread);
        let read = observe_provider(
            &mut tracking,
            "origin",
            false,
            true,
            Some(1),
            &[earlier],
            false,
            4,
        );
        assert!(read.changed);
        assert_eq!(read.accepted, [earlier]);
        assert!(tracking.read_generations["origin"].includes(earlier));
        assert!(tracking.read_generations["origin"].includes(later));
        let newest = begin_event(&mut tracking, "origin", true, None);
        assert!(!tracking.read_generations["origin"].includes(newest));
    }

    #[test]
    fn duplicate_finish_cannot_unpend_original_and_terminal_events_release_only_their_own_state() {
        let mut tracking = Tracking::default();
        let original = begin_event(&mut tracking, "origin", true, None);
        let other_message = begin_event(&mut tracking, "origin", true, None);
        let other_service = begin_event(&mut tracking, "other", true, None);
        assert_eq!(
            begin_event(&mut tracking, "origin", false, Some(original)),
            original
        );
        finish_event(&mut tracking, "origin", original, false);
        assert!(tracking.pending_generations["origin"].contains(&original));
        finish_event(&mut tracking, "origin", original, true);
        assert!(!tracking.pending_generations["origin"].contains(&original));
        assert!(tracking.pending_generations["origin"].contains(&other_message));
        finish_event(&mut tracking, "origin", other_message, true);
        assert!(!tracking.pending_generations.contains_key("origin"));
        assert!(tracking.pending_generations["other"].contains(&other_service));
        finish_event(&mut tracking, "other", other_service, true);
        assert!(tracking.pending_generations.is_empty());
    }

    #[test]
    fn provider_sources_cannot_acknowledge_another_provider() {
        use crate::providers::ProviderId;
        for (source, provider) in [
            (Source::ChatPlusDom, ProviderId::SynologyChatplus),
            (Source::SynologyChatDom, ProviderId::SynologyChat),
            (Source::DiscordDom, ProviderId::Discord),
        ] {
            assert!(source.accepts(provider));
            for other in [
                ProviderId::SynologyChatplus,
                ProviderId::SynologyChat,
                ProviderId::Discord,
            ] {
                assert_eq!(source.accepts(other), provider == other);
            }
        }
    }

    #[test]
    fn native_unread_requires_exact_read_proof_even_after_its_query_completed() {
        let mut tracking = Tracking {
            foreground_service: Some("origin".into()),
            presentation_generation: 4,
            ..Default::default()
        };
        let arrival = begin_event(&mut tracking, "origin", true, None);
        assert!(observe_browser_event(
            &mut tracking,
            "origin",
            false,
            1,
            true,
            arrival
        ));
        let empty = observe_provider(&mut tracking, "origin", false, true, Some(4), &[], false, 2);
        assert!(!empty.changed);
        assert!(empty.accepted.is_empty());
        assert!(tracking.observations["origin"].has_unread);
        assert!(tracking.observed_unread_arrivals["origin"].contains(&arrival));
        assert!(!tracking.read_generations["origin"].includes(arrival));
        for (foreground, acknowledgement) in [(false, Some(4)), (true, Some(3))] {
            let rejected = observe_provider(
                &mut tracking,
                "origin",
                false,
                foreground,
                acknowledgement,
                &[arrival],
                false,
                3,
            );
            assert!(!rejected.changed);
            assert!(rejected.accepted.is_empty());
        }
        let read = observe_provider(
            &mut tracking,
            "origin",
            false,
            true,
            Some(4),
            &[arrival],
            false,
            4,
        );
        assert!(read.changed);
        assert_eq!(read.accepted, [arrival]);
        assert!(!tracking.observations["origin"].has_unread);
        let retry = observe_provider(
            &mut tracking,
            "origin",
            false,
            true,
            Some(4),
            &[arrival],
            false,
            6,
        );
        assert!(!retry.changed);
        assert_eq!(
            retry.accepted,
            [arrival],
            "a missed renderer callback can retry an already accepted read"
        );
        assert!(!tracking.observed_unread_arrivals.contains_key("origin"));
        assert!(tracking.read_generations["origin"].includes(arrival));
        assert!(!observe_browser_event(
            &mut tracking,
            "origin",
            false,
            5,
            false,
            arrival
        ));
        assert!(!tracking.observations["origin"].has_unread);
    }

    #[test]
    fn exact_proofs_are_per_service_and_cannot_erase_a_later_unlisted_native_arrival() {
        let mut tracking = Tracking {
            foreground_service: Some("first".into()),
            presentation_generation: 2,
            ..Default::default()
        };
        let first = begin_event(&mut tracking, "first", true, None);
        let second_service = begin_event(&mut tracking, "second", true, None);
        let later = begin_event(&mut tracking, "first", true, None);
        assert!(observe_browser_event(
            &mut tracking,
            "first",
            false,
            1,
            true,
            first
        ));
        assert!(observe_browser_event(
            &mut tracking,
            "second",
            false,
            1,
            true,
            second_service
        ));
        assert!(!observe_browser_event(
            &mut tracking,
            "first",
            false,
            2,
            true,
            later
        ));
        let partial = observe_provider(
            &mut tracking,
            "first",
            false,
            true,
            Some(2),
            &[first, second_service],
            false,
            3,
        );
        assert!(!partial.changed);
        assert_eq!(partial.accepted, [first]);
        assert!(tracking.observations["first"].has_unread);
        assert_eq!(tracking.observed_unread_arrivals["first"].len(), 1);
        let last = observe_provider(
            &mut tracking,
            "first",
            false,
            true,
            Some(2),
            &[later],
            false,
            4,
        );
        assert!(last.changed);
        assert_eq!(last.accepted, [later]);
        assert!(!tracking.observations["first"].has_unread);
        assert!(tracking.observations["second"].has_unread);
        assert!(tracking.observed_unread_arrivals["second"].contains(&second_service));
        assert!(aggregate(tracking.observations.values()).has_unread);
    }

    #[test]
    fn bounded_native_history_overflow_retains_unread_without_blocking_new_messages() {
        let mut tracking = Tracking {
            foreground_service: Some("origin".into()),
            presentation_generation: 1,
            ..Default::default()
        };
        for at in 1..=READ_ARRIVAL_LIMIT as u64 + 1 {
            let arrival = begin_event(&mut tracking, "origin", true, None);
            observe_browser_event(&mut tracking, "origin", false, at, true, arrival);
        }
        assert_eq!(
            tracking.observed_unread_arrivals["origin"].len(),
            READ_ARRIVAL_LIMIT
        );
        assert!(tracking.observed_unread_overflow.contains("origin"));
        let proofs = tracking.observed_unread_arrivals["origin"]
            .iter()
            .copied()
            .collect::<Vec<_>>();
        let overflow = observe_provider(
            &mut tracking,
            "origin",
            false,
            true,
            Some(1),
            &proofs,
            false,
            300,
        );
        assert!(!overflow.changed);
        assert!(overflow.accepted.is_empty());
        assert!(tracking.observations["origin"].has_unread);
        let next = begin_event(&mut tracking, "origin", true, None);
        assert_eq!(next, READ_ARRIVAL_LIMIT as u64 + 2);
        observe_browser_event(&mut tracking, "origin", false, 301, true, next);
        assert!(!tracking.pending_generations.contains_key("origin"));
        assert_eq!(
            tracking.observed_unread_arrivals["origin"].len(),
            READ_ARRIVAL_LIMIT
        );
        assert!(tracking.observed_unread_overflow.contains("origin"));
    }

    #[test]
    fn positive_provider_snapshot_can_accept_one_exact_read_without_erasing_another_arrival() {
        let mut tracking = Tracking {
            foreground_service: Some("origin".into()),
            presentation_generation: 2,
            ..Default::default()
        };
        let first = begin_event(&mut tracking, "origin", true, None);
        let later = begin_event(&mut tracking, "origin", true, None);
        observe_browser_event(&mut tracking, "origin", false, 1, true, first);
        observe_browser_event(&mut tracking, "origin", false, 2, true, later);
        let partial = observe_provider(
            &mut tracking,
            "origin",
            true,
            true,
            Some(2),
            &[first],
            false,
            3,
        );
        assert_eq!(partial.accepted, [first]);
        assert!(!partial.changed);
        assert!(tracking.observations["origin"].has_unread);
        assert!(tracking.read_generations["origin"].includes(first));
        assert!(!tracking.read_generations["origin"].includes(later));
        assert!(tracking.observed_unread_arrivals["origin"].contains(&later));
        let last = observe_provider(
            &mut tracking,
            "origin",
            false,
            true,
            Some(2),
            &[later],
            false,
            4,
        );
        assert_eq!(last.accepted, [later]);
        assert!(last.changed);
        assert!(!tracking.observations["origin"].has_unread);
    }

    #[test]
    fn unknown_proof_only_accepts_exact_reads_but_preserves_the_aggregate_observation() {
        let mut tracking = Tracking {
            foreground_service: Some("origin".into()),
            presentation_generation: 3,
            ..Default::default()
        };
        let arrival = begin_event(&mut tracking, "origin", true, None);
        observe_browser_event(&mut tracking, "origin", false, 1, true, arrival);
        let rejected = observe_provider(
            &mut tracking,
            "origin",
            false,
            false,
            Some(3),
            &[arrival],
            true,
            2,
        );
        assert!(rejected.accepted.is_empty());
        assert!(!rejected.changed);
        let read = observe_provider(
            &mut tracking,
            "origin",
            false,
            true,
            Some(3),
            &[arrival],
            true,
            3,
        );
        assert_eq!(read.accepted, [arrival]);
        assert!(!read.changed);
        assert!(tracking.observations["origin"].has_unread);
        assert_eq!(tracking.observations["origin"].last_update, Some(1));
        assert!(tracking.read_generations["origin"].includes(arrival));
        let known_zero =
            observe_provider(&mut tracking, "origin", false, true, Some(3), &[], false, 4);
        assert!(known_zero.changed);
        assert!(!tracking.observations["origin"].has_unread);

        tracking.foreground_service = Some("empty".into());
        for has_unread in [false, true] {
            let unknown = observe_provider(
                &mut tracking,
                "empty",
                has_unread,
                true,
                Some(3),
                &[99],
                true,
                5,
            );
            assert!(!unknown.changed);
            assert!(unknown.accepted.is_empty());
            assert!(
                !tracking.observations.contains_key("empty"),
                "unknown evidence cannot invent zero or unread"
            );
        }
    }
}
