//! Provider observations and desktop presentation are separate. Focus never marks messages read.
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    hash::{BuildHasher, Hash, Hasher},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
pub(crate) const READ_ARRIVAL_LIMIT: usize = 256;
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Source {
    ChatPlusDom,
    SynologyChatDom,
    DiscordDom,
    WhatsappDom,
    MessengerDom,
    MattermostDom,
}
impl Source {
    fn label(self) -> &'static str {
        match self {
            Self::ChatPlusDom => "chatplus-dom",
            Self::SynologyChatDom => "synology-chat-dom",
            Self::DiscordDom => "discord-dom",
            Self::WhatsappDom => "whatsapp-dom",
            Self::MessengerDom => "messenger-dom",
            Self::MattermostDom => "mattermost-dom",
        }
    }
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
                | (Self::WhatsappDom, crate::providers::ProviderId::Whatsapp)
                | (Self::MessengerDom, crate::providers::ProviderId::Messenger)
                | (
                    Self::MattermostDom,
                    crate::providers::ProviderId::Mattermost
                )
        )
    }
}
#[derive(Clone, Copy, Default, serde::Deserialize, Serialize, PartialEq, Eq, Debug, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum Certainty {
    KnownUnread,
    KnownRead,
    #[default]
    Unknown,
}
#[derive(Clone, Default, serde::Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct ConversationObservation {
    pub id: String,
    pub has_unread: Option<bool>,
    pub count: Option<u32>,
}
#[derive(Default)]
pub struct ProviderEvidence {
    pub revision: Option<u64>,
    pub certainty: Certainty,
    pub current_conversation: Option<String>,
    pub conversations: Vec<ConversationObservation>,
    pub unattributed_unread: Option<bool>,
}
#[derive(Clone, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConversationEvidence {
    /// Runtime-only opaque identity; never a chat title, URL, tag, or phone number.
    pub id: String,
    pub has_unread: Option<bool>,
    pub count: Option<u32>,
}
#[derive(Clone, Default, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Unread {
    pub total_unread_count: Option<u32>,
    pub has_unread: bool,
    pub mention_count: Option<u32>,
    pub last_update: Option<u64>,
    pub generation: u64,
    pub source: Option<&'static str>,
    pub unread_scope: Option<&'static str>,
    pub last_arrival: Option<u64>,
    pub last_read_evidence: Option<u64>,
    pub certainty: Certainty,
    pub last_provider_revision: Option<u64>,
    pub current_conversation: Option<String>,
    pub conversations: Vec<ConversationEvidence>,
    pub locally_acknowledged: bool,
}
#[derive(Default)]
pub struct Service(Mutex<Tracking>);
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub services: HashMap<String, Unread>,
    pub aggregate: Unread,
}
#[derive(Default)]
struct Tracking {
    observations: HashMap<String, Unread>,
    read_generations: HashMap<String, ReadProof>,
    incoming_generations: HashMap<String, u64>,
    pending_generations: HashMap<String, HashSet<u64>>,
    observed_unread_arrivals: HashMap<String, HashSet<u64>>,
    observed_unread_overflow: HashSet<String>,
    provider_unread_latched: HashSet<String>,
    provider_unread_conversations: HashMap<String, HashSet<String>>,
    provider_unread_unattributed: HashSet<String>,
    incoming_sequence: u64,
    foreground_service: Option<String>,
    presentation_generation: u64,
    visibility_generation: u64,
    revision: u64,
    evidence_hasher: std::collections::hash_map::RandomState,
    provider_fingerprints: HashMap<String, u64>,
    local_acknowledgements: HashMap<String, Option<u64>>,
    attention_query_sequence: u64,
    attention_queries: HashMap<String, u64>,
    attention_revisions: HashMap<String, (String, u64)>,
}

pub(crate) struct AttentionQuery {
    sequence: u64,
    incoming: u64,
    started: Instant,
}

#[cfg(any(windows, test))]
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum AttentionPublication {
    Complete,
    Retry,
}
#[derive(Default)]
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
    tracking.provider_unread_latched.remove(id);
    tracking.provider_unread_conversations.remove(id);
    tracking.provider_unread_unattributed.remove(id);
    tracking.provider_fingerprints.remove(id);
    tracking.local_acknowledgements.remove(id);
    tracking.attention_queries.remove(id);
    tracking.attention_revisions.remove(id);
    tracking.revision += 1;
    drop(tracking);
    refresh(app);
}
fn project(tracking: &Tracking, settings: &crate::state::Settings) -> Snapshot {
    let services: HashMap<_, _> = settings
        .services
        .iter()
        .filter(|service| service.enabled)
        .filter_map(|service| {
            tracking
                .observations
                .get(&service.id)
                .map(|state| (service.id.clone(), state.clone()))
        })
        .collect();
    Snapshot {
        revision: tracking.revision,
        aggregate: aggregate(services.values()),
        services,
    }
}

pub fn snapshot(app: &AppHandle) -> Snapshot {
    let settings = crate::state::current(app);
    let service = app.state::<Service>();
    let tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
    project(&tracking, &settings)
}

pub fn invalidate_presentation(app: &AppHandle, id: &str) {
    let service = app.state::<Service>();
    let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
    invalidate_attention(&mut tracking, id);
    if tracking.foreground_service.as_deref() == Some(id) {
        // Swiph3l: Navigation can deliver queued messages from the old document; its interaction generation must not acknowledge the new page.
        tracking.foreground_service = None;
        tracking.presentation_generation += 1;
        tracking.visibility_generation += 1;
    }
}

fn invalidate_attention(tracking: &mut Tracking, id: &str) {
    // Swiph3l: A same-origin reload can begin after nonce evaluation but before
    // its callback. Reject that old query even for a background service.
    tracking.attention_queries.remove(id);
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
            .filter(|s| s.enabled && s.supports_unread())
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
    let settings = crate::state::current(app);
    let tracks_unread = browser_arrivals_tracked(&settings, id);
    let attention = settings.services.iter().any(|service| {
        service.id == id
            && service.enabled
            && service.provider == crate::providers::ProviderId::Whatsapp
    });
    let service = app.state::<Service>();
    let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
    let (generation, changed) = begin_browser_event(
        &mut tracking,
        id,
        first_observation,
        previous_generation,
        now(),
        tracks_unread,
    );
    if attention && first_observation {
        rearm_attention(&mut tracking, id);
    }
    drop(tracking);
    if first_observation {
        crate::diagnostics::notification(
            app,
            id,
            crate::diagnostics::NotificationEvent::Detected,
            crate::diagnostics::NotificationReason::BrowserEvent,
            generation.read,
        );
        crate::diagnostics::notification(
            app,
            id,
            crate::diagnostics::NotificationEvent::NotificationArrival,
            crate::diagnostics::NotificationReason::BrowserEvent,
            generation.read,
        );
    }
    if changed {
        crate::diagnostics::notification(
            app,
            id,
            crate::diagnostics::NotificationEvent::UnreadLatched,
            crate::diagnostics::NotificationReason::BrowserEvent,
            generation.read,
        );
        refresh(app);
    }
    // Background arrivals still advance the gesture barrier; notification-only
    // Discord/WhatsApp events do not own pending unread or retain renderer tags.
    if first_observation {
        sync_presentation(app);
    }
    generation
}

pub(crate) fn provider_tracks_browser_arrivals(provider: crate::providers::ProviderId) -> bool {
    // Swiph3l: Discord's dot follows DM evidence; WhatsApp mirrors its official
    // attention counter. Browser events deliver banners, not either unread scope.
    !matches!(
        provider,
        crate::providers::ProviderId::Discord | crate::providers::ProviderId::Whatsapp
    )
}

fn rearm_attention(tracking: &mut Tracking, id: &str) {
    // A new event removes the explicit local override, but only a fresh official
    // counter observation may restore the attention dot.
    tracking.local_acknowledgements.remove(id);
}

fn begin_attention(tracking: &mut Tracking, id: &str, started: Instant) -> AttentionQuery {
    tracking.attention_query_sequence += 1;
    let sequence = tracking.attention_query_sequence;
    tracking.attention_queries.insert(id.into(), sequence);
    AttentionQuery {
        sequence,
        incoming: tracking.incoming_generations.get(id).copied().unwrap_or(0),
        started,
    }
}

#[cfg(windows)]
pub(crate) fn begin_attention_query(
    app: &AppHandle,
    id: &str,
    value: Option<bool>,
) -> Option<AttentionQuery> {
    let service = app.state::<Service>();
    let mut tracking = service.0.lock().unwrap_or_else(|error| error.into_inner());
    begin_attention_observation(&mut tracking, id, value, Instant::now())
}

fn begin_attention_observation(
    tracking: &mut Tracking,
    id: &str,
    value: Option<bool>,
    started: Instant,
) -> Option<AttentionQuery> {
    // Unknown/loading cannot supersede the last pending recognized counter.
    value.map(|_| begin_attention(tracking, id, started))
}

fn attention_query_current(
    tracking: &Tracking,
    id: &str,
    query: &AttentionQuery,
    at: Instant,
) -> bool {
    tracking.attention_queries.get(id) == Some(&query.sequence)
        && tracking.incoming_generations.get(id).copied().unwrap_or(0) == query.incoming
        && at.saturating_duration_since(query.started) < Duration::from_secs(5)
}

fn attention_query_remaining(
    tracking: &Tracking,
    id: &str,
    query: &AttentionQuery,
    at: Instant,
) -> Option<Duration> {
    attention_query_current(tracking, id, query, at)
        .then(|| Duration::from_secs(5) - at.saturating_duration_since(query.started))
}

#[cfg(windows)]
pub(crate) fn attention_query_remaining_for(
    app: &AppHandle,
    id: &str,
    query: &AttentionQuery,
) -> Option<Duration> {
    let service = app.state::<Service>();
    let tracking = service.0.lock().unwrap_or_else(|error| error.into_inner());
    attention_query_remaining(&tracking, id, query, Instant::now())
}

fn observe_attention(
    tracking: &mut Tracking,
    id: &str,
    query: &AttentionQuery,
    epoch: &str,
    revision: u64,
    has_unread: Option<bool>,
    count: Option<u32>,
    at: u64,
    completed: Instant,
) -> bool {
    if has_unread.is_none()
        || revision == 0
        || revision > 9_007_199_254_740_991
        || !attention_query_current(tracking, id, query, completed)
        || tracking
            .attention_revisions
            .get(id)
            .is_some_and(|(current, previous)| current == epoch && revision <= *previous)
    {
        return false;
    }
    tracking.attention_queries.remove(id);
    tracking
        .attention_revisions
        .insert(id.into(), (epoch.into(), revision));
    let mut suppressed = false;
    if let Some(value) = has_unread {
        let fingerprint =
            tracking
                .evidence_hasher
                .hash_one(("notification-attention", value, count));
        suppressed = tracking
            .local_acknowledgements
            .get(id)
            .is_some_and(|baseline| baseline.is_none_or(|baseline| baseline == fingerprint));
        tracking
            .provider_fingerprints
            .insert(id.into(), fingerprint);
        if suppressed {
            tracking
                .local_acknowledgements
                .insert(id.into(), Some(fingerprint));
        } else {
            tracking.local_acknowledgements.remove(id);
        }
        if value && !suppressed {
            tracking.provider_unread_latched.insert(id.into());
        } else {
            tracking.provider_unread_latched.remove(id);
        }
    }
    let state = tracking.observations.entry(id.into()).or_default();
    let previous = state.clone();
    state.source = Some(Source::WhatsappDom.label());
    state.unread_scope = Some("notification-attention");
    state.certainty = Certainty::Unknown;
    state.total_unread_count = None;
    state.last_provider_revision = Some(revision);
    if let Some(value) = has_unread {
        state.has_unread = value && !suppressed;
        state.locally_acknowledged = suppressed;
        if state.has_unread && !previous.has_unread {
            state.last_arrival = Some(at);
        }
    }
    // Swiph3l: This mirrors provider attention, including background phone reads.
    // It never asserts all chats read or changes the last genuine read evidence.
    if *state == previous {
        return false;
    }
    state.last_update = Some(at);
    state.generation += 1;
    tracking.revision += 1;
    true
}

#[cfg(windows)]
pub(crate) fn publish_attention_for(
    app: &AppHandle,
    configured: &crate::providers::ServiceConfig,
    bridge: u64,
    query: &AttentionQuery,
    epoch: &str,
    revision: u64,
    has_unread: Option<bool>,
    count: Option<u32>,
) -> AttentionPublication {
    let outcome = crate::services::with_configured(app, configured, || {
        if configured.provider != crate::providers::ProviderId::Whatsapp
            || !crate::notification_bridge::current_bridge(app, &configured.id, bridge)
        {
            return Err("Provider attention session changed.".into());
        }
        let service = app.state::<Service>();
        let mut tracking = service.0.lock().unwrap_or_else(|error| error.into_inner());
        let was_unread = tracking
            .observations
            .get(&configured.id)
            .is_some_and(|state| state.has_unread);
        let changed = observe_attention(
            &mut tracking,
            &configured.id,
            query,
            epoch,
            revision,
            has_unread,
            count,
            now(),
            Instant::now(),
        );
        let unread = tracking
            .observations
            .get(&configured.id)
            .is_some_and(|state| state.has_unread);
        Ok((changed, was_unread, unread))
    });
    if outcome.is_err()
        && configured.provider == crate::providers::ProviderId::Whatsapp
        && crate::services::configured(app, configured)
        && crate::notification_bridge::current_bridge(app, &configured.id, bridge)
        && attention_query_remaining_for(app, &configured.id, query).is_some()
    {
        // Swiph3l: A settings transition may temporarily own the UI guard. Keep
        // the original query ticket; a retry must recheck its document and cannot
        // extend its deadline, cross navigation or cover a newer arrival.
        return AttentionPublication::Retry;
    }
    if let Ok((true, previous, current)) = outcome {
        if previous != current {
            crate::diagnostics::notification(
                app,
                &configured.id,
                if current {
                    crate::diagnostics::NotificationEvent::UnreadLatched
                } else {
                    crate::diagnostics::NotificationEvent::UnreadCleared
                },
                crate::diagnostics::NotificationReason::ProviderObservation,
                0,
            );
        }
        refresh(app);
    }
    AttentionPublication::Complete
}

fn browser_arrivals_tracked(settings: &crate::state::Settings, id: &str) -> bool {
    settings.services.iter().any(|service| {
        service.id == id && service.enabled && provider_tracks_browser_arrivals(service.provider)
    })
}

fn begin_browser_event(
    tracking: &mut Tracking,
    id: &str,
    first_observation: bool,
    previous_generation: Option<u64>,
    at: u64,
    tracks_unread: bool,
) -> (IncomingGeneration, bool) {
    revoke_input(tracking, id, first_observation);
    let read = begin_event(tracking, id, first_observation, previous_generation);
    let changed = tracks_unread && first_observation && latch_arrival(tracking, id, read, at);
    if !tracks_unread {
        finish_event(tracking, id, read, first_observation);
    }
    let generation = IncomingGeneration {
        read,
        visibility: tracking.visibility_generation,
    };
    (generation, changed)
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
            .pending_generations
            .get(id)
            .map_or(true, HashSet::is_empty)
        && tracking
            .observed_unread_arrivals
            .get(id)
            .map_or(true, HashSet::is_empty)
}

fn completed_read_through(tracking: &Tracking, id: &str) -> Option<u64> {
    // Swiph3l: A later accepted token cannot cover an earlier pending arrival.
    // Only the native store can certify that this service's whole boundary is read.
    if native_unread_complete(tracking, id)
        && tracking
            .observations
            .get(id)
            .is_some_and(|state| !state.has_unread)
        && !tracking.provider_unread_latched.contains(id)
    {
        tracking.incoming_generations.get(id).copied()
    } else {
        None
    }
}

fn consume_provider_zero(tracking: &mut Tracking, id: &str) -> Vec<u64> {
    // Swiph3l: Synology does not expose reliable read tags. A trusted current
    // conversation plus provider-wide zero can retire completed arrivals;
    // asynchronous arrivals still pending must remain unread when they finish.
    let completed = tracking
        .observed_unread_arrivals
        .get(id)
        .into_iter()
        .flat_map(|arrivals| arrivals.iter().copied())
        .filter(|arrival| {
            !tracking
                .pending_generations
                .get(id)
                .is_some_and(|pending| pending.contains(arrival))
        })
        .collect::<Vec<_>>();
    tracking.observed_unread_overflow.remove(id);
    let mut accepted = consume_read_arrivals(tracking, id, &completed);
    if let Some(latest) = tracking.incoming_generations.get(id).copied() {
        // Swiph3l: Saturation can omit the newest local tag. Echo a completed
        // scope boundary so the renderer can retire its zero-proof retry too.
        if latest > 0
            && !accepted.contains(&latest)
            && !tracking
                .pending_generations
                .get(id)
                .is_some_and(|pending| pending.contains(&latest))
        {
            accepted.push(latest);
        }
    }
    accepted
}

pub fn prepare_toast_read_for(app: &AppHandle, id: &str, tag: &str) -> bool {
    if !(17..=20).contains(&tag.len()) || !tag.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    let settings = crate::state::current(app);
    let Some(configured) = settings.services.iter().find(|service| {
        service.id == id
            && service.enabled
            && service.provider == crate::providers::ProviderId::Discord
    }) else {
        return false;
    };
    let captured = crate::services::with_configured(app, configured, || {
        let service = app.state::<Service>();
        let tracking = service.0.lock().unwrap_or_else(|error| error.into_inner());
        if tracking.foreground_service.as_deref() != Some(id) {
            return Err("The notification service is not foreground.".into());
        }
        let generation = tracking.presentation_generation;
        let incoming = tracking.incoming_generations.get(id).copied().unwrap_or(0);
        let script = format!(
            "{};window.__chatplusPrepareToastRead?.({}, {}, {})",
            presentation_script(&tracking, id),
            serde_json::json!({ "tag": tag }),
            generation,
            incoming
        );
        Ok((app.get_webview(&crate::services::label(id)), script))
    });
    // Swiph3l: Projection and arming share one evaluated script. A stale queued
    // projection must never arm an intent using a newer renderer generation.
    matches!(captured, Ok((Some(view), script)) if view.eval(&script).is_ok())
}

pub fn accept_read_for(app: &AppHandle, id: &str, arrivals: &[u64]) {
    if !arrivals.is_empty() {
        let complete_through = {
            let service = app.state::<Service>();
            let tracking = service.0.lock().unwrap_or_else(|error| error.into_inner());
            completed_read_through(&tracking, id)
        };
        if let Some(view) = app.get_webview(&crate::services::label(id)) {
            accept_read_in(&view, arrivals, complete_through);
        }
    }
}

fn accept_read_in(view: &tauri::Webview, arrivals: &[u64], complete_through: Option<u64>) {
    for chunk in arrivals.chunks(READ_ARRIVAL_LIMIT) {
        let _ = view.eval(&format!(
            "window.__chatplusAcceptRead?.({}, {})",
            serde_json::to_string(chunk).unwrap(),
            serde_json::to_string(&complete_through).unwrap(),
        ));
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
    let tracks_unread = browser_arrivals_tracked(&crate::state::current(app), id);
    let service = app.state::<Service>();
    let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
    let changed = observe_browser_event_with_policy(
        &mut tracking,
        id,
        viewed,
        now(),
        first_observation,
        generation,
        tracks_unread,
    );
    drop(tracking);
    if changed {
        crate::diagnostics::notification(
            app,
            id,
            crate::diagnostics::NotificationEvent::UnreadLatched,
            crate::diagnostics::NotificationReason::BrowserEvent,
            generation,
        );
        refresh(app);
    }
    viewed
}

fn observe_browser_event_with_policy(
    tracking: &mut Tracking,
    id: &str,
    actively_viewed: bool,
    at: u64,
    first_observation: bool,
    generation: u64,
    tracks_unread: bool,
) -> bool {
    if tracks_unread {
        observe_browser_event(
            tracking,
            id,
            actively_viewed,
            at,
            first_observation,
            generation,
        )
    } else {
        finish_event(tracking, id, generation, first_observation);
        false
    }
}

fn observe_browser_event(
    tracking: &mut Tracking,
    id: &str,
    _actively_viewed: bool,
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
    if first_observation {
        latch_arrival(tracking, id, generation, at)
    } else {
        false
    }
}

fn latch_arrival(tracking: &mut Tracking, id: &str, generation: u64, at: u64) -> bool {
    if tracking
        .observed_unread_arrivals
        .get(id)
        .is_some_and(|arrivals| arrivals.contains(&generation))
    {
        return false;
    }
    remember_unread_arrival(tracking, id, generation);
    tracking.local_acknowledgements.remove(id);
    // Swiph3l: Selected/loaded conversations are not acknowledgements. Every
    // arrival latches before its asynchronous view query or native toast.
    observe(&mut tracking.observations, id, true, false, at);
    let state = tracking.observations.get_mut(id).unwrap();
    state.generation += 1;
    state.source = Some("browser-notification");
    state.last_arrival = Some(at);
    state.locally_acknowledged = false;
    state.certainty = Certainty::KnownUnread;
    // Browser events prove unread, but do not prove an exact provider total.
    state.total_unread_count = None;
    tracking.revision += 1;
    true
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
    snapshot(app).aggregate
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
    count: Option<u32>,
    has_unread: Option<bool>,
    source: Source,
    _reason: &str,
    acknowledgement: Option<u64>,
    read_arrivals: &[u64],
    proof_only: bool,
    provider_zero: bool,
    conversation_read: bool,
    evidence: &ProviderEvidence,
) {
    let settings = crate::state::current(app);
    if !settings.services.iter().any(|service| {
        service.id == id && service.enabled && source.accepts(service.unread_source_provider())
    }) {
        return;
    }
    let foreground =
        settings.active_service.as_deref() == Some(id) && crate::window::is_foreground(app);
    let service = app.state::<Service>();
    let mut tracking = service.0.lock().unwrap_or_else(|e| e.into_inner());
    let valid_read = read_acknowledged(&tracking, id, foreground, acknowledgement);
    let was_unread = tracking
        .observations
        .get(id)
        .is_some_and(|state| state.has_unread);
    let at = now();
    let suppressed = same_local_acknowledgement(&tracking, id, count, has_unread, evidence);
    let mut outcome = if source == Source::DiscordDom && !suppressed {
        observe_discord_conversations(
            &mut tracking,
            id,
            has_unread,
            foreground,
            acknowledgement,
            provider_zero,
            conversation_read,
            evidence,
            at,
        )
    } else if let Some(has_unread) = has_unread.filter(|_| !suppressed) {
        observe_provider_scoped(
            &mut tracking,
            id,
            has_unread,
            foreground,
            acknowledgement,
            read_arrivals,
            proof_only,
            at,
            provider_zero,
        )
    } else if proof_only && !suppressed {
        observe_provider_scoped(
            &mut tracking,
            id,
            false,
            foreground,
            acknowledgement,
            read_arrivals,
            true,
            at,
            false,
        )
    } else {
        ProviderObservation {
            changed: false,
            accepted: Vec::new(),
            conversation_accepted: false,
        }
    };
    outcome.changed |= record_provider_evidence(
        &mut tracking,
        id,
        count,
        has_unread,
        evidence,
        at,
        suppressed,
    );
    if outcome.changed {
        let state = tracking.observations.get_mut(id).unwrap();
        state.source = Some(source.label());
        if has_unread == Some(true) && !was_unread && !suppressed {
            state.last_arrival = state.last_update;
        }
    }
    let cleared = was_unread
        && tracking
            .observations
            .get(id)
            .is_some_and(|state| !state.has_unread);
    drop(tracking);
    use crate::diagnostics::{
        notification, NotificationEvent as Event, NotificationReason as Reason,
    };
    if let Some(generation) = acknowledgement {
        notification(
            app,
            id,
            Event::ReadCandidate,
            Reason::ProviderObservation,
            generation,
        );
        let reason = if !valid_read {
            Reason::StaleOrBackground
        } else if provider_zero {
            Reason::ProviderZero
        } else if conversation_read {
            Reason::ConversationRead
        } else if !outcome.accepted.is_empty() {
            Reason::ExactArrival
        } else {
            Reason::UnprovenArrival
        };
        notification(
            app,
            id,
            if valid_read
                && (cleared || !outcome.accepted.is_empty() || outcome.conversation_accepted)
            {
                Event::ReadAccepted
            } else {
                Event::ReadRejected
            },
            reason,
            generation,
        );
        if cleared {
            notification(app, id, Event::UnreadCleared, reason, generation);
        }
    } else if outcome.changed && has_unread == Some(true) && !suppressed {
        notification(
            app,
            id,
            Event::UnreadLatched,
            Reason::ProviderObservation,
            0,
        );
    }
    accept_read_for(app, id, &outcome.accepted);
    if outcome.changed {
        refresh(app);
    }
}

fn evidence_fingerprint(
    tracking: &Tracking,
    count: Option<u32>,
    has_unread: Option<bool>,
    evidence: &ProviderEvidence,
) -> u64 {
    let mut hash = tracking.evidence_hasher.build_hasher();
    // Selecting another conversation is presentation, never evidence of a new arrival.
    (
        count,
        has_unread,
        evidence.certainty,
        evidence.unattributed_unread,
    )
        .hash(&mut hash);
    // DOM reordering cannot resurrect a locally acknowledged badge.
    let mut conversations = evidence.conversations.iter().collect::<Vec<_>>();
    conversations.sort_by(|a, b| a.id.cmp(&b.id));
    conversations.hash(&mut hash);
    hash.finish()
}

fn same_local_acknowledgement(
    tracking: &Tracking,
    id: &str,
    count: Option<u32>,
    has_unread: Option<bool>,
    evidence: &ProviderEvidence,
) -> bool {
    tracking
        .local_acknowledgements
        .get(id)
        .is_some_and(|baseline| {
            // Swiph3l: Missing/replaced provider DOM is not new unread evidence. Retain
            // the last known baseline through navigation/loading transitions.
            evidence.certainty == Certainty::Unknown
                || has_unread.is_none()
                || baseline.is_none_or(|baseline| {
                    baseline == evidence_fingerprint(tracking, count, has_unread, evidence)
                })
        })
}

fn record_provider_evidence(
    tracking: &mut Tracking,
    id: &str,
    count: Option<u32>,
    has_unread: Option<bool>,
    evidence: &ProviderEvidence,
    at: u64,
    suppressed: bool,
) -> bool {
    let fingerprint = evidence_fingerprint(tracking, count, has_unread, evidence);
    let known = evidence.certainty != Certainty::Unknown && has_unread.is_some();
    if known {
        tracking
            .provider_fingerprints
            .insert(id.into(), fingerprint);
    }
    if !suppressed {
        tracking.local_acknowledgements.remove(id);
    } else if known && tracking.local_acknowledgements.get(id) == Some(&None) {
        tracking
            .local_acknowledgements
            .insert(id.into(), Some(fingerprint));
    }
    let opaque = |value: &str| format!("{:016x}", tracking.evidence_hasher.hash_one((id, value)));
    let current = evidence.current_conversation.as_deref().map(opaque);
    let mut conversations = evidence
        .conversations
        .iter()
        .map(|entry| ConversationEvidence {
            id: opaque(&entry.id),
            has_unread: entry.has_unread,
            count: entry.count,
        })
        .collect::<Vec<_>>();
    conversations.sort_by(|a, b| a.id.cmp(&b.id));
    let initial = !tracking.observations.contains_key(id);
    let state = tracking.observations.entry(id.into()).or_default();
    let previous = state.clone();
    state.certainty = if suppressed {
        Certainty::Unknown
    } else {
        evidence.certainty
    };
    state.last_provider_revision = evidence.revision;
    state.current_conversation = current;
    state.conversations = conversations;
    state.locally_acknowledged = suppressed;
    state.total_unread_count = if suppressed {
        None
    } else if has_unread == Some(false) && !state.has_unread {
        Some(0)
    } else {
        count.filter(|_| has_unread == Some(true))
    };
    if initial || *state != previous {
        state.last_update = Some(at);
        tracking.revision += 1;
        return true;
    }
    false
}

/// Opaque, single-use boundary captured before Discord's public Inbox flow starts.
pub struct InboxReadBaseline {
    service: crate::providers::ServiceConfig,
    through: u64,
    provider_fingerprint: Option<u64>,
    bridge_epoch: Option<u64>,
}

pub fn begin_discord_inbox_read(app: &AppHandle, id: &str) -> Result<InboxReadBaseline, String> {
    let service = crate::state::current(app)
        .services
        .into_iter()
        .find(|service| {
            service.id == id
                && service.enabled
                && service.provider == crate::providers::ProviderId::Discord
        })
        .ok_or("Discord Inbox acknowledgement unavailable for this service.")?;
    let (through, provider_fingerprint, bridge_epoch) =
        crate::services::with_configured(app, &service, || {
            let unread = app.state::<Service>();
            let tracking = unread.0.lock().unwrap_or_else(|error| error.into_inner());
            let boundary = (
                tracking.incoming_generations.get(id).copied().unwrap_or(0),
                tracking.provider_fingerprints.get(id).copied(),
            );
            drop(tracking);
            let epoch = app
                .state::<crate::desktop_notifications::Service>()
                .0
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .bridges
                .get(id)
                .map(|(epoch, _)| *epoch);
            Ok((boundary.0, boundary.1, epoch))
        })?;
    Ok(InboxReadBaseline {
        service,
        through,
        provider_fingerprint,
        bridge_epoch,
    })
}

/// Call only after the bounded public UI flow submitted the verified Inbox read action.
pub fn complete_discord_inbox_read(app: &AppHandle, baseline: InboxReadBaseline) -> bool {
    let result = crate::services::with_configured(app, &baseline.service, || {
        let current_epoch = app
            .state::<crate::desktop_notifications::Service>()
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .bridges
            .get(&baseline.service.id)
            .map(|(epoch, _)| *epoch);
        if !inbox_read_scope_valid(&crate::state::current(app), &baseline, current_epoch) {
            return Err("Discord Inbox session has changed.".into());
        }
        let unread = app.state::<Service>();
        let mut tracking = unread.0.lock().unwrap_or_else(|error| error.into_inner());
        let Some(arrivals) = acknowledge_inbox_baseline(
            &mut tracking,
            &baseline.service.id,
            baseline.through,
            baseline.provider_fingerprint,
            now(),
        ) else {
            return Err("Discord Inbox read boundary is no longer available.".into());
        };
        drop(tracking);
        Ok((
            arrivals,
            app.get_webview(&crate::services::label(&baseline.service.id)),
        ))
    });
    let Ok((arrivals, view)) = result else {
        return false;
    };
    if let Some(view) = view {
        accept_read_in(&view, &arrivals, None);
        let _ = view.eval(&format!(
            "window.__chatplusAcknowledgeAllLocal?.({})",
            baseline.through
        ));
    }
    crate::diagnostics::notification(
        app,
        &baseline.service.id,
        crate::diagnostics::NotificationEvent::ReadAccepted,
        crate::diagnostics::NotificationReason::ExplicitLocalAcknowledgement,
        baseline.through,
    );
    refresh(app);
    true
}

fn inbox_read_scope_valid(
    settings: &crate::state::Settings,
    baseline: &InboxReadBaseline,
    current_epoch: Option<u64>,
) -> bool {
    current_epoch == baseline.bridge_epoch
        && settings.services.iter().any(|service| {
            service.id == baseline.service.id
                && service.provider == crate::providers::ProviderId::Discord
                && service.url == baseline.service.url
                && service.enabled
        })
}

fn acknowledge_inbox_baseline(
    tracking: &mut Tracking,
    id: &str,
    through: u64,
    provider_fingerprint: Option<u64>,
    at: u64,
) -> Option<Vec<u64>> {
    let latest = tracking.incoming_generations.get(id).copied().unwrap_or(0);
    if latest < through {
        return None;
    }
    let mut accepted = Vec::new();
    for retained in [
        &mut tracking.observed_unread_arrivals,
        &mut tracking.pending_generations,
    ] {
        if let Some(arrivals) = retained.get_mut(id) {
            arrivals.retain(|arrival| {
                if *arrival <= through {
                    accepted.push(*arrival);
                    false
                } else {
                    true
                }
            });
            if arrivals.is_empty() {
                retained.remove(id);
            }
        }
    }
    accepted.sort_unstable();
    accepted.dedup();
    if latest <= through {
        tracking.observed_unread_overflow.remove(id);
    }
    // Swiph3l: Opening Inbox is asynchronous. The accepted click can acknowledge
    // its captured boundary, never messages that arrived while those UI steps ran.
    let proof = tracking.read_generations.entry(id.into()).or_default();
    proof.through = proof.through.max(through);
    proof.excluded.retain(|arrival| *arrival > through);
    for remaining in [
        &tracking.observed_unread_arrivals,
        &tracking.pending_generations,
    ] {
        proof.excluded.extend(
            remaining
                .get(id)
                .into_iter()
                .flatten()
                .filter(|arrival| **arrival <= proof.through)
                .copied(),
        );
    }
    let same_provider = tracking.provider_fingerprints.get(id).copied() == provider_fingerprint;
    let provider_read = tracking
        .observations
        .get(id)
        .is_some_and(|state| state.certainty == Certainty::KnownRead);
    let acknowledge_provider = same_provider || provider_read;
    let cleared = acknowledge_provider && native_unread_complete(tracking, id);
    if cleared && same_provider && provider_fingerprint.is_some() {
        tracking
            .local_acknowledgements
            .insert(id.into(), provider_fingerprint);
    }
    let state = tracking.observations.entry(id.into()).or_default();
    if cleared {
        state.has_unread = false;
        state.certainty = Certainty::Unknown;
        tracking.provider_unread_latched.remove(id);
        tracking.provider_unread_conversations.remove(id);
        tracking.provider_unread_unattributed.remove(id);
    }
    state.total_unread_count = None;
    state.locally_acknowledged = true;
    state.last_read_evidence = Some(at);
    state.last_update = Some(at);
    state.generation += 1;
    tracking.revision += 1;
    Some(accepted)
}

/// A deliberate shell action acknowledges only local state for this stable ID.
/// It never claims that the provider's server state was changed.
pub fn acknowledge_all_local_for(
    app: &AppHandle,
    service: &crate::providers::ServiceConfig,
) -> Result<(), String> {
    let id = &service.id;
    let (through, arrivals, view) = crate::services::with_configured(app, service, || {
        if !crate::provider_read::capabilities(service).all_local {
            return Err("Mark all as read is unavailable for this provider.".into());
        }
        let unread = app.state::<Service>();
        let mut tracking = unread.0.lock().unwrap_or_else(|error| error.into_inner());
        let (through, arrivals) = acknowledge_all(&mut tracking, id, now());
        drop(tracking);
        Ok((
            through,
            arrivals,
            app.get_webview(&crate::services::label(id)),
        ))
    })?;
    if let Some(view) = view {
        accept_read_in(&view, &arrivals, None);
        let _ = view.eval(&format!(
            "window.__chatplusAcknowledgeAllLocal?.({through})"
        ));
    }
    crate::diagnostics::notification(
        app,
        id,
        crate::diagnostics::NotificationEvent::UnreadCleared,
        crate::diagnostics::NotificationReason::ExplicitLocalAcknowledgement,
        through,
    );
    refresh(app);
    Ok(())
}

fn acknowledge_all(tracking: &mut Tracking, id: &str, at: u64) -> (u64, Vec<u64>) {
    let through = tracking.incoming_generations.get(id).copied().unwrap_or(0);
    let arrivals = tracking
        .observed_unread_arrivals
        .remove(id)
        .unwrap_or_default()
        .into_iter()
        .collect();
    tracking.observed_unread_overflow.remove(id);
    tracking.provider_unread_latched.remove(id);
    tracking.provider_unread_conversations.remove(id);
    tracking.provider_unread_unattributed.remove(id);
    tracking.read_generations.insert(
        id.into(),
        ReadProof {
            through,
            excluded: HashSet::new(),
        },
    );
    tracking
        .local_acknowledgements
        .insert(id.into(), tracking.provider_fingerprints.get(id).copied());
    let state = tracking.observations.entry(id.into()).or_default();
    state.has_unread = false;
    state.total_unread_count = None;
    state.certainty = Certainty::Unknown;
    state.locally_acknowledged = true;
    state.last_read_evidence = Some(at);
    state.last_update = Some(at);
    state.generation += 1;
    tracking.revision += 1;
    (through, arrivals)
}

struct ProviderObservation {
    changed: bool,
    accepted: Vec<u64>,
    conversation_accepted: bool,
}

fn observe_discord_conversations(
    tracking: &mut Tracking,
    id: &str,
    has_unread: Option<bool>,
    foreground: bool,
    acknowledgement: Option<u64>,
    provider_zero: bool,
    conversation_read: bool,
    evidence: &ProviderEvidence,
    at: u64,
) -> ProviderObservation {
    let valid_read = read_acknowledged(tracking, id, foreground, acknowledgement);
    let mut ownership_changed = false;
    let positives = evidence
        .conversations
        .iter()
        .filter(|entry| entry.has_unread == Some(true));
    let mut mapped_positive = false;
    for entry in positives {
        mapped_positive = true;
        let owned = tracking
            .provider_unread_conversations
            .entry(id.into())
            .or_default();
        if owned.len() < 64 || owned.contains(&entry.id) {
            ownership_changed |= owned.insert(entry.id.clone());
        } else {
            ownership_changed |= tracking.provider_unread_unattributed.insert(id.into());
        }
    }
    if evidence.unattributed_unread == Some(true)
        || (has_unread == Some(true)
            && (evidence.unattributed_unread != Some(false) || !mapped_positive))
    {
        ownership_changed |= tracking.provider_unread_unattributed.insert(id.into());
    }
    let global_zero = valid_read
        && provider_zero
        && has_unread == Some(false)
        && !mapped_positive
        && evidence.unattributed_unread != Some(true);
    let mut conversation_accepted = false;
    if global_zero {
        ownership_changed |= tracking.provider_unread_conversations.remove(id).is_some();
        ownership_changed |= tracking.provider_unread_unattributed.remove(id);
    } else if valid_read && conversation_read {
        if let Some(current) = evidence.current_conversation.as_deref().filter(|current| {
            evidence
                .conversations
                .iter()
                .any(|entry| entry.id == *current && entry.has_unread == Some(false))
        }) {
            if let Some(owned) = tracking.provider_unread_conversations.get_mut(id) {
                conversation_accepted = owned.remove(current);
                ownership_changed |= conversation_accepted;
            }
        }
    }
    let owned = tracking
        .provider_unread_conversations
        .get(id)
        .is_some_and(|owned| !owned.is_empty())
        || tracking.provider_unread_unattributed.contains(id);
    if owned {
        tracking.provider_unread_latched.insert(id.into());
    } else {
        tracking.provider_unread_latched.remove(id);
    }
    // Swiph3l: A virtualized DM list can read one observed conversation without
    // claiming global zero. Every other mapped or unattributed owner survives.
    let known_state = if owned {
        Some(true)
    } else if global_zero || conversation_accepted {
        Some(false)
    } else {
        has_unread.filter(|value| !*value)
    };
    let acknowledged = valid_read
        && (global_zero || conversation_accepted)
        && native_unread_complete(tracking, id);
    let mut changed = known_state
        .is_some_and(|value| observe(&mut tracking.observations, id, value, acknowledged, at));
    changed |= ownership_changed;
    if changed {
        let state = tracking.observations.entry(id.into()).or_default();
        state.generation += 1;
        if conversation_accepted || global_zero {
            state.last_read_evidence = Some(at);
        }
        tracking.revision += 1;
    }
    ProviderObservation {
        changed,
        accepted: Vec::new(),
        conversation_accepted,
    }
}

#[cfg(test)]
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
    observe_provider_scoped(
        tracking,
        id,
        has_unread,
        foreground,
        acknowledgement,
        read_arrivals,
        proof_only,
        at,
        false,
    )
}

fn observe_provider_scoped(
    tracking: &mut Tracking,
    id: &str,
    has_unread: bool,
    foreground: bool,
    acknowledgement: Option<u64>,
    read_arrivals: &[u64],
    proof_only: bool,
    at: u64,
    provider_zero: bool,
) -> ProviderObservation {
    let valid_read = read_acknowledged(tracking, id, foreground, acknowledgement);
    if !proof_only {
        if has_unread {
            tracking.provider_unread_latched.insert(id.into());
        } else if valid_read {
            // Swiph3l: A trusted known-zero retires provider evidence separately
            // from newer/pending browser arrivals, which remain unread below.
            tracking.provider_unread_latched.remove(id);
        }
    }
    let mut accepted = Vec::new();
    let retained_before = tracking
        .observed_unread_arrivals
        .get(id)
        .map_or(0, HashSet::len);
    if valid_read && provider_zero && !has_unread && !proof_only {
        accepted = consume_provider_zero(tracking, id);
    }
    if valid_read && !tracking.observed_unread_overflow.contains(id) {
        accepted.extend(consume_read_arrivals(tracking, id, read_arrivals));
        record_acknowledgement(tracking, id);
    }
    let proofs_changed = tracking
        .observed_unread_arrivals
        .get(id)
        .map_or(0, HashSet::len)
        < retained_before;
    // Swiph3l: An unknown aggregate cannot retire positive provider evidence.
    // Exact read proof may retire the dot owned only by completed native arrivals,
    // without asserting that the provider's whole account is known read.
    if proof_only {
        let clear_arrival_only = valid_read
            && !accepted.is_empty()
            && native_unread_complete(tracking, id)
            && !tracking.provider_unread_latched.contains(id);
        let cleared = clear_arrival_only
            && tracking
                .observations
                .get(id)
                .is_some_and(|state| state.has_unread);
        let changed = proofs_changed || cleared;
        if changed {
            if let Some(state) = tracking.observations.get_mut(id) {
                if cleared {
                    state.has_unread = false;
                    state.certainty = Certainty::Unknown;
                    state.total_unread_count = None;
                    state.last_update = Some(at);
                }
                state.generation += 1;
                state.last_read_evidence = Some(at);
            }
            tracking.revision += 1;
        }
        return ProviderObservation {
            changed,
            accepted,
            conversation_accepted: false,
        };
    }
    let acknowledged = valid_read && native_unread_complete(tracking, id);
    let mut changed = observe(&mut tracking.observations, id, has_unread, acknowledged, at);
    if proofs_changed {
        changed = true;
    }
    if changed {
        if let Some(state) = tracking.observations.get_mut(id) {
            state.generation += 1;
            if valid_read {
                state.last_read_evidence = Some(at);
            }
        }
        tracking.revision += 1;
    }
    ProviderObservation {
        changed,
        accepted,
        conversation_accepted: false,
    }
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
            generation: states.get(id).map_or(0, |state| state.generation),
            last_arrival: states.get(id).and_then(|state| state.last_arrival),
            last_read_evidence: states.get(id).and_then(|state| state.last_read_evidence),
            source: states.get(id).and_then(|state| state.source),
            ..Unread::default()
        },
    );
    true
}
pub fn refresh(app: &AppHandle) {
    let handle = app.clone();
    // Swiph3l: Commands and native callbacks can race. Read and apply the snapshot
    // together on the UI thread so an older tray/title update cannot overtake a clear.
    let _ = app.run_on_main_thread(move || refresh_presentation(&handle));
}

fn refresh_presentation(app: &AppHandle) {
    // Swiph3l: Sidebar and tray derive from one native snapshot; separate UI
    // booleans or separate reads could present different transitions.
    let snapshot = snapshot(app);
    let unread = &snapshot.aggregate;
    let settings = crate::state::current(app);
    if let Some(window) = app.get_window("main") {
        let caption = title(unread, settings.unread_title);
        #[cfg(feature = "notification-diagnostics")]
        let caption = format!("{caption} — Notification QA");
        let _ = window.set_title(&caption);
        crate::desktop_notifications::taskbar(&window, unread);
        let _ = app.emit_to("main", "service-unread", &snapshot);
    }
    crate::tray::refresh_unread(app, unread);
}
#[cfg(test)]
mod tests {
    use super::*;

    fn attention_sample(
        tracking: &mut Tracking,
        id: &str,
        epoch: &str,
        revision: u64,
        value: Option<bool>,
        count: Option<u32>,
    ) -> bool {
        let instant = Instant::now();
        let Some(query) = begin_attention_observation(tracking, id, value, instant) else {
            return false;
        };
        observe_attention(
            tracking, id, &query, epoch, revision, value, count, revision, instant,
        )
    }

    #[test]
    fn unknown_attention_does_not_discard_a_pending_recognized_counter() {
        let mut tracking = Tracking::default();
        let instant = Instant::now();
        let query = begin_attention_observation(&mut tracking, "wa", Some(true), instant).unwrap();
        assert!(begin_attention_observation(&mut tracking, "wa", None, instant).is_none());
        assert!(observe_attention(
            &mut tracking,
            "wa",
            &query,
            "document",
            1,
            Some(true),
            Some(2),
            1,
            instant
        ));
        assert!(tracking.observations["wa"].has_unread);
    }

    #[test]
    fn attention_transition_retry_keeps_its_original_deadline_and_applies_once() {
        let mut tracking = Tracking::default();
        attention_sample(&mut tracking, "wa", "document", 1, Some(true), Some(2));
        let started = Instant::now();
        let query = begin_attention(&mut tracking, "wa", started);
        let sequence = query.sequence;
        // A busy settings guard performs no mutation. Rechecking this same
        // ticket must leave the known counter intact until publication succeeds.
        for elapsed in [50, 100, 150] {
            assert_eq!(
                attention_query_remaining(
                    &tracking,
                    "wa",
                    &query,
                    started + Duration::from_millis(elapsed)
                ),
                Some(Duration::from_millis(5000 - elapsed))
            );
            assert_eq!(tracking.attention_queries["wa"], sequence);
            assert!(tracking.observations["wa"].has_unread);
        }
        assert!(observe_attention(
            &mut tracking,
            "wa",
            &query,
            "document",
            2,
            Some(false),
            None,
            2,
            started + Duration::from_millis(150)
        ));
        assert!(!tracking.observations["wa"].has_unread);
        assert!(attention_query_remaining(
            &tracking,
            "wa",
            &query,
            started + Duration::from_millis(200)
        )
        .is_none());
        assert!(!observe_attention(
            &mut tracking,
            "wa",
            &query,
            "document",
            2,
            Some(false),
            None,
            3,
            started + Duration::from_millis(200)
        ));
    }

    #[test]
    fn attention_transition_retry_cannot_extend_or_replace_an_invalidated_ticket() {
        for invalid in ["navigation", "arrival", "superseded", "deadline"] {
            let mut tracking = Tracking::default();
            attention_sample(&mut tracking, "wa", "document", 1, Some(true), Some(2));
            let started = Instant::now();
            let query = begin_attention(&mut tracking, "wa", started);
            let mut retry_at = started + Duration::from_millis(50);
            match invalid {
                "navigation" => invalidate_attention(&mut tracking, "wa"),
                "arrival" => {
                    begin_browser_event(&mut tracking, "wa", true, None, 2, false);
                }
                "superseded" => {
                    begin_attention(&mut tracking, "wa", retry_at);
                }
                "deadline" => retry_at = started + Duration::from_secs(5),
                _ => unreachable!(),
            }
            assert!(
                attention_query_remaining(&tracking, "wa", &query, retry_at).is_none(),
                "{invalid}"
            );
            assert!(
                !observe_attention(
                    &mut tracking,
                    "wa",
                    &query,
                    "document",
                    2,
                    Some(false),
                    None,
                    3,
                    retry_at
                ),
                "{invalid}"
            );
            assert!(tracking.observations["wa"].has_unread, "{invalid}");
            if invalid == "superseded" {
                assert_ne!(
                    tracking.attention_queries["wa"], query.sequence,
                    "an older retry cannot consume the newer ticket"
                );
            }
        }
    }

    #[test]
    fn whatsapp_attention_zero_projects_in_background_without_claiming_all_chats_read() {
        let mut tracking = Tracking::default();
        assert!(attention_sample(
            &mut tracking,
            "wa",
            "document-a",
            1,
            Some(true),
            Some(3)
        ));
        tracking
            .observations
            .get_mut("wa")
            .unwrap()
            .last_read_evidence = Some(17);
        assert!(attention_sample(
            &mut tracking,
            "wa",
            "document-a",
            2,
            Some(false),
            None
        ));
        let state = &tracking.observations["wa"];
        assert!(!state.has_unread);
        assert_eq!(state.unread_scope, Some("notification-attention"));
        assert_eq!(state.certainty, Certainty::Unknown);
        assert_eq!(state.total_unread_count, None);
        assert_eq!(state.last_read_evidence, Some(17));
        assert!(!tracking.provider_unread_latched.contains("wa"));
        let output = serde_json::to_string(state).unwrap();
        assert!(
            !output.contains("document-a"),
            "document nonces stay out of public snapshots"
        );
    }

    #[test]
    fn unknown_whatsapp_attention_retains_cached_state_and_local_acknowledgement() {
        let mut tracking = Tracking::default();
        attention_sample(&mut tracking, "wa", "a", 1, Some(true), Some(2));
        attention_sample(&mut tracking, "wa", "a", 2, None, None);
        assert!(tracking.observations["wa"].has_unread);
        acknowledge_all(&mut tracking, "wa", 3);
        let baseline = tracking.local_acknowledgements["wa"];
        attention_sample(&mut tracking, "wa", "new-document", 1, None, None);
        assert!(!tracking.observations["wa"].has_unread);
        assert!(tracking.observations["wa"].locally_acknowledged);
        assert_eq!(tracking.local_acknowledgements["wa"], baseline);
        attention_sample(&mut tracking, "wa", "new-document", 2, Some(true), Some(2));
        assert!(
            !tracking.observations["wa"].has_unread,
            "unchanged attention stays locally acknowledged across reload"
        );
    }

    #[test]
    fn whatsapp_attention_revisions_are_ordered_only_within_the_verified_document() {
        let mut tracking = Tracking::default();
        attention_sample(&mut tracking, "wa", "old-document", 9, Some(true), Some(1));
        assert!(!attention_sample(
            &mut tracking,
            "wa",
            "old-document",
            8,
            Some(false),
            None
        ));
        assert!(tracking.observations["wa"].has_unread);
        assert!(attention_sample(
            &mut tracking,
            "wa",
            "new-document",
            1,
            Some(false),
            None
        ));
        assert!(!tracking.observations["wa"].has_unread);
    }

    #[test]
    fn whatsapp_attention_rejects_superseded_expired_and_pre_arrival_query_results() {
        for invalid in ["superseded", "expired", "new-arrival"] {
            let mut tracking = Tracking::default();
            attention_sample(&mut tracking, "wa", "document", 1, Some(true), Some(1));
            let instant = Instant::now();
            let query = begin_attention(&mut tracking, "wa", instant);
            let mut completed = instant;
            match invalid {
                "superseded" => {
                    begin_attention(&mut tracking, "wa", instant);
                }
                "expired" => completed += Duration::from_secs(6),
                "new-arrival" => {
                    begin_browser_event(&mut tracking, "wa", true, None, 2, false);
                }
                _ => unreachable!(),
            }
            assert!(
                !observe_attention(
                    &mut tracking,
                    "wa",
                    &query,
                    "document",
                    2,
                    Some(false),
                    None,
                    3,
                    completed
                ),
                "{invalid}"
            );
            assert!(tracking.observations["wa"].has_unread, "{invalid}");
        }
    }

    #[test]
    fn navigation_invalidates_pending_attention_without_clearing_cached_positive() {
        let mut tracking = Tracking::default();
        attention_sample(&mut tracking, "wa", "old-document", 1, Some(true), Some(2));
        let instant = Instant::now();
        let query = begin_attention(&mut tracking, "wa", instant);
        invalidate_attention(&mut tracking, "wa");
        assert!(!observe_attention(
            &mut tracking,
            "wa",
            &query,
            "old-document",
            2,
            Some(false),
            None,
            2,
            instant
        ));
        assert!(tracking.observations["wa"].has_unread);
        attention_sample(&mut tracking, "wa", "new-document", 1, None, None);
        assert!(tracking.observations["wa"].has_unread);
        attention_sample(&mut tracking, "wa", "new-document", 2, Some(false), None);
        assert!(!tracking.observations["wa"].has_unread);
    }

    #[test]
    fn new_whatsapp_arrival_rearms_local_override_but_only_counter_evidence_restores_dot() {
        let mut tracking = Tracking::default();
        attention_sample(&mut tracking, "wa", "document", 1, Some(true), Some(2));
        acknowledge_all(&mut tracking, "wa", 2);
        attention_sample(&mut tracking, "wa", "document", 2, Some(true), Some(2));
        assert!(!tracking.observations["wa"].has_unread);
        let (arrival, changed) = begin_browser_event(&mut tracking, "wa", true, None, 3, false);
        rearm_attention(&mut tracking, "wa");
        assert!(!changed);
        assert!(
            !tracking.observations["wa"].has_unread,
            "a banner event alone never owns attention"
        );
        assert!(!tracking.pending_generations.contains_key("wa"));
        assert!(!tracking.observed_unread_arrivals.contains_key("wa"));
        assert_eq!(tracking.incoming_generations["wa"], arrival.read);
        attention_sample(&mut tracking, "wa", "document", 3, Some(true), Some(2));
        assert!(
            tracking.observations["wa"].has_unread,
            "fresh unchanged positive counter can rearm"
        );
        acknowledge_all(&mut tracking, "wa", 4);
        begin_browser_event(&mut tracking, "wa", true, None, 5, false);
        rearm_attention(&mut tracking, "wa");
        attention_sample(&mut tracking, "wa", "document", 4, Some(false), None);
        assert!(
            !tracking.observations["wa"].has_unread,
            "an official zero stays zero after an arrival"
        );
    }

    #[test]
    fn whatsapp_attention_counter_changes_preserve_other_instances_and_refresh_local_baselines() {
        let mut tracking = Tracking::default();
        for id in ["personal", "work"] {
            attention_sample(&mut tracking, id, "document", 1, Some(true), Some(2));
        }
        acknowledge_all(&mut tracking, "personal", 2);
        attention_sample(
            &mut tracking,
            "personal",
            "document",
            2,
            Some(true),
            Some(3),
        );
        assert!(
            tracking.observations["personal"].has_unread,
            "changed official attention is outside the local baseline"
        );
        attention_sample(&mut tracking, "personal", "document", 3, Some(false), None);
        assert!(!tracking.observations["personal"].has_unread);
        assert!(tracking.observations["work"].has_unread);
    }

    fn discord_evidence(
        rows: &[(&str, bool)],
        current: Option<&str>,
        unattributed: bool,
    ) -> ProviderEvidence {
        ProviderEvidence {
            current_conversation: current.map(str::to_owned),
            conversations: rows
                .iter()
                .map(|(id, unread)| ConversationObservation {
                    id: (*id).into(),
                    has_unread: Some(*unread),
                    count: None,
                })
                .collect(),
            unattributed_unread: Some(unattributed),
            ..Default::default()
        }
    }

    fn discord_tracking() -> Tracking {
        Tracking {
            foreground_service: Some("discord".into()),
            presentation_generation: 7,
            ..Default::default()
        }
    }

    #[test]
    fn observed_dm_read_clears_without_claiming_a_complete_private_list() {
        let mut tracking = discord_tracking();
        let positive = discord_evidence(&[("12345678901234567", true)], None, false);
        observe_discord_conversations(
            &mut tracking,
            "discord",
            Some(true),
            true,
            None,
            false,
            false,
            &positive,
            1,
        );
        let current = discord_evidence(
            &[("12345678901234567", false)],
            Some("12345678901234567"),
            false,
        );
        let unproven = observe_discord_conversations(
            &mut tracking,
            "discord",
            None,
            true,
            None,
            false,
            true,
            &current,
            2,
        );
        assert!(
            !unproven.conversation_accepted,
            "selection or toast activation supplies no read acknowledgement"
        );
        assert!(tracking.observations["discord"].has_unread);
        let read = observe_discord_conversations(
            &mut tracking,
            "discord",
            None,
            true,
            Some(7),
            false,
            true,
            &current,
            3,
        );
        assert!(read.conversation_accepted);
        assert!(!tracking.observations["discord"].has_unread);
        assert_eq!(tracking.observations["discord"].last_read_evidence, Some(3));
    }

    #[test]
    fn scoped_dm_read_preserves_other_conversations_and_configured_instances() {
        let mut tracking = discord_tracking();
        let both = discord_evidence(
            &[("12345678901234567", true), ("22345678901234567", true)],
            None,
            false,
        );
        for service in ["discord", "other-discord"] {
            observe_discord_conversations(
                &mut tracking,
                service,
                Some(true),
                false,
                None,
                false,
                false,
                &both,
                1,
            );
        }
        let first = discord_evidence(
            &[("12345678901234567", false)],
            Some("12345678901234567"),
            false,
        );
        assert!(
            observe_discord_conversations(
                &mut tracking,
                "discord",
                None,
                true,
                Some(7),
                false,
                true,
                &first,
                2
            )
            .conversation_accepted
        );
        assert_eq!(
            tracking.provider_unread_conversations["discord"],
            HashSet::from(["22345678901234567".into()])
        );
        assert_eq!(
            tracking.provider_unread_conversations["other-discord"].len(),
            2
        );
        assert!(tracking.observations["discord"].has_unread);
        let second = discord_evidence(
            &[("22345678901234567", false)],
            Some("22345678901234567"),
            false,
        );
        observe_discord_conversations(
            &mut tracking,
            "discord",
            None,
            true,
            Some(7),
            false,
            true,
            &second,
            3,
        );
        assert!(!tracking.observations["discord"].has_unread);
        assert!(tracking.observations["other-discord"].has_unread);
    }

    #[test]
    fn unattributed_dm_owner_survives_current_read_until_proven_global_zero() {
        let mut tracking = discord_tracking();
        let positive = discord_evidence(&[("12345678901234567", true)], None, true);
        observe_discord_conversations(
            &mut tracking,
            "discord",
            Some(true),
            true,
            None,
            false,
            false,
            &positive,
            1,
        );
        let current = discord_evidence(
            &[("12345678901234567", false)],
            Some("12345678901234567"),
            false,
        );
        observe_discord_conversations(
            &mut tracking,
            "discord",
            None,
            true,
            Some(7),
            false,
            true,
            &current,
            2,
        );
        assert!(tracking.observations["discord"].has_unread);
        assert!(tracking.provider_unread_unattributed.contains("discord"));
        let zero = discord_evidence(&[], None, false);
        observe_discord_conversations(
            &mut tracking,
            "discord",
            Some(false),
            true,
            None,
            true,
            false,
            &zero,
            3,
        );
        assert!(
            tracking.observations["discord"].has_unread,
            "a passive zero cannot clear unknown owners"
        );
        observe_discord_conversations(
            &mut tracking,
            "discord",
            Some(false),
            true,
            Some(7),
            true,
            false,
            &zero,
            4,
        );
        assert!(!tracking.observations["discord"].has_unread);
        assert!(!tracking.provider_unread_unattributed.contains("discord"));
    }

    #[test]
    fn scoped_dm_read_rejects_missing_context_background_and_new_arrival_races() {
        for invalid in [
            "stale-generation",
            "background",
            "different-service",
            "missing-row",
            "unread-row",
            "new-arrival",
        ] {
            let mut tracking = discord_tracking();
            let positive = discord_evidence(&[("12345678901234567", true)], None, false);
            observe_discord_conversations(
                &mut tracking,
                "discord",
                Some(true),
                true,
                None,
                false,
                false,
                &positive,
                1,
            );
            let mut current = discord_evidence(
                &[("12345678901234567", false)],
                Some("12345678901234567"),
                false,
            );
            let mut acknowledgement = Some(7);
            match invalid {
                "stale-generation" => acknowledgement = Some(6),
                "different-service" => tracking.foreground_service = Some("other".into()),
                "missing-row" => current.conversations.clear(),
                "unread-row" => current.conversations[0].has_unread = Some(true),
                "new-arrival" => {
                    begin_browser_event(&mut tracking, "discord", true, None, 2, false);
                }
                _ => {}
            }
            let outcome = observe_discord_conversations(
                &mut tracking,
                "discord",
                None,
                invalid != "background",
                acknowledgement,
                false,
                true,
                &current,
                3,
            );
            assert!(!outcome.conversation_accepted, "{invalid}");
            assert!(tracking.observations["discord"].has_unread, "{invalid}");
        }
    }

    #[test]
    fn dm_owner_capacity_retains_overflow_until_explicit_all_cleanup() {
        let mut tracking = discord_tracking();
        for number in 0..65 {
            let id = format!("1234567890123{number:04}");
            let positive = discord_evidence(&[(&id, true)], None, false);
            observe_discord_conversations(
                &mut tracking,
                "discord",
                Some(true),
                true,
                None,
                false,
                false,
                &positive,
                1,
            );
        }
        assert_eq!(tracking.provider_unread_conversations["discord"].len(), 64);
        assert!(tracking.provider_unread_unattributed.contains("discord"));
        acknowledge_all(&mut tracking, "discord", 2);
        assert!(!tracking
            .provider_unread_conversations
            .contains_key("discord"));
        assert!(!tracking.provider_unread_unattributed.contains("discord"));
        assert!(!tracking.observations["discord"].has_unread);
    }

    #[test]
    fn unattributed_dm_evidence_changes_the_local_all_baseline() {
        let tracking = discord_tracking();
        let known = discord_evidence(&[("12345678901234567", true)], None, false);
        let unknown = discord_evidence(&[("12345678901234567", true)], None, true);
        assert_ne!(
            evidence_fingerprint(&tracking, None, Some(true), &known),
            evidence_fingerprint(&tracking, None, Some(true), &unknown)
        );
    }

    #[test]
    fn native_complete_read_boundary_requires_every_unread_owner_to_be_clear() {
        let baseline = || {
            let mut tracking = Tracking::default();
            tracking.incoming_generations.insert("work".into(), 5);
            tracking
                .observations
                .insert("work".into(), Unread::default());
            tracking
        };
        assert_eq!(completed_read_through(&baseline(), "work"), Some(5));
        assert_eq!(completed_read_through(&baseline(), "other"), None);
        for guard in [
            "pending",
            "retained",
            "overflow",
            "provider-positive",
            "native-unread",
            "missing-observation",
            "missing-arrival",
        ] {
            let mut tracking = baseline();
            match guard {
                "pending" => {
                    tracking
                        .pending_generations
                        .insert("work".into(), HashSet::from([1]));
                }
                "retained" => {
                    tracking
                        .observed_unread_arrivals
                        .insert("work".into(), HashSet::from([1]));
                }
                "overflow" => {
                    tracking.observed_unread_overflow.insert("work".into());
                }
                "provider-positive" => {
                    tracking.provider_unread_latched.insert("work".into());
                }
                "native-unread" => {
                    tracking.observations.get_mut("work").unwrap().has_unread = true;
                }
                "missing-observation" => {
                    tracking.observations.remove("work");
                }
                "missing-arrival" => {
                    tracking.incoming_generations.remove("work");
                }
                _ => unreachable!(),
            }
            assert_eq!(completed_read_through(&tracking, "work"), None, "{guard}");
        }
    }

    #[test]
    fn later_read_acceptance_cannot_cover_earlier_pending_or_future_arrivals() {
        let mut tracking = Tracking {
            foreground_service: Some("work".into()),
            presentation_generation: 7,
            ..Default::default()
        };
        let first = begin_event(&mut tracking, "work", true, None);
        latch_arrival(&mut tracking, "work", first, 1);
        let second = begin_event(&mut tracking, "work", true, None);
        latch_arrival(&mut tracking, "work", second, 2);
        finish_event(&mut tracking, "work", second, true);
        let partial = observe_provider_scoped(
            &mut tracking,
            "work",
            false,
            true,
            Some(7),
            &[],
            false,
            3,
            true,
        );
        assert_eq!(partial.accepted, vec![second]);
        assert!(tracking.pending_generations["work"].contains(&first));
        assert!(tracking.observations["work"].has_unread);
        assert_eq!(completed_read_through(&tracking, "work"), None);

        let other = begin_event(&mut tracking, "personal", true, None);
        latch_arrival(&mut tracking, "personal", other, 4);
        finish_event(&mut tracking, "work", first, true);
        let complete = observe_provider_scoped(
            &mut tracking,
            "work",
            false,
            true,
            Some(7),
            &[],
            false,
            5,
            true,
        );
        assert!(complete.accepted.contains(&first));
        let captured = completed_read_through(&tracking, "work");
        assert_eq!(
            captured,
            Some(second),
            "the boundary belongs to this service only"
        );
        assert!(tracking.observations["personal"].has_unread);
        assert!(tracking.pending_generations["personal"].contains(&other));

        let newer = begin_event(&mut tracking, "work", true, None);
        latch_arrival(&mut tracking, "work", newer, 6);
        assert!(
            newer > captured.unwrap(),
            "a delayed complete callback cannot cover a new arrival"
        );
        assert_eq!(completed_read_through(&tracking, "work"), None);
        assert!(tracking.observations["work"].has_unread);
    }

    #[test]
    fn toast_related_focus_and_badge_changes_do_not_acknowledge_any_provider_arrival() {
        use crate::providers::ProviderId;
        for (provider, source) in [
            (ProviderId::SynologyChatplus, Source::ChatPlusDom),
            (ProviderId::SynologyChat, Source::SynologyChatDom),
            (ProviderId::Discord, Source::DiscordDom),
            (ProviderId::Whatsapp, Source::WhatsappDom),
            (ProviderId::Messenger, Source::MessengerDom),
            (ProviderId::Mattermost, Source::MattermostDom),
        ] {
            assert!(source.accepts(provider));
            let mut tracking = Tracking::default();
            let clicked = begin_event(&mut tracking, "work", true, None);
            latch_arrival(&mut tracking, "work", clicked, 1);
            let other_conversation = begin_event(&mut tracking, "work", true, None);
            latch_arrival(&mut tracking, "work", other_conversation, 2);
            let other_instance = begin_event(&mut tracking, "personal", true, None);
            latch_arrival(&mut tracking, "personal", other_instance, 3);
            finish_event(&mut tracking, "work", clicked, true);
            finish_event(&mut tracking, "work", other_conversation, true);

            for event in ["toast-click", "toast-dismissal", "focus"] {
                let foreground = event != "toast-dismissal";
                tracking.foreground_service = foreground.then(|| "work".into());
                tracking.presentation_generation += 1;
                // Swiph3l: Routing/focus can remove a provider badge before a read
                // gesture. Neither that zero nor a late view query proves a read.
                let result = observe_provider(
                    &mut tracking,
                    "work",
                    false,
                    foreground,
                    None,
                    &[],
                    false,
                    4,
                );
                assert!(result.accepted.is_empty(), "{provider:?}/{event}");
                assert!(!result.changed, "{provider:?}/{event}");
                assert!(!observe_browser_event(
                    &mut tracking,
                    "work",
                    true,
                    5,
                    true,
                    clicked,
                ));
                assert!(
                    tracking.observations["work"].has_unread,
                    "{provider:?}/{event}"
                );
                assert!(tracking.observations["personal"].has_unread);
                assert_eq!(tracking.observed_unread_arrivals["work"].len(), 2);
                assert!(tracking.observed_unread_arrivals["personal"].contains(&other_instance));
                assert!(!tracking.read_generations.contains_key("work"));
            }
            let newer = begin_event(&mut tracking, "work", true, None);
            latch_arrival(&mut tracking, "work", newer, 6);
            assert!(tracking.observed_unread_arrivals["work"].contains(&newer));
            assert!(tracking.observations["personal"].has_unread);
        }
    }

    #[test]
    fn actual_current_provider_read_proof_after_routing_retires_only_its_exact_message() {
        let mut tracking = Tracking {
            foreground_service: Some("discord-work".into()),
            presentation_generation: 4,
            ..Default::default()
        };
        let current = begin_event(&mut tracking, "discord-work", true, None);
        latch_arrival(&mut tracking, "discord-work", current, 1);
        let other_conversation = begin_event(&mut tracking, "discord-work", true, None);
        latch_arrival(&mut tracking, "discord-work", other_conversation, 2);
        let other_instance = begin_event(&mut tracking, "discord-personal", true, None);
        latch_arrival(&mut tracking, "discord-personal", other_instance, 3);
        finish_event(&mut tracking, "discord-work", current, true);
        finish_event(&mut tracking, "discord-work", other_conversation, true);

        let focus_only = observe_provider(
            &mut tracking,
            "discord-work",
            false,
            true,
            None,
            &[],
            false,
            4,
        );
        assert!(focus_only.accepted.is_empty());
        assert!(tracking.observed_unread_arrivals["discord-work"].contains(&current));
        let proof = observe_provider(
            &mut tracking,
            "discord-work",
            false,
            true,
            Some(4),
            &[current],
            false,
            5,
        );
        assert_eq!(proof.accepted, [current]);
        assert!(tracking.read_generations["discord-work"].includes(current));
        assert!(!tracking.read_generations["discord-work"].includes(other_conversation));
        assert!(!tracking.read_generations["discord-work"].includes(other_instance));
        assert!(tracking.observations["discord-work"].has_unread);
        assert!(tracking.observations["discord-personal"].has_unread);
        assert_eq!(tracking.observed_unread_arrivals["discord-work"].len(), 1);
        assert!(!observe_browser_event(
            &mut tracking,
            "discord-work",
            false,
            6,
            true,
            current,
        ));
        let newer = begin_event(&mut tracking, "discord-work", true, None);
        latch_arrival(&mut tracking, "discord-work", newer, 7);
        assert!(tracking.observed_unread_arrivals["discord-work"].contains(&newer));
        assert!(tracking.observations["discord-personal"].has_unread);
    }

    #[test]
    fn inbox_completion_acknowledges_its_baseline_but_keeps_new_arrivals_and_other_instances() {
        let mut tracking = Tracking::default();
        tracking.provider_fingerprints.insert("work".into(), 10);
        let old = begin_event(&mut tracking, "work", true, None);
        latch_arrival(&mut tracking, "work", old, 1);
        let cutoff = tracking.incoming_generations["work"];
        let other = begin_event(&mut tracking, "personal", true, None);
        latch_arrival(&mut tracking, "personal", other, 2);
        let newer = begin_event(&mut tracking, "work", true, None);
        latch_arrival(&mut tracking, "work", newer, 3);

        assert_eq!(
            acknowledge_inbox_baseline(&mut tracking, "work", cutoff, Some(10), 4),
            Some(vec![old])
        );
        assert!(tracking.observations["work"].has_unread);
        assert!(tracking.observations["personal"].has_unread);
        assert!(tracking.pending_generations["work"].contains(&newer));
        assert!(!tracking.pending_generations["work"].contains(&old));
        assert!(tracking.read_generations["work"].includes(old));
        assert!(!tracking.read_generations["work"].includes(newer));
        assert!(!tracking.read_generations["work"].includes(other));
        assert!(!observe_browser_event(
            &mut tracking,
            "work",
            false,
            5,
            true,
            old
        ));
        assert!(tracking.observed_unread_arrivals["work"].contains(&newer));
        assert!(!tracking.local_acknowledgements.contains_key("work"));
    }

    #[test]
    fn inbox_completion_clears_only_unchanged_provider_baseline_and_does_not_guess_a_future_one() {
        let mut tracking = Tracking::default();
        observe_provider(&mut tracking, "discord", true, false, None, &[], false, 0);
        tracking.provider_fingerprints.insert("discord".into(), 10);
        let old = begin_event(&mut tracking, "discord", true, None);
        latch_arrival(&mut tracking, "discord", old, 1);
        assert_eq!(
            acknowledge_inbox_baseline(&mut tracking, "discord", old, Some(10), 2),
            Some(vec![old])
        );
        assert!(!tracking.observations["discord"].has_unread);
        assert!(!tracking.provider_unread_latched.contains("discord"));
        assert_eq!(tracking.local_acknowledgements["discord"], Some(10));
        assert_eq!(
            tracking.observations["discord"].certainty,
            Certainty::Unknown
        );

        let newer = begin_event(&mut tracking, "discord", true, None);
        latch_arrival(&mut tracking, "discord", newer, 3);
        tracking.provider_fingerprints.insert("discord".into(), 20);
        observe_provider(&mut tracking, "discord", true, false, None, &[], false, 3);
        assert_eq!(
            acknowledge_inbox_baseline(&mut tracking, "discord", newer, Some(10), 4),
            Some(vec![newer])
        );
        assert!(
            tracking.observations["discord"].has_unread,
            "new positive provider evidence is outside the captured request"
        );
        assert!(!tracking.local_acknowledgements.contains_key("discord"));
        assert!(tracking.provider_unread_latched.contains("discord"));
    }

    #[test]
    fn inbox_completion_accepts_changed_provider_zero_without_claiming_server_read_certainty() {
        let mut tracking = Tracking::default();
        let old = begin_event(&mut tracking, "discord", true, None);
        latch_arrival(&mut tracking, "discord", old, 1);
        tracking.provider_fingerprints.insert("discord".into(), 20);
        tracking.observations.get_mut("discord").unwrap().certainty = Certainty::KnownRead;
        assert_eq!(
            acknowledge_inbox_baseline(&mut tracking, "discord", old, Some(10), 2),
            Some(vec![old])
        );
        assert!(!tracking.observations["discord"].has_unread);
        assert_eq!(
            tracking.observations["discord"].certainty,
            Certainty::Unknown
        );
        assert!(!tracking.local_acknowledgements.contains_key("discord"));
    }

    #[test]
    fn inbox_completion_preserves_later_read_proof_and_excludes_new_unread_queries() {
        let mut tracking = Tracking {
            foreground_service: Some("discord".into()),
            presentation_generation: 3,
            ..Default::default()
        };
        let old = begin_event(&mut tracking, "discord", true, None);
        latch_arrival(&mut tracking, "discord", old, 1);
        let later_read = begin_event(&mut tracking, "discord", true, None);
        latch_arrival(&mut tracking, "discord", later_read, 2);
        let pending = begin_event(&mut tracking, "discord", true, None);
        latch_arrival(&mut tracking, "discord", pending, 3);
        finish_event(&mut tracking, "discord", later_read, true);
        let read = observe_provider(
            &mut tracking,
            "discord",
            true,
            true,
            Some(3),
            &[later_read],
            true,
            4,
        );
        assert_eq!(read.accepted, [later_read]);
        assert_eq!(tracking.read_generations["discord"].through, pending);

        assert_eq!(
            acknowledge_inbox_baseline(&mut tracking, "discord", old, None, 5),
            Some(vec![old])
        );
        assert!(tracking.read_generations["discord"].includes(old));
        assert!(tracking.read_generations["discord"].includes(later_read));
        assert!(!tracking.read_generations["discord"].includes(pending));
        assert!(tracking.pending_generations["discord"].contains(&pending));
        assert!(tracking.observations["discord"].has_unread);
    }

    #[test]
    fn inbox_completion_with_unknown_dom_never_suppresses_the_first_new_provider_evidence() {
        let mut tracking = Tracking::default();
        let old = begin_event(&mut tracking, "discord", true, None);
        latch_arrival(&mut tracking, "discord", old, 1);
        acknowledge_inbox_baseline(&mut tracking, "discord", old, None, 2).unwrap();
        assert!(!tracking.observations["discord"].has_unread);
        assert!(!tracking.local_acknowledgements.contains_key("discord"));
        let new_evidence = ProviderEvidence {
            certainty: Certainty::KnownUnread,
            ..Default::default()
        };
        assert!(!same_local_acknowledgement(
            &tracking,
            "discord",
            Some(2),
            Some(true),
            &new_evidence
        ));
        observe(&mut tracking.observations, "discord", true, false, 3);
        record_provider_evidence(
            &mut tracking,
            "discord",
            Some(2),
            Some(true),
            &new_evidence,
            3,
            false,
        );
        assert!(tracking.observations["discord"].has_unread);
    }

    #[test]
    fn inbox_completion_resolves_old_overflow_only_without_a_newer_arrival() {
        for newer in [false, true] {
            let mut tracking = Tracking::default();
            for _ in 0..=READ_ARRIVAL_LIMIT {
                let arrival = begin_event(&mut tracking, "discord", true, None);
                latch_arrival(&mut tracking, "discord", arrival, 1);
                finish_event(&mut tracking, "discord", arrival, true);
            }
            let cutoff = tracking.incoming_generations["discord"];
            let next = if newer {
                let arrival = begin_event(&mut tracking, "discord", true, None);
                latch_arrival(&mut tracking, "discord", arrival, 2);
                Some(arrival)
            } else {
                None
            };
            acknowledge_inbox_baseline(&mut tracking, "discord", cutoff, None, 3).unwrap();
            assert_eq!(tracking.observations["discord"].has_unread, newer);
            assert_eq!(tracking.observed_unread_overflow.contains("discord"), newer);
            assert!(tracking.read_generations["discord"].includes(cutoff));
            if let Some(next) = next {
                assert!(!tracking.read_generations["discord"].includes(next));
                assert!(tracking.pending_generations["discord"].contains(&next));
            }
        }
    }

    #[test]
    fn inbox_baseline_is_invalid_after_instance_removal_config_change_or_source_replacement() {
        use crate::providers::{NotificationColor, ProviderId, ServiceConfig};
        let service = ServiceConfig {
            id: "discord-work".into(),
            provider: ProviderId::Discord,
            name: "Work".into(),
            url: "https://discord.com/app/".into(),
            enabled: true,
            notifications: true,
            notification_color: NotificationColor::Auto,
        };
        let baseline = InboxReadBaseline {
            service: service.clone(),
            through: 1,
            provider_fingerprint: Some(10),
            bridge_epoch: Some(7),
        };
        let settings = crate::state::Settings {
            services: vec![service.clone()],
            ..Default::default()
        };
        assert!(inbox_read_scope_valid(&settings, &baseline, Some(7)));
        assert!(!inbox_read_scope_valid(&settings, &baseline, Some(8)));
        assert!(!inbox_read_scope_valid(&settings, &baseline, None));
        for configured in [
            None,
            Some(ServiceConfig {
                id: "discord-personal".into(),
                ..service.clone()
            }),
            Some(ServiceConfig {
                provider: ProviderId::Whatsapp,
                ..service.clone()
            }),
            Some(ServiceConfig {
                url: "https://discord.com/channels/@me/".into(),
                ..service.clone()
            }),
            Some(ServiceConfig {
                enabled: false,
                ..service.clone()
            }),
        ] {
            let settings = crate::state::Settings {
                services: configured.into_iter().collect(),
                ..Default::default()
            };
            assert!(!inbox_read_scope_valid(&settings, &baseline, Some(7)));
        }
        let mut tracking = Tracking::default();
        assert_eq!(
            acknowledge_inbox_baseline(&mut tracking, "discord-work", 1, Some(10), 2),
            None
        );
        assert!(tracking.observations.is_empty());
    }

    #[test]
    fn explicit_all_local_is_service_scoped_and_late_queries_cannot_resurrect_it() {
        let mut tracking = Tracking::default();
        observe_provider(
            &mut tracking,
            "discord-work",
            true,
            false,
            None,
            &[],
            false,
            0,
        );
        observe_provider(
            &mut tracking,
            "discord-personal",
            true,
            false,
            None,
            &[],
            false,
            0,
        );
        let first = begin_event(&mut tracking, "discord-work", true, None);
        latch_arrival(&mut tracking, "discord-work", first, 1);
        let other = begin_event(&mut tracking, "discord-personal", true, None);
        latch_arrival(&mut tracking, "discord-personal", other, 2);
        let (through, accepted) = acknowledge_all(&mut tracking, "discord-work", 3);
        assert_eq!(through, first);
        assert_eq!(accepted, vec![first]);
        assert!(!tracking.observations["discord-work"].has_unread);
        assert_eq!(
            tracking.observations["discord-work"].certainty,
            Certainty::Unknown
        );
        assert!(tracking.observations["discord-work"].locally_acknowledged);
        assert!(tracking.observations["discord-personal"].has_unread);
        assert!(!tracking.provider_unread_latched.contains("discord-work"));
        assert!(tracking
            .provider_unread_latched
            .contains("discord-personal"));
        assert!(!observe_browser_event(
            &mut tracking,
            "discord-work",
            false,
            4,
            true,
            first
        ));
        let next = begin_event(&mut tracking, "discord-work", true, None);
        assert!(latch_arrival(&mut tracking, "discord-work", next, 5));
        assert!(tracking.observations["discord-work"].has_unread);
        assert!(!tracking.observations["discord-work"].locally_acknowledged);
    }

    #[test]
    fn explicit_all_local_resolves_saturation_without_consuming_another_service() {
        let mut tracking = Tracking::default();
        for _ in 0..=READ_ARRIVAL_LIMIT {
            let arrival = begin_event(&mut tracking, "discord", true, None);
            latch_arrival(&mut tracking, "discord", arrival, 1);
        }
        let before = tracking.incoming_generations["discord"];
        assert!(tracking.observed_unread_overflow.contains("discord"));
        let other = begin_event(&mut tracking, "other-discord", true, None);
        latch_arrival(&mut tracking, "other-discord", other, 2);
        let (through, accepted) = acknowledge_all(&mut tracking, "discord", 3);
        assert_eq!(through, before);
        assert_eq!(accepted.len(), READ_ARRIVAL_LIMIT);
        assert!(!tracking.observed_unread_overflow.contains("discord"));
        assert!(tracking.read_generations["discord"].includes(before));
        assert!(!tracking.read_generations["discord"].includes(other));
        for arrival in 1..=before {
            assert!(!observe_browser_event(
                &mut tracking,
                "discord",
                false,
                4,
                true,
                arrival
            ));
        }
        assert!(tracking.observations["other-discord"].has_unread);
        assert!(!tracking.observations["discord"].has_unread);
    }

    #[test]
    fn local_all_acknowledgement_suppresses_identical_provider_badges_but_not_changed_evidence() {
        let mut tracking = Tracking::default();
        let evidence = ProviderEvidence {
            revision: Some(1),
            certainty: Certainty::KnownUnread,
            current_conversation: Some("channel-a".into()),
            conversations: vec![ConversationObservation {
                id: "channel-b".into(),
                has_unread: Some(true),
                count: Some(2),
            }],
            unattributed_unread: None,
        };
        observe(&mut tracking.observations, "discord", true, false, 1);
        record_provider_evidence(
            &mut tracking,
            "discord",
            Some(2),
            Some(true),
            &evidence,
            1,
            false,
        );
        acknowledge_all(&mut tracking, "discord", 2);
        assert!(same_local_acknowledgement(
            &tracking,
            "discord",
            Some(2),
            Some(true),
            &evidence
        ));
        let advanced = ProviderEvidence {
            revision: Some(2),
            ..evidence
        };
        assert!(
            same_local_acknowledgement(&tracking, "discord", Some(2), Some(true), &advanced),
            "observer revisions alone do not invent new unread"
        );
        assert!(!same_local_acknowledgement(
            &tracking,
            "discord",
            Some(3),
            Some(true),
            &advanced
        ));
    }

    #[test]
    fn local_all_baseline_survives_unknown_dom_and_repeated_acknowledgement() {
        let mut tracking = Tracking::default();
        let evidence = ProviderEvidence {
            revision: Some(1),
            certainty: Certainty::KnownUnread,
            current_conversation: Some("channel-a".into()),
            ..Default::default()
        };
        observe(&mut tracking.observations, "discord", true, false, 1);
        record_provider_evidence(
            &mut tracking,
            "discord",
            None,
            Some(true),
            &evidence,
            1,
            false,
        );
        acknowledge_all(&mut tracking, "discord", 2);
        let baseline = tracking.local_acknowledgements["discord"];
        let unknown = ProviderEvidence {
            revision: Some(2),
            ..Default::default()
        };
        let suppressed = same_local_acknowledgement(&tracking, "discord", None, None, &unknown);
        assert!(
            suppressed,
            "root replacement cannot manufacture new unread evidence"
        );
        record_provider_evidence(
            &mut tracking,
            "discord",
            None,
            None,
            &unknown,
            3,
            suppressed,
        );
        assert_eq!(tracking.local_acknowledgements["discord"], baseline);
        assert!(!tracking.observations["discord"].has_unread);
        assert!(tracking.observations["discord"].locally_acknowledged);
        acknowledge_all(&mut tracking, "discord", 4);
        assert_eq!(tracking.local_acknowledgements["discord"], baseline);
        assert!(same_local_acknowledgement(
            &tracking,
            "discord",
            None,
            Some(true),
            &evidence
        ));
        let next = begin_event(&mut tracking, "discord", true, None);
        assert!(latch_arrival(&mut tracking, "discord", next, 5));
        assert!(!tracking.local_acknowledgements.contains_key("discord"));
        assert!(tracking.observations["discord"].has_unread);
    }

    #[test]
    fn unknown_dom_cannot_establish_a_wildcard_local_all_baseline() {
        let mut tracking = Tracking::default();
        acknowledge_all(&mut tracking, "discord", 1);
        let unknown = ProviderEvidence::default();
        record_provider_evidence(&mut tracking, "discord", None, None, &unknown, 2, true);
        assert_eq!(tracking.local_acknowledgements["discord"], None);
        assert!(!tracking.provider_fingerprints.contains_key("discord"));
        let known = ProviderEvidence {
            certainty: Certainty::KnownUnread,
            ..Default::default()
        };
        assert!(same_local_acknowledgement(
            &tracking,
            "discord",
            None,
            Some(true),
            &known
        ));
        record_provider_evidence(&mut tracking, "discord", None, Some(true), &known, 3, true);
        assert!(tracking.local_acknowledgements["discord"].is_some());
    }

    #[test]
    fn provider_evidence_preserves_unknown_state_and_hides_conversation_identifiers() {
        let mut tracking = Tracking::default();
        observe(&mut tracking.observations, "first", true, false, 1);
        let evidence = ProviderEvidence {
            revision: Some(9),
            certainty: Certainty::Unknown,
            current_conversation: Some("private-conversation-technical-key".into()),
            conversations: vec![ConversationObservation {
                id: "other-technical-key".into(),
                has_unread: Some(true),
                count: Some(4),
            }],
            unattributed_unread: None,
        };
        assert!(record_provider_evidence(
            &mut tracking,
            "first",
            None,
            None,
            &evidence,
            2,
            false
        ));
        assert!(tracking.observations["first"].has_unread);
        assert_eq!(tracking.observations["first"].certainty, Certainty::Unknown);
        assert_eq!(
            tracking.observations["first"].last_provider_revision,
            Some(9)
        );
        assert_eq!(tracking.observations["first"].total_unread_count, None);
        let serialized = serde_json::to_string(&tracking.observations["first"]).unwrap();
        assert!(!serialized.contains("technical-key"));
        record_provider_evidence(&mut tracking, "second", None, None, &evidence, 2, false);
        assert_ne!(
            tracking.observations["first"].current_conversation,
            tracking.observations["second"].current_conversation
        );
        let known = ProviderEvidence {
            certainty: Certainty::KnownUnread,
            revision: Some(10),
            ..evidence
        };
        record_provider_evidence(
            &mut tracking,
            "first",
            Some(4),
            Some(true),
            &known,
            3,
            false,
        );
        assert_eq!(tracking.observations["first"].total_unread_count, Some(4));
    }
    #[test]
    fn immediate_arrival_stays_latched_while_a_trusted_zero_waits_for_query_completion() {
        let mut tracking = Tracking {
            foreground_service: Some("origin".into()),
            presentation_generation: 4,
            ..Default::default()
        };
        let arrival = begin_event(&mut tracking, "origin", true, None);
        assert!(latch_arrival(&mut tracking, "origin", arrival, 1));
        let early = observe_provider_scoped(
            &mut tracking,
            "origin",
            false,
            true,
            Some(4),
            &[],
            false,
            2,
            true,
        );
        assert!(early.accepted.is_empty());
        assert!(!early.changed);
        assert!(tracking.observations["origin"].has_unread);
        assert!(!observe_browser_event(
            &mut tracking,
            "origin",
            true,
            3,
            true,
            arrival
        ));
        let retry = observe_provider_scoped(
            &mut tracking,
            "origin",
            false,
            true,
            Some(4),
            &[],
            false,
            4,
            true,
        );
        assert_eq!(retry.accepted, vec![arrival]);
        assert!(!tracking.observations["origin"].has_unread);
    }

    #[test]
    fn saturated_provider_zero_echoes_completed_latest_boundary_but_never_a_pending_one() {
        let mut tracking = Tracking {
            foreground_service: Some("origin".into()),
            presentation_generation: 4,
            ..Default::default()
        };
        for at in 1..=READ_ARRIVAL_LIMIT as u64 + 1 {
            let arrival = begin_event(&mut tracking, "origin", true, None);
            latch_arrival(&mut tracking, "origin", arrival, at);
            finish_event(&mut tracking, "origin", arrival, true);
        }
        let latest = tracking.incoming_generations["origin"];
        let read = observe_provider_scoped(
            &mut tracking,
            "origin",
            false,
            true,
            Some(4),
            &[],
            false,
            300,
            true,
        );
        assert!(read.accepted.contains(&latest));
        assert_eq!(read.accepted.len(), READ_ARRIVAL_LIMIT + 1);
        assert!(!tracking.observations["origin"].has_unread);
        assert!(tracking.read_generations["origin"].includes(latest));
    }
    fn assert_presentations(tracking: &Tracking, settings: &crate::state::Settings) {
        let snapshot = project(tracking, settings);
        for service in settings.services.iter().filter(|service| service.enabled) {
            assert_eq!(
                snapshot.services.get(&service.id),
                tracking.observations.get(&service.id)
            );
        }
        assert_eq!(
            snapshot.aggregate.has_unread,
            snapshot.services.values().any(|state| state.has_unread)
        );
    }

    #[test]
    fn provider_zero_matrix_preserves_native_sidebar_and_tray_after_each_transition() {
        use crate::providers::{ProviderId, ServiceConfig};
        for provider in [
            ProviderId::SynologyChatplus,
            ProviderId::SynologyChat,
            ProviderId::Discord,
        ] {
            let settings = crate::state::Settings {
                services: ["first", "second"]
                    .into_iter()
                    .map(|id| ServiceConfig {
                        id: id.into(),
                        provider,
                        name: id.into(),
                        url: "https://example.invalid/".into(),
                        enabled: true,
                        notifications: true,
                        notification_color: crate::providers::NotificationColor::Auto,
                    })
                    .collect(),
                ..Default::default()
            };
            let mut tracking = Tracking::default();
            // A/I: retained child focus and disappearing background badges.
            let arrival = begin_event(&mut tracking, "first", true, None);
            observe_browser_event(&mut tracking, "first", false, 1, true, arrival);
            assert_presentations(&tracking, &settings);
            for (foreground, acknowledgement) in [(false, None), (true, None), (true, Some(0))] {
                // B/G/H: restore, synthetic observation, or switching only.
                observe_provider_scoped(
                    &mut tracking,
                    "first",
                    false,
                    foreground,
                    acknowledgement,
                    &[],
                    false,
                    2,
                    true,
                );
                assert!(tracking.observations["first"].has_unread);
                assert_presentations(&tracking, &settings);
            }
            tracking.foreground_service = Some("first".into());
            tracking.presentation_generation = 3;
            observe_provider_scoped(
                &mut tracking,
                "first",
                false,
                true,
                Some(2),
                &[],
                false,
                3,
                true,
            );
            assert!(tracking.observations["first"].has_unread);
            // C/D: fresh trusted conversation/composer proof with provider zero.
            let read = observe_provider_scoped(
                &mut tracking,
                "first",
                false,
                true,
                Some(3),
                &[],
                false,
                4,
                true,
            );
            assert_eq!(read.accepted, vec![arrival]);
            assert!(!tracking.observations["first"].has_unread);
            assert_eq!(tracking.observations["first"].last_read_evidence, Some(4));
            assert_presentations(&tracking, &settings);
            // E/F: clear one service then the final service; aggregation is derived.
            for id in ["first", "second"] {
                let arrival = begin_event(&mut tracking, id, true, None);
                observe_browser_event(&mut tracking, id, false, 5, true, arrival);
                assert_presentations(&tracking, &settings);
            }
            observe_provider_scoped(
                &mut tracking,
                "first",
                false,
                true,
                Some(3),
                &[],
                false,
                6,
                true,
            );
            assert!(!tracking.observations["first"].has_unread);
            assert!(tracking.observations["second"].has_unread);
            assert!(project(&tracking, &settings).aggregate.has_unread);
            assert_presentations(&tracking, &settings);
            tracking.foreground_service = Some("second".into());
            tracking.presentation_generation = 4;
            observe_provider_scoped(
                &mut tracking,
                "second",
                false,
                true,
                Some(4),
                &[],
                false,
                7,
                true,
            );
            assert!(!project(&tracking, &settings).aggregate.has_unread);
            assert_presentations(&tracking, &settings);
        }
    }

    #[test]
    fn provider_zero_cannot_read_pending_arrivals_or_positive_unknown_state() {
        let mut tracking = Tracking {
            foreground_service: Some("origin".into()),
            presentation_generation: 4,
            ..Default::default()
        };
        let completed = begin_event(&mut tracking, "origin", true, None);
        observe_browser_event(&mut tracking, "origin", false, 1, true, completed);
        let pending = begin_event(&mut tracking, "origin", true, None);
        for (has_unread, proof_only) in [(true, false), (false, true)] {
            observe_provider_scoped(
                &mut tracking,
                "origin",
                has_unread,
                true,
                Some(4),
                &[],
                proof_only,
                2,
                true,
            );
            assert!(tracking.observations["origin"].has_unread);
        }
        let read = observe_provider_scoped(
            &mut tracking,
            "origin",
            false,
            true,
            Some(4),
            &[],
            false,
            3,
            true,
        );
        assert_eq!(read.accepted, vec![completed]);
        assert!(
            tracking.observations["origin"].has_unread,
            "pending arrival keeps every presentation unread"
        );
        assert!(!tracking.read_generations["origin"].includes(pending));
        observe_browser_event(&mut tracking, "origin", false, 4, true, pending);
        assert!(tracking.observations["origin"].has_unread);
        tracking.observed_unread_overflow.insert("origin".into());
        observe_provider_scoped(
            &mut tracking,
            "origin",
            false,
            true,
            Some(4),
            &[],
            false,
            5,
            true,
        );
        assert!(!tracking.observations["origin"].has_unread);
        assert!(!tracking.observed_unread_overflow.contains("origin"));
    }

    #[test]
    fn loaded_foreground_conversation_is_still_unread_until_interacted_with() {
        let mut tracking = Tracking::default();
        let arrival = begin_event(&mut tracking, "origin", true, None);
        assert!(observe_browser_event(
            &mut tracking,
            "origin",
            true,
            1,
            true,
            arrival
        ));
        assert!(tracking.observations["origin"].has_unread);
    }
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
    fn selected_user_a_or_other_service_minimized_latches_native_unread_for_all_three_providers() {
        use crate::providers::ProviderId;
        for (provider, source) in [
            (ProviderId::SynologyChatplus, Source::ChatPlusDom),
            (ProviderId::SynologyChat, Source::SynologyChatDom),
            (ProviderId::Discord, Source::DiscordDom),
        ] {
            assert!(provider.definition().unread);
            assert!(provider.definition().notifications);
            assert!(source.accepts(provider));
            for selected in ["origin", "other"] {
                let mut tracking = Tracking {
                    foreground_service: Some(selected.into()),
                    presentation_generation: 4,
                    visibility_generation: 2,
                    ..Default::default()
                };
                // Swiph3l: Model the adverse minimize race: logical User A focus
                // and projected foreground may still be true when the native event arrives.
                let native_foreground = crate::window::foreground_state(true, true, true);
                let foreground = selected == "origin" && native_foreground;
                let viewed = viewing_evidence_current(&tracking, "origin", foreground, 2, true);
                assert!(
                    !viewed,
                    "{provider:?}/{selected}: logical conversation focus cannot override minimize"
                );
                revoke_input(&mut tracking, "origin", true);
                let arrival = begin_event(&mut tracking, "origin", true, None);
                assert!(observe_browser_event(
                    &mut tracking,
                    "origin",
                    viewed,
                    1,
                    true,
                    arrival
                ));
                assert!(tracking.observed_unread_arrivals["origin"].contains(&arrival));
                assert!(crate::desktop_notifications::should_notify(
                    true, true, viewed
                ));
                let generation = tracking.presentation_generation;
                for proofs in [vec![], vec![arrival]] {
                    let empty = observe_provider(
                        &mut tracking,
                        "origin",
                        false,
                        foreground,
                        Some(generation),
                        &proofs,
                        false,
                        2,
                    );
                    assert!(!empty.changed);
                    assert!(
                        empty.accepted.is_empty(),
                        "{provider:?}/{selected}: a minimized page cannot mint a read proof"
                    );
                }
                assert!(tracking.observations["origin"].has_unread);
                assert!(aggregate(tracking.observations.values()).has_unread);
                tracking.foreground_service = Some("other".into());
                tracking.presentation_generation += 1;
                let generation = tracking.presentation_generation;
                let wrong_service = observe_provider(
                    &mut tracking,
                    "origin",
                    false,
                    false,
                    Some(generation),
                    &[arrival],
                    false,
                    3,
                );
                assert!(!wrong_service.changed);
                assert!(wrong_service.accepted.is_empty());
                tracking.foreground_service = Some("origin".into());
                tracking.presentation_generation += 1;
                let restored =
                    observe_provider(&mut tracking, "origin", false, true, None, &[], false, 4);
                assert!(
                    !restored.changed,
                    "restoring/focusing origin is not a user conversation read"
                );
                assert!(tracking.observations["origin"].has_unread);
            }
        }
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
    fn new_native_message_revokes_earlier_input_and_latches_even_a_viewed_conversation() {
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
        assert!(observe_browser_event(
            &mut tracking,
            "selected",
            true,
            1,
            true,
            first
        ));
        assert!(tracking.observations["selected"].has_unread);
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
        assert!(observe_browser_event(
            &mut tracking,
            "selected",
            true,
            1,
            true,
            first
        ));
        assert!(observe_browser_event(
            &mut tracking,
            "selected",
            true,
            2,
            true,
            second
        ));
        assert!(tracking.observations["selected"].has_unread);
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
        assert_eq!(Source::MattermostDom.label(), "mattermost-dom");
        for (source, provider) in [
            (Source::ChatPlusDom, ProviderId::SynologyChatplus),
            (Source::SynologyChatDom, ProviderId::SynologyChat),
            (Source::DiscordDom, ProviderId::Discord),
            (Source::WhatsappDom, ProviderId::Whatsapp),
            (Source::MessengerDom, ProviderId::Messenger),
            (Source::MattermostDom, ProviderId::Mattermost),
        ] {
            assert!(source.accepts(provider));
            for other in [
                ProviderId::SynologyChatplus,
                ProviderId::SynologyChat,
                ProviderId::Discord,
                ProviderId::Whatsapp,
                ProviderId::Messenger,
                ProviderId::Mattermost,
                ProviderId::Slack,
            ] {
                assert_eq!(source.accepts(other), provider == other);
            }
        }
    }

    #[test]
    fn scoped_discord_and_whatsapp_browser_events_are_excluded_from_native_unread_ownership() {
        use crate::providers::ProviderId;
        for provider in [
            ProviderId::SynologyChatplus,
            ProviderId::SynologyChat,
            ProviderId::Messenger,
            ProviderId::Mattermost,
            ProviderId::Slack,
        ] {
            assert!(provider_tracks_browser_arrivals(provider), "{provider:?}");
            let mut tracking = Tracking::default();
            let (arrival, changed) = begin_browser_event(
                &mut tracking,
                "origin",
                true,
                None,
                1,
                provider_tracks_browser_arrivals(provider),
            );
            assert!(changed, "{provider:?}");
            assert!(tracking.pending_generations["origin"].contains(&arrival.read));
            assert!(tracking.observed_unread_arrivals["origin"].contains(&arrival.read));
            observe_browser_event_with_policy(
                &mut tracking,
                "origin",
                false,
                2,
                true,
                arrival.read,
                provider_tracks_browser_arrivals(provider),
            );
            assert!(tracking.observations["origin"].has_unread);
            assert!(!tracking.pending_generations.contains_key("origin"));
        }
        assert!(!provider_tracks_browser_arrivals(ProviderId::Discord));
        assert!(!provider_tracks_browser_arrivals(ProviderId::Whatsapp));
    }

    #[test]
    fn unclassified_discord_notification_neither_creates_a_dot_nor_blocks_a_dm_read() {
        let mut tracking = Tracking {
            foreground_service: Some("discord".into()),
            presentation_generation: 7,
            ..Default::default()
        };
        let (event, changed) = begin_browser_event(&mut tracking, "discord", true, None, 1, false);
        assert!(!changed);
        assert!(
            event.read > 0,
            "toast routing still has a monotonic event generation"
        );
        assert!(!tracking.observations.contains_key("discord"));
        assert!(!tracking.pending_generations.contains_key("discord"));
        assert!(!tracking.observed_unread_arrivals.contains_key("discord"));
        assert!(!observe_browser_event_with_policy(
            &mut tracking,
            "discord",
            false,
            2,
            true,
            event.read,
            false
        ));
        assert!(!tracking.observations.contains_key("discord"));

        observe_provider(&mut tracking, "discord", true, false, None, &[], false, 3);
        assert!(
            tracking.observations["discord"].has_unread,
            "positive DM DOM remains authoritative"
        );
        let other = begin_event(&mut tracking, "other", true, None);
        latch_arrival(&mut tracking, "other", other, 3);
        observe_provider(
            &mut tracking,
            "discord",
            false,
            true,
            Some(7),
            &[],
            false,
            4,
        );
        assert!(
            tracking.observations["discord"].has_unread,
            "a gesture from before the event is stale"
        );
        let current = tracking.presentation_generation;
        observe_provider(
            &mut tracking,
            "discord",
            false,
            true,
            Some(current),
            &[],
            false,
            5,
        );
        assert!(
            !tracking.observations["discord"].has_unread,
            "unclassified server events cannot block scoped DM zero proof"
        );
        assert!(tracking.observations["other"].has_unread);
        assert!(tracking.pending_generations["other"].contains(&other));
        let (duplicate, changed) =
            begin_browser_event(&mut tracking, "discord", false, Some(event.read), 6, false);
        assert_eq!(duplicate.read, event.read);
        assert!(!changed);
        assert!(!observe_browser_event_with_policy(
            &mut tracking,
            "discord",
            false,
            7,
            false,
            duplicate.read,
            false
        ));
        assert!(!tracking.observations["discord"].has_unread);
        assert!(native_unread_complete(&tracking, "discord"));
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
        assert!(observe_browser_event(
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
        assert!(partial.changed);
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
        assert!(partial.changed);
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
    fn unknown_exact_reads_preserve_pending_overflow_other_arrivals_and_stale_contexts() {
        for guard in [
            "background",
            "stale",
            "other-selected",
            "no-proof",
            "wrong-token",
            "pending",
            "newer-pending",
            "other-arrival",
            "overflow",
        ] {
            let mut tracking = Tracking {
                foreground_service: Some("origin".into()),
                presentation_generation: 7,
                ..Default::default()
            };
            let current = begin_event(&mut tracking, "origin", true, None);
            if guard == "pending" {
                latch_arrival(&mut tracking, "origin", current, 1);
            } else {
                observe_browser_event(&mut tracking, "origin", false, 1, true, current);
            }
            let other = begin_event(&mut tracking, "other", true, None);
            observe_browser_event(&mut tracking, "other", false, 2, true, other);
            let mut arrivals = vec![current];
            let mut foreground = true;
            let mut acknowledgement = Some(7);
            match guard {
                "background" => foreground = false,
                "stale" => acknowledgement = Some(6),
                "other-selected" => tracking.foreground_service = Some("other".into()),
                "no-proof" => arrivals.clear(),
                "wrong-token" => arrivals = vec![other],
                "newer-pending" | "other-arrival" => {
                    let next = begin_event(&mut tracking, "origin", true, None);
                    latch_arrival(&mut tracking, "origin", next, 3);
                    if guard == "other-arrival" {
                        finish_event(&mut tracking, "origin", next, true);
                    }
                }
                "overflow" => {
                    tracking.observed_unread_overflow.insert("origin".into());
                }
                _ => {}
            }
            observe_provider(
                &mut tracking,
                "origin",
                false,
                foreground,
                acknowledgement,
                &arrivals,
                true,
                4,
            );
            assert!(tracking.observations["origin"].has_unread, "{guard}");
            assert!(tracking.observations["other"].has_unread, "{guard}");
            assert!(
                tracking.observed_unread_arrivals["other"].contains(&other),
                "{guard}"
            );
        }
    }

    #[test]
    fn exact_unknown_read_clears_only_its_arrivals_and_duplicate_queries_cannot_restore_them() {
        let mut tracking = Tracking {
            foreground_service: Some("origin".into()),
            presentation_generation: 7,
            ..Default::default()
        };
        let arrival = begin_event(&mut tracking, "origin", true, None);
        observe_browser_event(&mut tracking, "origin", false, 1, true, arrival);
        let read = observe_provider(
            &mut tracking,
            "origin",
            false,
            true,
            Some(7),
            &[arrival],
            true,
            2,
        );
        assert_eq!(read.accepted, [arrival]);
        assert!(!tracking.observations["origin"].has_unread);
        assert_eq!(
            tracking.observations["origin"].certainty,
            Certainty::Unknown
        );
        assert!(!observe_browser_event(
            &mut tracking,
            "origin",
            false,
            3,
            true,
            arrival
        ));
        let duplicate = begin_event(&mut tracking, "origin", false, Some(arrival));
        assert_eq!(duplicate, arrival);
        assert!(!observe_browser_event(
            &mut tracking,
            "origin",
            false,
            4,
            false,
            duplicate
        ));
        assert!(!tracking.observations["origin"].has_unread);
        let next = begin_event(&mut tracking, "origin", true, None);
        observe_browser_event(&mut tracking, "origin", false, 5, true, next);
        observe_provider(
            &mut tracking,
            "origin",
            false,
            true,
            Some(7),
            &[arrival],
            true,
            6,
        );
        assert!(tracking.observations["origin"].has_unread);
        assert!(tracking.observed_unread_arrivals["origin"].contains(&next));
    }

    #[test]
    fn trusted_provider_zero_retires_provider_evidence_without_consuming_pending_arrivals() {
        let mut tracking = Tracking {
            foreground_service: Some("origin".into()),
            presentation_generation: 7,
            ..Default::default()
        };
        observe_provider(&mut tracking, "origin", true, false, None, &[], false, 0);
        let pending = begin_event(&mut tracking, "origin", true, None);
        latch_arrival(&mut tracking, "origin", pending, 1);
        for (foreground, generation) in [(false, Some(7)), (true, Some(6))] {
            observe_provider(
                &mut tracking,
                "origin",
                false,
                foreground,
                generation,
                &[],
                false,
                2,
            );
            assert!(tracking.provider_unread_latched.contains("origin"));
        }
        observe_provider(&mut tracking, "origin", false, true, Some(7), &[], false, 3);
        assert!(!tracking.provider_unread_latched.contains("origin"));
        assert!(tracking.observations["origin"].has_unread);
        assert!(tracking.pending_generations["origin"].contains(&pending));
        finish_event(&mut tracking, "origin", pending, true);
        observe_provider(
            &mut tracking,
            "origin",
            false,
            true,
            Some(7),
            &[pending],
            true,
            4,
        );
        assert!(!tracking.observations["origin"].has_unread);
        assert_eq!(
            tracking.observations["origin"].certainty,
            Certainty::Unknown
        );
    }

    #[test]
    fn unknown_exact_read_clears_arrival_only_but_preserves_positive_provider_evidence() {
        for provider_positive in [false, true] {
            let mut tracking = Tracking {
                foreground_service: Some("origin".into()),
                presentation_generation: 3,
                ..Default::default()
            };
            let arrival = begin_event(&mut tracking, "origin", true, None);
            observe_browser_event(&mut tracking, "origin", false, 1, true, arrival);
            if provider_positive {
                observe_provider(&mut tracking, "origin", true, false, None, &[], false, 1);
            }
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
            assert!(read.changed);
            assert_eq!(
                tracking.observations["origin"].has_unread,
                provider_positive
            );
            assert_eq!(
                tracking.provider_unread_latched.contains("origin"),
                provider_positive
            );
            assert_eq!(
                tracking.observations["origin"].last_update,
                Some(if provider_positive { 1 } else { 3 })
            );
            if !provider_positive {
                assert_eq!(
                    tracking.observations["origin"].certainty,
                    Certainty::Unknown
                );
                assert_eq!(tracking.observations["origin"].total_unread_count, None);
            }
            assert!(tracking.read_generations["origin"].includes(arrival));
            let known_zero =
                observe_provider(&mut tracking, "origin", false, true, Some(3), &[], false, 4);
            assert_eq!(known_zero.changed, provider_positive);
            assert!(!tracking.observations["origin"].has_unread);
            assert!(!tracking.provider_unread_latched.contains("origin"));
        }

        let mut tracking = Tracking {
            foreground_service: Some("empty".into()),
            presentation_generation: 3,
            ..Default::default()
        };
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
