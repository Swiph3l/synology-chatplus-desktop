use crate::{
    connection,
    menu::{self, Action},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
struct TrayState {
    status: MenuItem<tauri::Wry>,
    unread: MenuItem<tauri::Wry>,
    actions: Vec<(MenuItem<tauri::Wry>, &'static str)>,
}
pub fn refresh(app: &AppHandle) {
    if let Some(state) = app.try_state::<TrayState>() {
        let connection_key = match connection::current(app) {
            connection::Connection::Unknown => "common.unknown",
            connection::Connection::Connecting => "common.connecting",
            connection::Connection::Connected => "common.connected",
            connection::Connection::Offline => "common.offline",
            connection::Connection::Error => "common.error",
        };
        let label = crate::i18n::t(app, "tray.connection")
            .replace("{state}", &crate::i18n::t(app, connection_key));
        let _ = state.status.set_text(&label);
        let unread = crate::unread::current(app);
        let enabled = crate::state::current(app).unread_tray;
        let unread_label = if enabled {
            crate::i18n::t(
                app,
                if unread.has_unread {
                    "tray.unread"
                } else if unread.last_update.is_some() {
                    "tray.noUnread"
                } else {
                    "tray.unreadUnavailable"
                },
            )
        } else {
            crate::i18n::t(app, "tray.unreadDisabled")
        };
        let _ = state.unread.set_text(&unread_label);
        // Swiph3l: Keep native menu objects alive during language changes; rebuilding
        // the Windows tray menu can disrupt an open popup and its action routing.
        for (item, key) in &state.actions {
            let _ = item.set_text(crate::i18n::t(app, key));
        }
        if let Some(tray) = app.tray_by_id("chatplus") {
            let _ = tray.set_tooltip(Some(format!("ChatPlus Desktop\n{unread_label}\n{label}")));
            let icons = app.state::<crate::desktop_notifications::Icons>();
            let _ = tray.set_icon(Some(if enabled && unread.has_unread {
                icons.unread.clone()
            } else {
                icons.normal.clone()
            }));
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
