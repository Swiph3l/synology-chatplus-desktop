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
pub struct Service(Mutex<HashMap<String, Unread>>);
pub fn remove(app: &AppHandle, id: &str) {
    app.state::<Service>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(id);
    refresh(app);
}
pub fn observations(app: &AppHandle) -> HashMap<String, Unread> {
    app.state::<Service>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
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
pub fn label(value: &Unread) -> String {
    if value.has_unread {
        "Unread messages".into()
    } else if value.last_update.is_some() {
        "No unread messages".into()
    } else {
        "Unread status unavailable".into()
    }
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
) {
    let service = app.state::<Service>();
    let mut states = service.0.lock().unwrap_or_else(|e| e.into_inner());
    if states
        .get(id)
        .is_some_and(|value| value.has_unread == has_unread)
    {
        return;
    }
    states.insert(
        id.into(),
        Unread {
            has_unread,
            last_update: Some(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            ),
            ..Unread::default()
        },
    );
    drop(states);
    refresh(app);
}
pub fn refresh(app: &AppHandle) {
    let unread = current(app);
    let settings = crate::state::current(app);
    if let Some(window) = app.get_webview_window("main") {
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
}
