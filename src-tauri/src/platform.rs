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

pub fn prompt_sound(theme: &crate::state::Theme) {
    #[cfg(windows)]
    {
        use windows::{
            core::PCWSTR,
            Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT, SND_NOSTOP},
        };
        // Swiph3l: Original PCM cues are for explicit local prompts only. Keep
        // asynchronous storage aligned/static and never fall back to a system
        // sound or interrupt an existing cue. Toasts retain native OS audio/DND.
        #[repr(align(4))]
        struct AlignedSound<const N: usize>([u8; N]);
        static GENTLE: AlignedSound<{ include_bytes!("../sounds/link-prompt.wav").len() }> =
            AlignedSound(*include_bytes!("../sounds/link-prompt.wav"));
        static RETRO: AlignedSound<
            { include_bytes!("../../public/sounds/retro-prompt.wav").len() },
        > = AlignedSound(*include_bytes!("../../public/sounds/retro-prompt.wav"));
        let sound: &[u8] = if matches!(theme, crate::state::Theme::Retro) {
            &RETRO.0
        } else {
            &GENTLE.0
        };
        let _ = unsafe {
            PlaySoundW(
                PCWSTR(sound.as_ptr().cast()),
                None,
                SND_MEMORY | SND_ASYNC | SND_NODEFAULT | SND_NOSTOP,
            )
        };
    }
    #[cfg(not(windows))]
    let _ = theme;
}

#[cfg(windows)]
#[path = "webview_recovery.rs"]
mod recovery;
#[cfg(windows)]
pub(crate) use recovery::observe_connection;

#[cfg(not(windows))]
pub(crate) fn observe_connection(
    _: &tauri::AppHandle,
    _: &tauri::Webview,
    _: &crate::providers::ServiceConfig,
    _: &crate::services::LoadTicket,
    _: &url::Url,
) -> tauri::Result<()> {
    Ok(())
}

pub fn provider_initialization() -> &'static str {
    #[cfg(not(windows))]
    {
        concat!(
            include_str!("../webkit-bridge.js"),
            "\n",
            include_str!("../webkit-notifications.js")
        )
    }
    #[cfg(windows)]
    {
        ""
    }
}

pub fn page_finished(app: &tauri::AppHandle, view: &tauri::Webview, service_id: &str) {
    #[cfg(not(windows))]
    {
        // WebKit Finished does not prove transport success. Preserve Unknown
        // instead of claiming a loaded error page is a connected provider.
        crate::connection::set_for(app, service_id, crate::connection::Connection::Unknown);
        crate::unread::sync_presentation(app);
        if let Some(service) = crate::state::current(app)
            .services
            .iter()
            .find(|service| service.id == service_id)
        {
            let _ = crate::notification_bridge::attach(app, view, service);
        }
    }
    #[cfg(windows)]
    let _ = (app, view, service_id);
}

#[cfg(any(target_os = "macos", test))]
pub fn profile_identifier(identifier: &str, service_id: &str) -> [u8; 16] {
    // Swiph3l: Stable FNV-1a 128-bit identifiers avoid Rust's intentionally
    // unspecified DefaultHasher and keep WKWebView profiles across upgrades.
    let mut hash = 0x6c62272e07bb014262b821756295c58du128;
    for byte in identifier.bytes().chain([0]).chain(service_id.bytes()) {
        hash = (hash ^ u128::from(byte)).wrapping_mul(0x0000000001000000000000000000013b);
    }
    hash.to_be_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_profile_identifiers_are_stable_and_separate_accounts_and_apps() {
        let profile = profile_identifier("io.github.swiph3l.chatplus-desktop", "discord-1");
        assert_eq!(
            profile,
            profile_identifier("io.github.swiph3l.chatplus-desktop", "discord-1")
        );
        assert_ne!(
            profile,
            profile_identifier("io.github.swiph3l.chatplus-desktop", "discord-2")
        );
        assert_ne!(
            profile,
            profile_identifier("io.github.fork.chatplus", "discord-1")
        );
    }

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
