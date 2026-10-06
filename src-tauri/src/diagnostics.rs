use crate::{
    build_metadata::{self, BuildMetadata},
    connection::{self, Connection},
    project::{Project, PROJECT},
    state::{self, Settings},
};
use serde::Serialize;
use std::{collections::VecDeque, sync::Mutex};
use tauri::Manager;

const NOTIFICATION_HISTORY_LIMIT: usize = 128;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationEvent {
    NotificationArrival,
    UnreadLatched,
    ReadCandidate,
    ReadAccepted,
    ReadRejected,
    UnreadCleared,
    ToastSubmitted,
    ToastSuppressed,
    ToastActivated,
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationDiagnostic {
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
pub struct NotificationHistory(Mutex<VecDeque<NotificationDiagnostic>>);

fn retain_notification(
    history: &mut VecDeque<NotificationDiagnostic>,
    event: NotificationDiagnostic,
) {
    // Swiph3l: Bug-report diagnostics have a fixed memory bound and typed fields;
    // chat text, provider tags and private URLs cannot enter this history.
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
    let event = NotificationDiagnostic {
        event,
        reason,
        generation,
        service_id: service.id.clone(),
        provider: service.provider,
        native_foreground: crate::window::is_foreground(app),
        selected: settings.active_service.as_deref() == Some(id),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    };
    retain_notification(
        &mut history.0.lock().unwrap_or_else(|error| error.into_inner()),
        event,
    );
}

pub fn report(app: &tauri::AppHandle) -> String {
    let mut report = format(&snapshot(app));
    if let Some(history) = app.try_state::<NotificationHistory>() {
        let history = history.0.lock().unwrap_or_else(|error| error.into_inner());
        report.push_str("\nRecent notification transitions (memory only):\n");
        report.push_str(&serde_json::to_string_pretty(&*history).unwrap_or_default());
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
    #[test]
    fn notification_history_is_bounded_and_contains_only_typed_safe_metadata() {
        let mut history = VecDeque::new();
        for generation in 0..200 {
            retain_notification(
                &mut history,
                NotificationDiagnostic {
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
        assert_eq!(json.as_object().unwrap().len(), 8);
        for forbidden in ["title", "body", "tag", "url", "token", "credentials"] {
            assert!(json.get(forbidden).is_none());
        }
        assert_eq!(json["reason"], "stale_or_background");
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
