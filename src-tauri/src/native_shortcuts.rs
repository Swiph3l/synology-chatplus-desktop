//! Route desktop menu shortcuts from the Windows provider WebView controls.

#[cfg(windows)]
use crate::menu::Action;

#[cfg(windows)]
#[derive(Clone, Copy, Default)]
struct Modifiers {
    control: bool,
    shift: bool,
    alt: bool,
    windows: bool,
}

#[cfg(windows)]
fn shortcut(key: u32, modifiers: Modifiers) -> Option<Action> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        VK_0, VK_ADD, VK_F11, VK_F5, VK_NUMPAD0, VK_OEM_MINUS, VK_OEM_PLUS, VK_R, VK_SUBTRACT,
    };

    // AltGr includes Control+Alt, and Windows combinations belong to the OS.
    if modifiers.alt || modifiers.windows {
        return None;
    }
    if modifiers.control {
        if key == u32::from(VK_OEM_PLUS.0) || key == u32::from(VK_ADD.0) {
            // The usual '+' key needs Shift; '=' is the same zoom shortcut.
            return Some(Action::ZoomIn);
        }
        if modifiers.shift {
            return None;
        }
        if key == u32::from(VK_OEM_MINUS.0) || key == u32::from(VK_SUBTRACT.0) {
            return Some(Action::ZoomOut);
        }
        if key == u32::from(VK_0.0) || key == u32::from(VK_NUMPAD0.0) {
            return Some(Action::ZoomReset);
        }
        if key == u32::from(VK_R.0) {
            return Some(Action::Reload);
        }
    } else if !modifiers.shift {
        if key == u32::from(VK_F11.0) {
            return Some(Action::Fullscreen);
        }
        if key == u32::from(VK_F5.0) {
            return Some(Action::Reload);
        }
    }
    None
}

#[cfg(windows)]
fn dispatch_repeat(action: Action, was_key_down: bool) -> bool {
    !was_key_down || matches!(action, Action::ZoomIn | Action::ZoomOut)
}

#[cfg(windows)]
pub fn attach(app: &tauri::AppHandle, view: &tauri::Webview) -> tauri::Result<()> {
    use webview2_com::{
        AcceleratorKeyPressedEventHandler,
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
        },
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };

    let app = app.clone();
    view.with_webview(move |view| unsafe {
        let result = view.controller().add_AcceleratorKeyPressed(
            &AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut handled = Default::default();
                args.Handled(&mut handled)?;
                if handled.as_bool() {
                    return Ok(());
                }
                let mut kind = Default::default();
                args.KeyEventKind(&mut kind)?;
                if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                    && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
                {
                    return Ok(());
                }
                let mut key = 0;
                args.VirtualKey(&mut key)?;
                let modifiers = Modifiers {
                    control: GetKeyState(i32::from(VK_CONTROL.0)) < 0,
                    shift: GetKeyState(i32::from(VK_SHIFT.0)) < 0,
                    alt: GetKeyState(i32::from(VK_MENU.0)) < 0,
                    windows: GetKeyState(i32::from(VK_LWIN.0)) < 0
                        || GetKeyState(i32::from(VK_RWIN.0)) < 0,
                };
                let Some(action) = shortcut(key, modifiers) else {
                    return Ok(());
                };
                // Stop WebView2's default handling before doing anything else.
                // This event blocks the browser synchronously; menu::enqueue
                // runs native window/WebView actions after the callback returns.
                args.SetHandled(true)?;
                let mut physical = Default::default();
                args.PhysicalKeyStatus(&mut physical)?;
                if dispatch_repeat(action, physical.WasKeyDown.as_bool()) {
                    crate::menu::enqueue(&app, action);
                }
                Ok(())
            })),
            &mut 0,
        );
        if result.is_err() {
            eprintln!("[shortcuts] Could not attach desktop shortcuts.");
        }
    })
}

#[cfg(not(windows))]
pub fn attach(_: &tauri::AppHandle, _: &tauri::Webview) -> tauri::Result<()> {
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        VK_0, VK_ADD, VK_C, VK_F11, VK_F5, VK_NUMPAD0, VK_OEM_MINUS, VK_OEM_PLUS, VK_R,
        VK_SUBTRACT, VK_V,
    };

    fn control() -> Modifiers {
        Modifiers {
            control: true,
            ..Default::default()
        }
    }

    #[test]
    fn zoom_accepts_equal_plus_minus_and_numeric_keypad_chords() {
        for key in [VK_OEM_PLUS, VK_ADD] {
            for shift in [false, true] {
                assert_eq!(
                    shortcut(u32::from(key.0), Modifiers { shift, ..control() }),
                    Some(Action::ZoomIn)
                );
            }
        }
        for key in [VK_OEM_MINUS, VK_SUBTRACT] {
            assert_eq!(shortcut(u32::from(key.0), control()), Some(Action::ZoomOut));
        }
        for key in [VK_0, VK_NUMPAD0] {
            assert_eq!(
                shortcut(u32::from(key.0), control()),
                Some(Action::ZoomReset)
            );
        }
    }

    #[test]
    fn fullscreen_and_reload_match_their_desktop_chords() {
        assert_eq!(
            shortcut(u32::from(VK_F11.0), Modifiers::default()),
            Some(Action::Fullscreen)
        );
        assert_eq!(
            shortcut(u32::from(VK_F5.0), Modifiers::default()),
            Some(Action::Reload)
        );
        assert_eq!(shortcut(u32::from(VK_R.0), control()), Some(Action::Reload));
        assert_eq!(shortcut(u32::from(VK_F11.0), control()), None);
    }

    #[test]
    fn editing_provider_altgr_and_system_chords_are_left_untouched() {
        for key in [VK_C, VK_V, VK_R, VK_0, VK_OEM_PLUS, VK_OEM_MINUS] {
            assert_eq!(shortcut(u32::from(key.0), Modifiers::default()), None);
        }
        for key in [VK_C, VK_V] {
            assert_eq!(shortcut(u32::from(key.0), control()), None);
        }
        for key in [VK_OEM_PLUS, VK_ADD, VK_OEM_MINUS, VK_0, VK_F11, VK_R] {
            assert_eq!(
                shortcut(
                    u32::from(key.0),
                    Modifiers {
                        alt: true,
                        ..control()
                    }
                ),
                None
            );
            assert_eq!(
                shortcut(
                    u32::from(key.0),
                    Modifiers {
                        windows: true,
                        ..control()
                    }
                ),
                None
            );
        }
        for key in [VK_OEM_MINUS, VK_0, VK_R, VK_F11, VK_F5] {
            assert_eq!(
                shortcut(
                    u32::from(key.0),
                    Modifiers {
                        shift: true,
                        ..control()
                    }
                ),
                None
            );
        }
    }

    #[test]
    fn holding_zoom_repeats_but_fullscreen_and_reload_do_not_toggle_repeatedly() {
        for action in [Action::ZoomIn, Action::ZoomOut] {
            assert!(dispatch_repeat(action, false));
            assert!(dispatch_repeat(action, true));
        }
        for action in [Action::ZoomReset, Action::Fullscreen, Action::Reload] {
            assert!(dispatch_repeat(action, false));
            assert!(!dispatch_repeat(action, true));
        }
    }
}
