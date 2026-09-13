use crate::{
    build_metadata::{self, BuildMetadata},
    connection::{self, Connection},
    project::{Project, PROJECT},
    state::{self, Settings},
};
use serde::Serialize;

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
