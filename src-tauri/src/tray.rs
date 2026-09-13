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
}
pub fn refresh(app: &AppHandle) {
    if let Some(state) = app.try_state::<TrayState>() {
        let label = format!("Connection: {}", connection::current(app).label());
        let _ = state.status.set_text(&label);
        let unread = crate::unread::current(app);
        let enabled = crate::state::current(app).unread_tray;
        let unread_label = if enabled {
            crate::unread::label(&unread)
        } else {
            "Unread indicator disabled".into()
        };
        let _ = state.unread.set_text(&unread_label);
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
    let status = MenuItem::new(app, "Connection: unknown", false, None::<&str>)?;
    let unread = MenuItem::new(app, "Unread status unavailable", false, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &title,
            &status,
            &unread,
            &PredefinedMenuItem::separator(app)?,
            &menu::item(app, Action::Open, "Open ChatPlus", None)?,
            &menu::item(app, Action::Settings, "Settings", None)?,
            &menu::themes(app)?,
            &menu::item(app, Action::About, "About", None)?,
            &PredefinedMenuItem::separator(app)?,
            &menu::item(app, Action::Quit, "Quit", None)?,
        ],
    )?;
    app.manage(TrayState { status, unread });
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
