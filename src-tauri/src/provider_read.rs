//! Explicit local acknowledgements; provider pages never receive shell IPC grants.
use crate::{providers::ServiceConfig, state};
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Capabilities {
    pub current_local: bool,
    pub all_local: bool,
}

pub fn capabilities(service: &ServiceConfig) -> Capabilities {
    // Swiph3l: Unread reporting does not establish safe acknowledgement semantics;
    // experimental adapters must not inherit read actions from their badge capability.
    let supported = service.enabled
        && service.supports_unread()
        && matches!(
            service.provider,
            crate::providers::ProviderId::SynologyChatplus
                | crate::providers::ProviderId::SynologyChat
                | crate::providers::ProviderId::Discord
        );
    Capabilities {
        current_local: supported && service.provider == crate::providers::ProviderId::Discord,
        all_local: supported,
    }
}

pub fn mark_current_local(app: &AppHandle, id: &str) -> Result<(), String> {
    let settings = state::current(app);
    let service = settings
        .services
        .iter()
        .find(|s| s.id == id && s.enabled)
        .ok_or("Choose an enabled configured service.")?;
    if !capabilities(service).current_local
        || settings.active_service.as_deref() != Some(id)
        || !crate::window::is_foreground(app)
    {
        return Err(crate::i18n::t(app, "rail.readUnsupported"));
    }
    let view = app
        .get_webview(&crate::services::label(id))
        .ok_or("Service unavailable.")?;
    let app_handle = app.clone();
    view.eval_with_callback(
        "window.__chatplusMarkCurrentRead?.() === true",
        move |result| {
            if !matches!(serde_json::from_str::<bool>(&result), Ok(true)) {
                crate::shell::report(
                    &app_handle,
                    crate::i18n::t(&app_handle, "rail.readUnsupported"),
                );
            }
        },
    )
    .map_err(|_| "Could not acknowledge the current conversation.".into())
}

pub fn mark_all_local(app: &AppHandle, id: &str) -> Result<(), String> {
    let settings = state::current(app);
    let service = settings
        .services
        .iter()
        .find(|s| s.id == id && s.enabled)
        .ok_or("Choose an enabled configured service.")?;
    if !capabilities(service).all_local {
        return Err(crate::i18n::t(app, "rail.readUnsupported"));
    }
    crate::unread::acknowledge_all_local(app, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{NotificationColor, ProviderId};
    #[test]
    fn read_capabilities_distinguish_local_acknowledgement_and_unsupported() {
        for provider in [
            ProviderId::SynologyChatplus,
            ProviderId::SynologyChat,
            ProviderId::Discord,
            ProviderId::Whatsapp,
            ProviderId::Messenger,
            ProviderId::Slack,
            ProviderId::Mattermost,
        ] {
            let mut service = ServiceConfig {
                id: "second".into(),
                provider,
                name: "Test".into(),
                url: "https://example.com/".into(),
                enabled: true,
                notifications: true,
                notification_color: NotificationColor::Auto,
            };
            let supported = matches!(
                provider,
                ProviderId::SynologyChatplus | ProviderId::SynologyChat | ProviderId::Discord
            );
            assert_eq!(
                capabilities(&service),
                Capabilities {
                    current_local: provider == ProviderId::Discord,
                    all_local: supported
                }
            );
            service.enabled = false;
            assert_eq!(
                capabilities(&service),
                Capabilities {
                    current_local: false,
                    all_local: false
                }
            );
        }
    }
}
