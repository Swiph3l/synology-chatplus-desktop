//! Central unread model. Sources publish observations; focus never marks messages read.
use serde::Serialize;
use std::{
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Source {
    ChatPlusDom,
    TitleFallback,
}

impl Source {
    fn rank(self) -> u8 {
        match self {
            Self::ChatPlusDom => 2,
            Self::TitleFallback => 1,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::ChatPlusDom => "chatplus-dom",
            Self::TitleFallback => "title-fallback",
        }
    }
}

fn accepts_source(previous_rank: u8, source: Source) -> bool {
    source.rank() >= previous_rank
}

#[derive(Clone, Default, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Unread {
    pub total_unread_count: Option<u32>,
    pub has_unread: bool,
    pub mention_count: Option<u32>,
    pub last_update: Option<u64>,
}

struct State {
    unread: Unread,
    source_rank: u8,
}

impl Default for State {
    fn default() -> Self {
        Self {
            unread: Unread::default(),
            source_rank: 0,
        }
    }
}

#[derive(Default)]
pub struct Service(Mutex<State>);

pub fn current(app: &AppHandle) -> Unread {
    app.state::<Service>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .unread
        .clone()
}
pub fn label(value: &Unread) -> String {
    match value.total_unread_count {
        Some(n) if n > 99 => "99+ unread messages".into(),
        Some(n) => format!("{n} unread messages"),
        None if value.has_unread => "Unread messages".into(),
        None if value.last_update.is_some() => "No unread messages".into(),
        None => "Unread status unavailable".into(),
    }
}
pub fn title(value: &Unread, enabled: bool) -> String {
    if !enabled || !value.has_unread {
        return "ChatPlus Desktop".into();
    }
    match value.total_unread_count {
        Some(count) => format!("ChatPlus Desktop ({count})"),
        None => "ChatPlus Desktop •".into(),
    }
}

pub fn publish_from(
    app: &AppHandle,
    count: Option<u32>,
    has_unread: bool,
    source: Source,
    reason: &str,
) {
    let service = app.state::<Service>();
    let mut state = service.0.lock().unwrap_or_else(|e| e.into_inner());
    let count = count.map(|n| n.min(1_000_000));
    let has_unread = count.map(|n| n > 0).unwrap_or(has_unread);
    if state.unread.last_update.is_some() && !accepts_source(state.source_rank, source) {
        return;
    }
    if state.unread.last_update.is_some()
        && state.unread.total_unread_count == count
        && state.unread.has_unread == has_unread
    {
        return;
    }
    println!(
        "unread: source={} previous={} next={} reason={}",
        source.label(),
        state
            .unread
            .total_unread_count
            .map(|n| n.to_string())
            .unwrap_or_else(|| {
                if state.unread.has_unread {
                    "dot".into()
                } else {
                    "0".into()
                }
            }),
        count.map(|n| n.to_string()).unwrap_or_else(|| {
            if has_unread {
                "dot".into()
            } else {
                "0".into()
            }
        }),
        reason,
    );
    state.unread = Unread {
        total_unread_count: count,
        has_unread,
        mention_count: None,
        last_update: Some(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        ),
    };
    state.source_rank = source.rank();
    drop(state);
    refresh(app);
}
pub fn refresh(app: &AppHandle) {
    let unread = current(app);
    let settings = crate::state::current(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title(&title(&unread, settings.unread_title));
        crate::desktop_notifications::taskbar(&window, &unread);
    }
    crate::tray::refresh(app);
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn titles_distinguish_exact_boolean_and_disabled_states() {
        let mut value = Unread::default();
        assert_eq!(title(&value, true), "ChatPlus Desktop");
        value.has_unread = true;
        assert_eq!(title(&value, true), "ChatPlus Desktop •");
        value.total_unread_count = Some(4);
        assert_eq!(title(&value, true), "ChatPlus Desktop (4)");
        assert_eq!(title(&value, false), "ChatPlus Desktop");
        value.total_unread_count = Some(120);
        assert_eq!(label(&value), "99+ unread messages");
    }

    #[test]
    fn source_priority_prefers_dom_over_title_fallback() {
        assert!(accepts_source(0, Source::TitleFallback));
        assert!(accepts_source(1, Source::TitleFallback));
        assert!(accepts_source(1, Source::ChatPlusDom));
        assert!(!accepts_source(2, Source::TitleFallback));
    }
}
