use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
/// Connected describes document transport, not authentication or server health.
#[allow(dead_code)]
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Connection {
    #[default]
    Unknown,
    Connecting,
    Connected,
    Offline,
    Error,
}
impl Connection {
    pub fn label(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Connecting => "connecting",
            Self::Connected => "connected",
            Self::Offline => "offline",
            Self::Error => "error",
        }
    }
}
#[derive(Default)]
pub struct ConnectionState(pub Mutex<Connection>);
pub fn current(app: &AppHandle) -> Connection {
    *app.state::<ConnectionState>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}
pub fn set(app: &AppHandle, value: Connection) {
    *app.state::<ConnectionState>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = value;
    crate::tray::refresh(app);
    let _ = app.emit_to("about", "connection-changed", value);
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn labels_are_fixed_and_contain_no_server_details() {
        for (state, label) in [
            (Connection::Unknown, "unknown"),
            (Connection::Connecting, "connecting"),
            (Connection::Connected, "connected"),
            (Connection::Offline, "offline"),
            (Connection::Error, "error"),
        ] {
            assert_eq!(state.label(), label);
            assert_eq!(
                serde_json::to_string(&state).unwrap(),
                format!("\"{label}\"")
            );
        }
    }
}
