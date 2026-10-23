use crate::{
    build_metadata::{self, BuildMetadata},
    connection::{self, Connection},
    project::{Project, PROJECT},
    state::{self, Settings},
};
use serde::Serialize;
use std::{
    collections::VecDeque,
    fs::{File, OpenOptions},
    io::{self, Write},
    path::Path,
    sync::{
        atomic::{AtomicU64, AtomicU8, Ordering},
        mpsc::{self, Receiver, SyncSender, TrySendError},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const NOTIFICATION_HISTORY_LIMIT: usize = 128;
const CAPTURE_QUEUE_LIMIT: usize = 256;
const CAPTURE_RECORD_LIMIT: u64 = 8_192;
const CAPTURE_BYTE_LIMIT: u64 = 4 * 1024 * 1024;
const CAPTURE_STOP_RESERVE: u64 = 512;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationEvent {
    Detected,
    Normalized,
    DuplicateSuppressed,
    NotificationArrival,
    UnreadLatched,
    ReadCandidate,
    ReadAccepted,
    ReadRejected,
    UnreadCleared,
    ToastSubmitted,
    ToastSuppressed,
    ToastActivated,
    ProviderActivated,
    PermissionChecked,
    BridgeStatus,
    ViewingChecked,
    ToastDismissed,
    StatusSnapshot,
    ProviderPermissionChecked,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationReason {
    BrowserEvent,
    ProviderObservation,
    ProviderZero,
    ExactArrival,
    StaleOrBackground,
    UnprovenArrival,
    ServiceMuted,
    GlobalDisabled,
    PermissionDenied,
    ConversationViewed,
    DuplicateEvent,
    SubmitFailed,
    NativeSubmission,
    ExistingWindow,
    UnchangedState,
    ProviderSilent,
    ProviderActivation,
    ActivationUnavailable,
    ActivationFailed,
    ExplicitLocalAcknowledgement,
    NativePermissionEnabled,
    NativePermissionBlocked,
    NativePermissionUnavailable,
    FrontendPermissionMismatch,
    ProviderOriginGranted,
    ProviderPermissionRefreshRequired,
    BridgeAttached,
    BridgeUnsupported,
    BridgeUnavailable,
    BridgeRegistrationFailed,
    ViewingQueryTimeout,
    ViewingQueryFailed,
    ViewingQueryUnavailable,
    ViewingQueryUnproven,
    TestSubmission,
    TestSubmissionFailed,
    DismissedByUser,
    DismissedByApplication,
    DismissedTimedOut,
    DismissalUnknown,
    NativePermissionNotRegistered,
    GlobalEnabled,
    ServiceEnabled,
    ServiceDisabled,
    ServiceNotificationsEnabled,
    SourceRejected,
    UnreadBridgeRegistrationFailed,
    BridgeEventFailed,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationDiagnostic {
    ordinal: u64,
    event: NotificationEvent,
    service_id: String,
    provider: crate::providers::ProviderId,
    native_foreground: bool,
    selected: bool,
    generation: u64,
    reason: NotificationReason,
    timestamp: u64,
}

#[derive(Default)]
pub struct NotificationHistory(Mutex<NotificationHistoryState>);

#[derive(Default)]
struct NotificationHistoryState {
    events: VecDeque<NotificationDiagnostic>,
    ordinal: u64,
    capture: Option<NotificationCapture>,
    capture_status: Option<Arc<CaptureStatus>>,
}

struct NotificationCapture {
    sender: SyncSender<NotificationDiagnostic>,
    finished: Receiver<()>,
}

#[derive(Clone, Copy)]
#[repr(u8)]
enum CapturePhase {
    Starting,
    Active,
    Closed,
    RecordLimit,
    ByteLimit,
    Failed,
}

impl CapturePhase {
    fn label(value: u8) -> &'static str {
        match value {
            value if value == Self::Starting as u8 => "starting",
            value if value == Self::Active as u8 => "active",
            value if value == Self::Closed as u8 => "closed",
            value if value == Self::RecordLimit as u8 => "record limit reached",
            value if value == Self::ByteLimit as u8 => "byte limit reached",
            _ => "failed",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
enum CaptureFailure {
    None,
    CreateDirectory,
    FileExists,
    Open,
    Serialize,
    Write,
    Flush,
    Spawn,
    WorkerStopped,
}

impl CaptureFailure {
    fn label(value: u8) -> &'static str {
        match value {
            value if value == Self::None as u8 => "none",
            value if value == Self::CreateDirectory as u8 => "cannot create capture directory",
            value if value == Self::FileExists as u8 => "capture file already exists",
            value if value == Self::Open as u8 => "cannot create capture file",
            value if value == Self::Serialize as u8 => "cannot encode capture record",
            value if value == Self::Write as u8 => "cannot write capture record",
            value if value == Self::Flush as u8 => "cannot flush capture record",
            value if value == Self::Spawn as u8 => "cannot start capture writer",
            _ => "capture writer stopped unexpectedly",
        }
    }
}

struct CaptureStatus {
    phase: AtomicU8,
    failure: AtomicU8,
    observed: AtomicU64,
    written: AtomicU64,
    bytes: AtomicU64,
    queue_dropped: AtomicU64,
}

impl Default for CaptureStatus {
    fn default() -> Self {
        Self {
            phase: AtomicU8::new(CapturePhase::Starting as u8),
            failure: AtomicU8::new(CaptureFailure::None as u8),
            observed: AtomicU64::new(0),
            written: AtomicU64::new(0),
            bytes: AtomicU64::new(0),
            queue_dropped: AtomicU64::new(0),
        }
    }
}

impl CaptureStatus {
    fn fail(&self, failure: CaptureFailure) {
        self.failure.store(failure as u8, Ordering::Relaxed);
        self.phase
            .store(CapturePhase::Failed as u8, Ordering::Release);
    }

    fn accepting(&self) -> bool {
        matches!(
            self.phase.load(Ordering::Acquire),
            value if value == CapturePhase::Starting as u8 || value == CapturePhase::Active as u8
        )
    }

    fn summary(&self) -> String {
        format!(
            "Notification capture: {}; failure: {}; events observed: {}; events written: {}; queue drops: {}; bytes written: {}",
            CapturePhase::label(self.phase.load(Ordering::Acquire)),
            CaptureFailure::label(self.failure.load(Ordering::Relaxed)),
            self.observed.load(Ordering::Relaxed),
            self.written.load(Ordering::Relaxed),
            self.queue_dropped.load(Ordering::Relaxed),
            self.bytes.load(Ordering::Relaxed),
        )
    }
}

#[derive(Clone, Copy)]
struct CaptureLimits {
    records: u64,
    bytes: u64,
}

impl Default for CaptureLimits {
    fn default() -> Self {
        Self {
            records: CAPTURE_RECORD_LIMIT,
            bytes: CAPTURE_BYTE_LIMIT,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureStarted {
    record_type: &'static str,
    schema_version: u8,
    timestamp: u64,
    app_version: &'static str,
    build_mode: &'static str,
    build_commit: Option<String>,
    diagnostics_feature: bool,
    max_records: u64,
    max_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureNotification<'a> {
    record_type: &'static str,
    #[serde(flatten)]
    event: &'a NotificationDiagnostic,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum CaptureStopReason {
    Closed,
    RecordLimit,
    ByteLimit,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureStopped {
    record_type: &'static str,
    reason: CaptureStopReason,
    timestamp: u64,
    records_before_stop: u64,
    bytes_before_stop: u64,
    events_observed: u64,
    queue_dropped: u64,
}

fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn capture_started(limits: CaptureLimits) -> CaptureStarted {
    CaptureStarted {
        record_type: "capture_started",
        schema_version: 1,
        timestamp: timestamp(),
        app_version: env!("CARGO_PKG_VERSION"),
        build_mode: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        build_commit: build_metadata::current().git_commit_full.filter(|value| {
            matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        }),
        diagnostics_feature: cfg!(feature = "notification-diagnostics"),
        max_records: limits.records,
        max_bytes: limits.bytes,
    }
}

fn json_line(value: &impl Serialize) -> Result<Vec<u8>, CaptureFailure> {
    let mut bytes = serde_json::to_vec(value).map_err(|_| CaptureFailure::Serialize)?;
    bytes.push(b'\n');
    Ok(bytes)
}

struct CaptureWriter<W> {
    writer: W,
    status: Arc<CaptureStatus>,
    limits: CaptureLimits,
    records: u64,
    bytes: u64,
}

impl<W: Write> CaptureWriter<W> {
    fn new(
        writer: W,
        status: Arc<CaptureStatus>,
        limits: CaptureLimits,
    ) -> Result<Self, CaptureFailure> {
        let header = json_line(&capture_started(limits))?;
        if limits.records < 2 || header.len() as u64 + CAPTURE_STOP_RESERVE > limits.bytes {
            return Err(CaptureFailure::Serialize);
        }
        let mut capture = Self {
            writer,
            status,
            limits,
            records: 0,
            bytes: 0,
        };
        capture.write_line(&header)?;
        capture
            .status
            .phase
            .store(CapturePhase::Active as u8, Ordering::Release);
        Ok(capture)
    }

    fn write_line(&mut self, bytes: &[u8]) -> Result<(), CaptureFailure> {
        self.writer
            .write_all(bytes)
            .map_err(|_| CaptureFailure::Write)?;
        self.writer.flush().map_err(|_| CaptureFailure::Flush)?;
        self.records += 1;
        self.bytes += bytes.len() as u64;
        self.status.bytes.store(self.bytes, Ordering::Relaxed);
        Ok(())
    }

    fn notification(&mut self, event: &NotificationDiagnostic) -> Result<bool, CaptureFailure> {
        // Swiph3l: Reserve both one row and fixed bytes for a terminal marker;
        // the capture cannot silently grow beyond either advertised disk bound.
        if self.records >= self.limits.records - 1 {
            self.finish(CaptureStopReason::RecordLimit)?;
            return Ok(false);
        }
        let bytes = json_line(&CaptureNotification {
            record_type: "notification",
            event,
        })?;
        if self.bytes + bytes.len() as u64 + CAPTURE_STOP_RESERVE > self.limits.bytes {
            self.finish(CaptureStopReason::ByteLimit)?;
            return Ok(false);
        }
        self.write_line(&bytes)?;
        self.status.written.fetch_add(1, Ordering::Relaxed);
        Ok(true)
    }

    fn finish(&mut self, reason: CaptureStopReason) -> Result<(), CaptureFailure> {
        let bytes = json_line(&CaptureStopped {
            record_type: "capture_stopped",
            reason,
            timestamp: timestamp(),
            records_before_stop: self.records,
            bytes_before_stop: self.bytes,
            events_observed: self.status.observed.load(Ordering::Relaxed),
            queue_dropped: self.status.queue_dropped.load(Ordering::Relaxed),
        })?;
        if bytes.len() as u64 > CAPTURE_STOP_RESERVE
            || self.bytes + bytes.len() as u64 > self.limits.bytes
            || self.records >= self.limits.records
        {
            return Err(CaptureFailure::Serialize);
        }
        self.write_line(&bytes)?;
        let phase = match reason {
            CaptureStopReason::Closed => CapturePhase::Closed,
            CaptureStopReason::RecordLimit => CapturePhase::RecordLimit,
            CaptureStopReason::ByteLimit => CapturePhase::ByteLimit,
        };
        self.status.phase.store(phase as u8, Ordering::Release);
        Ok(())
    }
}

fn create_capture_file(path: &Path) -> Result<File, CaptureFailure> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| CaptureFailure::CreateDirectory)?;
    }
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                CaptureFailure::FileExists
            } else {
                CaptureFailure::Open
            }
        })
}

fn capture_worker(
    path: &Path,
    receiver: Receiver<NotificationDiagnostic>,
    status: Arc<CaptureStatus>,
) -> Result<(), CaptureFailure> {
    let file = create_capture_file(path)?;
    let mut writer = CaptureWriter::new(file, status, CaptureLimits::default())?;
    while let Ok(event) = receiver.recv() {
        if !writer.notification(&event)? {
            return Ok(());
        }
    }
    writer.finish(CaptureStopReason::Closed)
}

pub fn start_notification_capture(app: &tauri::AppHandle, path: &Path) -> Result<(), &'static str> {
    if !cfg!(feature = "notification-diagnostics") {
        return Err("Notification disk capture is disabled in this build.");
    }
    if !path.is_absolute() || path.file_name().is_none() {
        return Err("Notification capture requires an absolute file path.");
    }
    let Some(history) = app.try_state::<NotificationHistory>() else {
        return Err("Notification history is unavailable.");
    };
    let mut history = history.0.lock().unwrap_or_else(|error| error.into_inner());
    if history.capture_status.is_some() {
        return Err("Notification capture has already been started.");
    }
    let status = Arc::new(CaptureStatus::default());
    history.capture_status = Some(status.clone());
    let (sender, receiver) = mpsc::sync_channel(CAPTURE_QUEUE_LIMIT);
    let (finished_sender, finished) = mpsc::channel();
    let worker_status = status.clone();
    let path = path.to_path_buf();
    // Swiph3l: Optional capture only serializes the typed allowlist. Producers
    // never perform filesystem IO or wait for a full queue on the WebView thread.
    if std::thread::Builder::new()
        .name("notification-diagnostics".into())
        .spawn(move || {
            if let Err(failure) = capture_worker(&path, receiver, worker_status.clone()) {
                worker_status.fail(failure);
            }
            let _ = finished_sender.send(());
        })
        .is_err()
    {
        status.fail(CaptureFailure::Spawn);
        return Err("Cannot start notification capture writer.");
    }
    history.capture = Some(NotificationCapture { sender, finished });
    Ok(())
}

pub fn stop_notification_capture(app: &tauri::AppHandle) -> Result<(), &'static str> {
    let Some(history) = app.try_state::<NotificationHistory>() else {
        return Ok(());
    };
    let capture = history
        .0
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .capture
        .take();
    let Some(NotificationCapture { sender, finished }) = capture else {
        return Ok(());
    };
    drop(sender);
    // Swiph3l: Actual exit permits a short drain, never an unbounded join on a
    // slow or unavailable disk; every successfully written row was already flushed.
    finished
        .recv_timeout(Duration::from_millis(500))
        .map_err(|_| "Notification capture did not finish within the shutdown deadline.")
}

fn enqueue_capture(
    capture: &NotificationCapture,
    status: &CaptureStatus,
    event: NotificationDiagnostic,
) {
    status.observed.fetch_add(1, Ordering::Relaxed);
    if !status.accepting() {
        return;
    }
    match capture.sender.try_send(event) {
        Ok(()) => {}
        Err(TrySendError::Full(_)) => {
            status.queue_dropped.fetch_add(1, Ordering::Relaxed);
        }
        Err(TrySendError::Disconnected(_)) => {
            if status.accepting() {
                status.fail(CaptureFailure::WorkerStopped);
            }
        }
    }
}

fn retain_notification(
    history: &mut VecDeque<NotificationDiagnostic>,
    event: NotificationDiagnostic,
) {
    // Swiph3l: Diagnostics have a fixed memory bound and typed fields; the same
    // allowlist backs optional disk capture without chat text, tags or private URLs.
    if history.len() == NOTIFICATION_HISTORY_LIMIT {
        history.pop_front();
    }
    history.push_back(event);
}

pub fn notification(
    app: &tauri::AppHandle,
    id: &str,
    event: NotificationEvent,
    reason: NotificationReason,
    generation: u64,
) {
    let settings = state::current(app);
    let Some(service) = settings.services.iter().find(|service| service.id == id) else {
        return;
    };
    let Some(history) = app.try_state::<NotificationHistory>() else {
        return;
    };
    let mut event = NotificationDiagnostic {
        ordinal: 0,
        event,
        reason,
        generation,
        service_id: service.id.clone(),
        provider: service.provider,
        native_foreground: crate::window::is_foreground(app),
        selected: settings.active_service.as_deref() == Some(id),
        timestamp: timestamp(),
    };
    let mut history = history.0.lock().unwrap_or_else(|error| error.into_inner());
    history.ordinal = history.ordinal.saturating_add(1);
    event.ordinal = history.ordinal;
    if let (Some(capture), Some(status)) = (&history.capture, &history.capture_status) {
        enqueue_capture(capture, status, event.clone());
    }
    retain_notification(&mut history.events, event);
}

pub fn report(app: &tauri::AppHandle) -> String {
    let mut report = format(&snapshot(app));
    if let Some(history) = app.try_state::<NotificationHistory>() {
        let history = history.0.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(status) = &history.capture_status {
            report.push('\n');
            report.push_str(&status.summary());
        }
        report.push_str("\nRecent notification transitions (bounded memory):\n");
        report.push_str(&serde_json::to_string_pretty(&history.events).unwrap_or_default());
    }
    report
}

#[derive(Serialize)]
pub struct RuntimeInfo {
    pub os: String,
    pub architecture: String,
    pub tauri_version: String,
    pub webview_version: String,
}
#[derive(Serialize)]
pub struct AboutInfo {
    pub project: Project,
    pub build: BuildMetadata,
    pub runtime: RuntimeInfo,
    pub theme: String,
    pub server_configured: bool,
    pub connection_state: Connection,
}
pub fn snapshot(app: &tauri::AppHandle) -> AboutInfo {
    from_settings(
        build_metadata::current(),
        RuntimeInfo {
            os: std::env::consts::OS.into(),
            architecture: std::env::consts::ARCH.into(),
            tauri_version: tauri::VERSION.into(),
            webview_version: tauri::webview_version().unwrap_or_else(|_| "Unavailable".into()),
        },
        &state::current(app),
        connection::current(app),
    )
}
fn from_settings(
    build: BuildMetadata,
    runtime: RuntimeInfo,
    settings: &Settings,
    connection_state: Connection,
) -> AboutInfo {
    AboutInfo {
        project: PROJECT,
        build,
        runtime,
        theme: settings.theme.label().into(),
        server_configured: !settings.server_url.is_empty(),
        connection_state,
    }
}
fn safe(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_control())
        .take(160)
        .collect()
}
fn available(value: Option<&str>) -> String {
    value.map(safe).unwrap_or_else(|| "Unavailable".into())
}
fn yes_no(value: bool) -> &'static str {
    if value {
        "Yes"
    } else {
        "No"
    }
}
pub fn format(info: &AboutInfo) -> String {
    let b = &info.build;
    let r = &info.runtime;
    [
        "ChatPlus Desktop Diagnostics".into(),
        format!("Version: {}", safe(&b.display_version)),
        format!("Build date: {}", safe(&b.build_date_utc)),
        format!("Commit: {}", available(b.git_commit_full.as_deref())),
        format!("Branch: {}", available(b.git_branch.as_deref())),
        format!("Tag: {}", available(b.git_tag.as_deref())),
        format!("Channel: {}", safe(&b.build_channel)),
        format!(
            "Dirty working tree: {}",
            b.is_dirty.map(yes_no).unwrap_or("Unavailable")
        ),
        format!("OS: {}", safe(&r.os)),
        format!("Architecture: {}", safe(&r.architecture)),
        format!("Tauri: {}", safe(&r.tauri_version)),
        format!("Rust: {}", available(b.rust_version.as_deref())),
        format!("WebView: {}", safe(&r.webview_version)),
        format!("Theme: {}", safe(&info.theme)),
        format!("Server configured: {}", yes_no(info.server_configured)),
        format!("Connection state: {}", info.connection_state.label()),
    ]
    .join("\n")
}
#[cfg(test)]
mod tests {
    use super::*;

    fn diagnostic(ordinal: u64) -> NotificationDiagnostic {
        NotificationDiagnostic {
            ordinal,
            event: NotificationEvent::ReadRejected,
            service_id: "primary".into(),
            provider: crate::providers::ProviderId::Discord,
            native_foreground: false,
            selected: true,
            generation: ordinal,
            reason: NotificationReason::StaleOrBackground,
            timestamp: ordinal,
        }
    }

    fn lines(bytes: &[u8]) -> Vec<serde_json::Value> {
        String::from_utf8(bytes.to_vec())
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    fn temporary_capture_path() -> std::path::PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "chatplus-notification-capture-{}-{}-{}.jsonl",
            std::process::id(),
            timestamp(),
            NEXT.fetch_add(1, Ordering::Relaxed),
        ))
    }

    #[test]
    fn notification_history_is_bounded_and_contains_only_typed_safe_metadata() {
        let mut history = VecDeque::new();
        for generation in 0..200 {
            retain_notification(
                &mut history,
                NotificationDiagnostic {
                    ordinal: generation,
                    event: NotificationEvent::ReadRejected,
                    service_id: "primary".into(),
                    provider: crate::providers::ProviderId::Discord,
                    native_foreground: false,
                    selected: true,
                    generation,
                    reason: NotificationReason::StaleOrBackground,
                    timestamp: generation,
                },
            );
        }
        assert_eq!(history.len(), NOTIFICATION_HISTORY_LIMIT);
        assert_eq!(history.front().unwrap().generation, 72);
        let json = serde_json::to_value(&history[0]).unwrap();
        assert_eq!(json.as_object().unwrap().len(), 9);
        for forbidden in ["title", "body", "tag", "url", "token", "credentials"] {
            assert!(json.get(forbidden).is_none());
        }
        assert_eq!(json["reason"], "stale_or_background");
    }

    #[test]
    fn capture_has_allowlisted_metadata_and_preserves_event_identity() {
        let status = Arc::new(CaptureStatus::default());
        status.observed.store(1, Ordering::Relaxed);
        let mut writer = CaptureWriter::new(Vec::new(), status, CaptureLimits::default()).unwrap();
        assert!(writer.notification(&diagnostic(7)).unwrap());
        writer.finish(CaptureStopReason::Closed).unwrap();
        let rows = lines(&writer.writer);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0]["recordType"], "capture_started");
        assert_eq!(rows[0]["schemaVersion"], 1);
        assert_eq!(rows[0]["appVersion"], env!("CARGO_PKG_VERSION"));
        assert!(rows[0]["timestamp"].as_u64().unwrap() > 0);
        assert_eq!(rows[0].as_object().unwrap().len(), 9);
        assert_eq!(rows[1]["recordType"], "notification");
        assert_eq!(rows[1]["ordinal"], 7);
        assert_eq!(rows[1]["generation"], 7);
        assert_eq!(rows[1]["provider"], "discord");
        assert_eq!(rows[1]["serviceId"], "primary");
        assert_eq!(rows[1]["reason"], "stale_or_background");
        assert_eq!(rows[1].as_object().unwrap().len(), 10);
        assert_eq!(rows[2]["recordType"], "capture_stopped");
        assert_eq!(rows[2]["reason"], "closed");
        for row in rows {
            for forbidden in [
                "title", "body", "contact", "tag", "url", "path", "token", "settings", "error",
                "branch",
            ] {
                assert!(row.get(forbidden).is_none());
            }
        }
    }

    #[test]
    fn capture_record_cap_includes_the_header_and_terminal_marker() {
        let limits = CaptureLimits {
            records: 4,
            bytes: 8_192,
        };
        let status = Arc::new(CaptureStatus::default());
        let mut writer = CaptureWriter::new(Vec::new(), status.clone(), limits).unwrap();
        for ordinal in 1..10 {
            if !writer.notification(&diagnostic(ordinal)).unwrap() {
                break;
            }
        }
        let rows = lines(&writer.writer);
        assert_eq!(rows.len(), limits.records as usize);
        assert_eq!(rows.last().unwrap()["reason"], "record_limit");
        assert_eq!(status.written.load(Ordering::Relaxed), 2);
        assert_eq!(
            status.phase.load(Ordering::Acquire),
            CapturePhase::RecordLimit as u8
        );
        assert!(writer.writer.len() as u64 <= limits.bytes);
    }

    #[test]
    fn capture_byte_cap_reserves_a_complete_terminal_marker() {
        let limits = CaptureLimits {
            records: 100,
            bytes: 1_000,
        };
        let status = Arc::new(CaptureStatus::default());
        let mut writer = CaptureWriter::new(Vec::new(), status.clone(), limits).unwrap();
        for ordinal in 1..100 {
            if !writer.notification(&diagnostic(ordinal)).unwrap() {
                break;
            }
        }
        let rows = lines(&writer.writer);
        assert!(writer.writer.len() as u64 <= limits.bytes);
        assert!(rows.len() as u64 <= limits.records);
        assert_eq!(rows.last().unwrap()["reason"], "byte_limit");
        assert_eq!(
            status.phase.load(Ordering::Acquire),
            CapturePhase::ByteLimit as u8
        );
        assert_eq!(writer.writer.last(), Some(&b'\n'));
    }

    #[test]
    fn a_full_capture_queue_drops_without_waiting_or_losing_memory_history() {
        let (sender, receiver) = mpsc::sync_channel(1);
        let (_, finished) = mpsc::channel();
        let capture = NotificationCapture { sender, finished };
        let status = CaptureStatus::default();
        let mut history = VecDeque::new();
        for ordinal in 1..=3 {
            let event = diagnostic(ordinal);
            enqueue_capture(&capture, &status, event.clone());
            retain_notification(&mut history, event);
        }
        assert_eq!(status.observed.load(Ordering::Relaxed), 3);
        assert_eq!(status.queue_dropped.load(Ordering::Relaxed), 2);
        assert_eq!(receiver.try_recv().unwrap().ordinal, 1);
        assert_eq!(history.len(), 3);
        assert_eq!(history.back().unwrap().ordinal, 3);
    }

    #[test]
    fn capture_file_creation_never_overwrites_an_existing_file() {
        let path = temporary_capture_path();
        std::fs::write(&path, b"existing fixture").unwrap();
        assert_eq!(
            create_capture_file(&path).unwrap_err(),
            CaptureFailure::FileExists
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"existing fixture");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn capture_worker_writes_a_header_without_events_and_drains_on_close() {
        for count in [0, 2] {
            let path = temporary_capture_path();
            let (sender, receiver) = mpsc::sync_channel(4);
            for ordinal in 1..=count {
                sender.send(diagnostic(ordinal)).unwrap();
            }
            drop(sender);
            let status = Arc::new(CaptureStatus::default());
            capture_worker(&path, receiver, status.clone()).unwrap();
            let rows = lines(&std::fs::read(&path).unwrap());
            assert_eq!(rows.len(), count as usize + 2);
            assert_eq!(rows[0]["recordType"], "capture_started");
            assert_eq!(rows.last().unwrap()["reason"], "closed");
            assert_eq!(status.written.load(Ordering::Relaxed), count);
            std::fs::remove_file(path).unwrap();
        }
    }

    #[test]
    fn capture_io_failures_expose_only_fixed_error_labels() {
        struct FailedWriter;
        impl Write for FailedWriter {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::Error::other("private raw OS error fixture"))
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let status = Arc::new(CaptureStatus::default());
        let failure =
            match CaptureWriter::new(FailedWriter, status.clone(), CaptureLimits::default()) {
                Ok(_) => panic!("the writer must fail"),
                Err(failure) => failure,
            };
        assert_eq!(failure, CaptureFailure::Write);
        status.fail(failure);
        let summary = status.summary();
        assert!(summary.contains("cannot write capture record"));
        assert!(!summary.contains("private"));
        assert!(!summary.contains("raw OS"));
    }
    #[test]
    fn diagnostics_are_an_allowlist_not_a_settings_dump() {
        let settings = Settings {
            server_url: "https://private.example.invalid/chat/".into(),
            ..Settings::default()
        };
        let info = from_settings(
            build_metadata::current(),
            RuntimeInfo {
                os: "test".into(),
                architecture: "test".into(),
                tauri_version: "test".into(),
                webview_version: "Unavailable".into(),
            },
            &settings,
            Connection::Unknown,
        );
        let text = format(&info);
        let json = serde_json::to_string(&info).unwrap();
        for data in [&text, &json] {
            assert!(!data.contains(&settings.server_url));
            assert!(!data.contains("private.example.invalid"));
            assert!(!data.contains("server_url"));
        }
        assert!(text.contains("Server configured: Yes"));
        assert!(text.contains("Connection state: unknown"));
        assert_eq!(text, format(&info));
        assert_eq!(safe("branch\n\r\tname"), "branchname");
    }
}
