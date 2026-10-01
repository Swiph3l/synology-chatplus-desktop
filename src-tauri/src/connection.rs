use std::{collections::HashMap, sync::Mutex};
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
pub struct ConnectionState(pub Mutex<HashMap<String, Connection>>);
fn selected(states: &HashMap<String, Connection>, id: Option<&str>) -> Connection {
    id.and_then(|id| states.get(id))
        .copied()
        .unwrap_or_default()
}
pub fn current(app: &AppHandle) -> Connection {
    let settings = crate::state::current(app);
    selected(
        &app.state::<ConnectionState>()
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner()),
        settings.active_service.as_deref(),
    )
}
pub fn set_for(app: &AppHandle, id: &str, value: Connection) {
    app.state::<ConnectionState>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(id.into(), value);
    if crate::state::current(app).active_service.as_deref() == Some(id) {
        refresh(app);
    }
}
pub fn refresh(app: &AppHandle) {
    crate::tray::refresh(app);
    let _ = app.emit_to("about", "connection-changed", current(app));
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn switching_selects_own_cached_transport_state() {
        let states = HashMap::from([
            ("a".into(), Connection::Connected),
            ("b".into(), Connection::Offline),
        ]);
        assert_eq!(selected(&states, Some("a")), Connection::Connected);
        assert_eq!(selected(&states, Some("b")), Connection::Offline);
        assert_eq!(selected(&states, Some("unopened")), Connection::Unknown);
        assert_eq!(selected(&states, None), Connection::Unknown);
    }
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
