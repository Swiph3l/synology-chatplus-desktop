use crate::{
    connection,
    menu::{self, Action},
};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
struct TrayState {
    status: MenuItem<tauri::Wry>,
    unread: MenuItem<tauri::Wry>,
    actions: Vec<(MenuItem<tauri::Wry>, &'static str)>,
    applied: Mutex<Presentation>,
}
#[derive(Default)]
struct Presentation {
    status: Option<String>,
    unread: Option<String>,
    actions: Vec<Option<String>>,
    tooltip: Option<String>,
    unread_icon: Option<bool>,
}
fn apply_changed<T: PartialEq, E>(
    previous: &mut Option<T>,
    value: T,
    apply: impl FnOnce(&T) -> Result<(), E>,
) {
    // Swiph3l: Unread evidence can change without changing any tray pixels.
    // Cache only successful native writes so a failed update is retried.
    if previous.as_ref() != Some(&value) && apply(&value).is_ok() {
        *previous = Some(value);
    }
}
pub fn refresh(app: &AppHandle) {
    let handle = app.clone();
    let _ =
        app.run_on_main_thread(move || refresh_unread(&handle, &crate::unread::current(&handle)));
}
pub fn refresh_unread(app: &AppHandle, unread: &crate::unread::Unread) {
    if let Some(state) = app.try_state::<TrayState>() {
        let settings = crate::state::current(app);
        let text = |key| crate::i18n::text(&settings.language, key);
        let connection_key = match connection::for_service(app, settings.active_service.as_deref())
        {
            connection::Connection::Unknown => "common.unknown",
            connection::Connection::Connecting => "common.connecting",
            connection::Connection::Connected => "common.connected",
            connection::Connection::Offline => "common.offline",
            connection::Connection::Error => "common.error",
        };
        let label = text("tray.connection").replace("{state}", &text(connection_key));
        let enabled = settings.unread_tray;
        let unread_label = if enabled {
            text(if unread.has_unread {
                "tray.unread"
            } else if unread.last_update.is_some() {
                "tray.noUnread"
            } else {
                "tray.unreadUnavailable"
            })
        } else {
            text("tray.unreadDisabled")
        };
        let tooltip = format!("ChatPlus Desktop\n{unread_label}\n{label}");
        let mut applied = state.applied.lock().unwrap_or_else(|e| e.into_inner());
        apply_changed(&mut applied.status, label, |value| {
            state.status.set_text(value)
        });
        apply_changed(&mut applied.unread, unread_label, |value| {
            state.unread.set_text(value)
        });
        // Swiph3l: Keep native menu objects alive during language changes; rebuilding
        // the Windows tray menu can disrupt an open popup and its action routing.
        for ((item, key), cached) in state.actions.iter().zip(&mut applied.actions) {
            apply_changed(cached, text(key), |value| item.set_text(value));
        }
        if let Some(tray) = app.tray_by_id("chatplus") {
            apply_changed(&mut applied.tooltip, tooltip, |value| {
                tray.set_tooltip(Some(value))
            });
            let icons = app.state::<crate::desktop_notifications::Icons>();
            apply_changed(
                &mut applied.unread_icon,
                enabled && unread.has_unread,
                |value| {
                    tray.set_icon(Some(if *value {
                        icons.unread.clone()
                    } else {
                        icons.normal.clone()
                    }))
                },
            );
        }
    }
}
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let title = MenuItem::new(app, "ChatPlus Desktop", false, None::<&str>)?;
    let status = MenuItem::new(app, "", false, None::<&str>)?;
    let unread = MenuItem::new(app, "", false, None::<&str>)?;
    let actions = [
        (Action::Open, "Open ChatPlus", "menu.openChatPlus"),
        (Action::Settings, "Settings", "common.settings"),
        (Action::About, "About ChatPlus Desktop", "menu.about"),
        (Action::Quit, "Quit", "menu.quit"),
    ]
    .into_iter()
    .map(|(action, title, key)| {
        // Swiph3l: Menu tracking retains English source labels for later language
        // changes; caching an already translated title would freeze it in that language.
        menu::item(app, action, title, None).map(|item| (item, key))
    })
    .collect::<tauri::Result<Vec<_>>>()?;
    let menu = Menu::with_items(
        app,
        &[
            &title,
            &status,
            &unread,
            &PredefinedMenuItem::separator(app)?,
            &actions[0].0,
            &actions[1].0,
            &menu::themes(app)?,
            &actions[2].0,
            &PredefinedMenuItem::separator(app)?,
            &actions[3].0,
        ],
    )?;
    app.manage(TrayState {
        status,
        unread,
        applied: Mutex::new(Presentation {
            actions: vec![None; actions.len()],
            ..Presentation::default()
        }),
        actions,
    });
    TrayIconBuilder::with_id("chatplus")
        .icon(app.default_window_icon().expect("bundled icon").clone())
        .tooltip("ChatPlus Desktop")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                menu::enqueue(tray.app_handle(), Action::Open);
            }
        })
        .build(app)?;
    refresh(app);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_writes_follow_presentation_changes_and_retry_failures() {
        let mut previous = None;
        let mut writes = 0;
        for value in ["unread", "unread", "unread", "read", "read", "unread"] {
            apply_changed(&mut previous, value, |_| {
                writes += 1;
                Ok::<_, ()>(())
            });
        }
        assert_eq!(writes, 3);
        apply_changed(&mut previous, "offline", |_| Err(()));
        assert_eq!(previous, Some("unread"));
        apply_changed(&mut previous, "offline", |_| Ok::<_, ()>(()));
        assert_eq!(previous, Some("offline"));
    }
    #[test]
    fn labels_and_icon_are_cached_independently() {
        let mut label = None;
        let mut icon = None;
        let mut label_writes = 0;
        let mut icon_writes = 0;
        for (text, unread) in [("Unread", true), ("Nieprzeczytane", true), ("Read", false)] {
            apply_changed(&mut label, text, |_| {
                label_writes += 1;
                Ok::<_, ()>(())
            });
            apply_changed(&mut icon, unread, |_| {
                icon_writes += 1;
                Ok::<_, ()>(())
            });
        }
        assert_eq!(label_writes, 3);
        assert_eq!(icon_writes, 2);
    }
}
