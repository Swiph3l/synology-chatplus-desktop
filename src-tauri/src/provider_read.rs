//! Explicit read actions through local evidence or a bounded public provider UI.
use crate::{providers::ServiceConfig, state};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Capabilities {
    pub current_local: bool,
    pub all_local: bool,
    pub all_provider: bool,
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
        // Swiph3l: Mattermost has native arrival evidence but no DOM read proof.
        // Its explicit local clear must not depend on a nonexistent DOM adapter.
        all_local: (supported && service.provider != crate::providers::ProviderId::Discord)
            || (service.enabled && service.provider == crate::providers::ProviderId::Mattermost),
        all_provider: supported && service.provider == crate::providers::ProviderId::Discord,
    }
}

pub fn all_label(service: &ServiceConfig) -> &'static str {
    if capabilities(service).all_provider {
        "rail.markDiscordInboxRead"
    } else {
        "rail.markAllReadLocal"
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

pub fn mark_all(app: &AppHandle, id: &str) -> Result<(), String> {
    let settings = state::current(app);
    let service = settings
        .services
        .iter()
        .find(|s| s.id == id && s.enabled)
        .ok_or("Choose an enabled configured service.")?;
    let capability = capabilities(service);
    if !capability.all_local && !capability.all_provider {
        return Err(crate::i18n::t(app, "rail.readUnsupported"));
    }
    let service = service.clone();
    let guard =
        ReadAllGuard::begin(id).ok_or_else(|| crate::i18n::t(app, "rail.discordReadAllBusy"))?;
    let app = app.clone();
    // Swiph3l: Native menus and WebView callbacks run on the UI thread. Never wait
    // there for view creation, script completion, unread projection or provider UI.
    std::thread::spawn(move || {
        if capability.all_local {
            if let Err(error) = crate::unread::acknowledge_all_local_for(&app, &service) {
                crate::shell::report(&app, error);
            }
            drop(guard);
            return;
        }
        if crate::services::activate_configured(&app, &service).is_err() {
            report_inbox(&app, "rail.discordReadAllUnavailable");
            return;
        }
        let Ok(baseline) = crate::unread::begin_discord_inbox_read(&app, &service.id) else {
            report_inbox(&app, "rail.discordReadAllUnavailable");
            return;
        };
        tauri::async_runtime::spawn(async move {
            let _guard = guard;
            match run_inbox(&app, &service).await {
                InboxResult::Submitted => {
                    if current_inbox(&state::current(&app), &service)
                        && crate::unread::complete_discord_inbox_read(&app, baseline)
                    {
                        report_inbox(&app, "rail.discordReadAllSubmitted");
                    } else {
                        report_inbox(&app, "rail.discordReadAllUnavailable");
                    }
                }
                InboxResult::Confirmation => report_inbox(&app, "rail.discordReadAllConfirm"),
                _ => report_inbox(&app, "rail.discordReadAllUnavailable"),
            }
        });
    });
    Ok(())
}

static READ_ALL: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
static OPERATION: AtomicU64 = AtomicU64::new(1);
struct ReadAllGuard(String);
impl ReadAllGuard {
    fn begin(id: &str) -> Option<Self> {
        READ_ALL
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.into())
            .then(|| Self(id.into()))
    }
}
impl Drop for ReadAllGuard {
    fn drop(&mut self) {
        READ_ALL
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.0);
    }
}
#[derive(Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum InboxResult {
    Waiting,
    Submitted,
    Confirmation,
    Unavailable,
}
fn report_inbox(app: &AppHandle, key: &str) {
    crate::shell::report(app, crate::i18n::t(app, key));
}
fn current_inbox(settings: &state::Settings, service: &ServiceConfig) -> bool {
    settings.active_service.as_deref() == Some(service.id.as_str())
        && settings
            .services
            .iter()
            .any(|current| current == service && capabilities(current).all_provider)
}
async fn run_inbox(app: &AppHandle, service: &ServiceConfig) -> InboxResult {
    let operation = OPERATION.fetch_add(1, Ordering::Relaxed).to_string();
    let deadline = Instant::now() + Duration::from_secs(6);
    while Instant::now() < deadline {
        if !current_inbox(&state::current(app), service) || !crate::window::is_foreground(app) {
            return InboxResult::Unavailable;
        }
        let Some(view) = app.get_webview(&crate::services::label(&service.id)) else {
            return InboxResult::Unavailable;
        };
        let expires = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            + 700;
        let script = format!("Date.now() <= {expires} ? (window.__chatplusReadAllStep?.('{operation}') ?? 'waiting') : 'unavailable'");
        // Swiph3l: No lock is held while WebView2 schedules its callback. Missing
        // or wedged renderers time out; no timer itself constitutes read evidence.
        let (tx, rx) = tokio::sync::oneshot::channel();
        let sender = Mutex::new(Some(tx));
        if view
            .eval_with_callback(&script, move |result| {
                if let Some(sender) = sender.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    let _ = sender.send(result);
                }
            })
            .is_err()
        {
            return InboxResult::Unavailable;
        }
        match tokio::time::timeout(Duration::from_millis(750), rx).await {
            Ok(Ok(value)) => match serde_json::from_str::<InboxResult>(&value) {
                Ok(InboxResult::Waiting) => (),
                Ok(result) => return result,
                Err(_) => return InboxResult::Unavailable,
            },
            _ => return InboxResult::Unavailable,
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    InboxResult::Unavailable
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{NotificationColor, ProviderId};
    fn discord() -> ServiceConfig {
        ServiceConfig {
            id: "discord-second".into(),
            provider: ProviderId::Discord,
            name: "Second account".into(),
            url: "https://discord.com/app/".into(),
            enabled: true,
            notifications: true,
            notification_color: NotificationColor::Auto,
        }
    }
    #[test]
    fn provider_read_all_requires_the_same_configured_active_instance() {
        let service = discord();
        let mut settings = state::Settings {
            services: vec![service.clone()],
            active_service: Some(service.id.clone()),
            ..Default::default()
        };
        assert!(current_inbox(&settings, &service));
        assert_eq!(all_label(&service), "rail.markDiscordInboxRead");
        settings.active_service = Some("discord-first".into());
        assert!(!current_inbox(&settings, &service));
        settings.active_service = Some(service.id.clone());
        settings.services[0].url = "https://discord.com/channels/@me".into();
        assert!(!current_inbox(&settings, &service));
        settings.services[0] = service.clone();
        settings.services[0].enabled = false;
        assert!(!current_inbox(&settings, &service));
        settings.services.clear();
        assert!(!current_inbox(&settings, &service));
    }
    #[test]
    fn overlapping_requests_for_one_account_are_rejected_without_blocking_other_accounts() {
        let first = ReadAllGuard::begin("read-test-first").unwrap();
        assert!(ReadAllGuard::begin("read-test-first").is_none());
        let second = ReadAllGuard::begin("read-test-second").unwrap();
        drop(first);
        assert!(ReadAllGuard::begin("read-test-first").is_some());
        drop(second);
    }
    #[test]
    fn unknown_callback_values_cannot_confirm_a_provider_read() {
        assert_eq!(
            serde_json::from_str::<InboxResult>("\"submitted\"").unwrap(),
            InboxResult::Submitted
        );
        for value in ["true", "null", "{}", "\"opened\"", "\"success\""] {
            assert!(serde_json::from_str::<InboxResult>(value).is_err());
        }
    }
    #[test]
    fn mattermost_local_all_is_explicit_and_independent_of_delivery_preferences() {
        let mut service = ServiceConfig {
            id: "mattermost-work".into(),
            provider: ProviderId::Mattermost,
            name: "Work".into(),
            url: "https://mattermost.example.com/".into(),
            enabled: true,
            notifications: false,
            notification_color: NotificationColor::Auto,
        };
        assert!(
            !service.supports_unread(),
            "no DOM adapter or provider read proof is implied"
        );
        assert_eq!(
            capabilities(&service),
            Capabilities {
                current_local: false,
                all_local: true,
                all_provider: false,
            }
        );
        assert_eq!(all_label(&service), "rail.markAllReadLocal");
        service.notifications = true;
        assert!(capabilities(&service).all_local);
        service.enabled = false;
        assert_eq!(
            capabilities(&service),
            Capabilities {
                current_local: false,
                all_local: false,
                all_provider: false,
            }
        );
    }

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
                    all_local: (supported && provider != ProviderId::Discord)
                        || provider == ProviderId::Mattermost,
                    all_provider: provider == ProviderId::Discord,
                }
            );
            service.enabled = false;
            assert_eq!(
                capabilities(&service),
                Capabilities {
                    current_local: false,
                    all_local: false,
                    all_provider: false
                }
            );
        }
    }
}
