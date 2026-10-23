#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NotificationPresentationState {
    AcceptsNotifications,
    Busy,
    D3dFullscreen,
    PresentationMode,
    NotPresent,
    QuietTime,
    App,
    Unavailable,
}

#[cfg(any(windows, test))]
fn presentation_state_from_code(state: Option<i32>) -> NotificationPresentationState {
    use NotificationPresentationState as State;
    match state {
        Some(1) => State::NotPresent,
        Some(2) => State::Busy,
        Some(3) => State::D3dFullscreen,
        Some(4) => State::PresentationMode,
        Some(5) => State::AcceptsNotifications,
        Some(6) => State::QuietTime,
        Some(7) => State::App,
        _ => State::Unavailable,
    }
}

#[cfg(windows)]
pub fn notification_presentation_state() -> NotificationPresentationState {
    // Swiph3l: This is an observation of Windows' generic interruption state,
    // not per-app banner permission, DND proof or a reason to suppress delivery.
    presentation_state_from_code(
        unsafe { windows::Win32::UI::Shell::SHQueryUserNotificationState() }
            .ok()
            .map(|state| state.0),
    )
}

pub fn gentle_prompt_sound() {
    #[cfg(windows)]
    {
        use windows::{
            core::PCWSTR,
            Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT, SND_NOSTOP},
        };
        // Swiph3l: Original low-level 200 ms PCM chime with a smooth attack/release.
        // Static aligned storage outlives asynchronous playback; never fall back
        // to the system warning sound or interrupt another sound from this process.
        #[repr(align(4))]
        struct AlignedSound([u8; 9_644]);
        static SOUND: AlignedSound = AlignedSound(*include_bytes!("../sounds/link-prompt.wav"));
        let _ = unsafe {
            PlaySoundW(
                PCWSTR(SOUND.0.as_ptr().cast()),
                None,
                SND_MEMORY | SND_ASYNC | SND_NODEFAULT | SND_NOSTOP,
            )
        };
    }
}

/// WebView2 provides reliable transport completion; generic Tauri page-finished
/// events on other platforms cannot distinguish a server document from an error page.
#[cfg(windows)]
pub fn observe_connection(
    app: &tauri::AppHandle,
    window: &tauri::Webview,
    service_id: &str,
) -> tauri::Result<()> {
    use crate::connection::{self, Connection};
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED,
            COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED,
        },
        NavigationCompletedEventHandler,
    };
    let app = app.clone();
    let service_id = service_id.to_string();
    window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            connection::set_for(&app, &service_id, Connection::Unknown);
            return;
        };
        let handler_app = app.clone();
        let handler_id = service_id.clone();
        let result = core.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut success = Default::default();
                    args.IsSuccess(&mut success)?;
                    let state = if success.as_bool() {
                        crate::unread::sync_presentation(&handler_app);
                        Connection::Connected
                    } else {
                        let mut status = Default::default();
                        args.WebErrorStatus(&mut status)?;
                        if status == COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED {
                            return Ok(());
                        }
                        if status == COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED {
                            Connection::Offline
                        } else {
                            Connection::Error
                        }
                    };
                    connection::set_for(&handler_app, &handler_id, state);
                }
                Ok(())
            })),
            &mut 0,
        );
        if result.is_err() {
            connection::set_for(&app, &service_id, Connection::Unknown);
        }
    })
}
#[cfg(not(windows))]
pub fn observe_connection(_: &tauri::AppHandle, _: &tauri::Webview, _: &str) -> tauri::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_presentation_maps_documented_states_and_unknown_results() {
        use NotificationPresentationState as State;
        for (code, expected) in [
            (1, State::NotPresent),
            (2, State::Busy),
            (3, State::D3dFullscreen),
            (4, State::PresentationMode),
            (5, State::AcceptsNotifications),
            (6, State::QuietTime),
            (7, State::App),
        ] {
            assert_eq!(presentation_state_from_code(Some(code)), expected);
        }
        for code in [None, Some(-1), Some(0), Some(8), Some(i32::MAX)] {
            assert_eq!(presentation_state_from_code(code), State::Unavailable);
        }
    }
}
