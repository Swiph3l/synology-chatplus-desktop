use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_store::StoreExt;

pub const AUTOSTART_ENTRY_NAME: &str = "ChatPlus Desktop";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    En,
    Pl,
    Es,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}
impl Theme {
    pub fn label(&self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }
    pub fn native(&self) -> Option<tauri::Theme> {
        match self {
            Self::System => None,
            Self::Light => Some(tauri::Theme::Light),
            Self::Dark => Some(tauri::Theme::Dark),
        }
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateChannel {
    #[default]
    Stable,
    PreRelease,
}
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum NotificationPreview {
    Full,
    #[default]
    Sender,
    Generic,
}

fn default_notification_cooldown_seconds() -> u16 {
    60
}

pub fn normalize_notification_cooldown_seconds(value: u16) -> u16 {
    match value {
        0 | 30 | 60 | 90 => value,
        _ => default_notification_cooldown_seconds(),
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub server_url: String,
    pub services: Vec<crate::providers::ServiceConfig>,
    pub active_service: Option<String>,
    pub service_schema: u8,
    pub theme: Theme,
    pub language: Language,
    pub autostart: bool,
    pub minimize_to_tray: bool,
    pub close_to_tray: bool,
    pub external_links: bool,
    pub automatic_updates: bool,
    pub update_channel: UpdateChannel,
    pub desktop_notifications: bool,
    pub notification_preview: NotificationPreview,
    #[serde(default = "default_notification_cooldown_seconds")]
    pub notification_cooldown: u16,
    pub notification_sound: bool,
    pub unread_title: bool,
    pub unread_tray: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            server_url: String::new(),
            services: Vec::new(),
            active_service: None,
            service_schema: 0,
            theme: Theme::System,
            // Swiph3l: Legacy profiles were English-only; a missing language preserves that interface during migration.
            language: Language::En,
            autostart: false,
            // Swiph3l: These defaults apply on first run; existing users keep their saved window preferences.
            minimize_to_tray: true,
            close_to_tray: true,
            external_links: true,
            automatic_updates: false,
            update_channel: UpdateChannel::Stable,
            desktop_notifications: false,
            notification_preview: NotificationPreview::Sender,
            notification_cooldown: default_notification_cooldown_seconds(),
            notification_sound: true,
            unread_title: true,
            unread_tray: true,
        }
    }
}
pub struct AppState(pub Mutex<Settings>);
impl Settings {
    pub fn migrate_services(&mut self) -> Result<bool, String> {
        let migrating = self.service_schema == 0;
        if migrating && self.services.is_empty() && !self.server_url.is_empty() {
            self.services.push(crate::providers::ServiceConfig {
                id: "chatplus".into(),
                provider: crate::providers::ProviderId::SynologyChatplus,
                name: "ChatPlus".into(),
                url: self.server_url.clone(),
                enabled: true,
                notifications: true,
            });
        }
        crate::providers::normalize_services(&mut self.services)?;
        if !self
            .services
            .iter()
            .any(|s| s.enabled && Some(&s.id) == self.active_service.as_ref())
        {
            self.active_service = self
                .services
                .iter()
                .find(|s| s.enabled)
                .map(|s| s.id.clone());
        }
        self.server_url = self.active().map(|s| s.url.clone()).unwrap_or_default();
        self.service_schema = 1;
        Ok(migrating)
    }
    pub fn active(&self) -> Option<&crate::providers::ServiceConfig> {
        self.services
            .iter()
            .find(|s| s.enabled && Some(&s.id) == self.active_service.as_ref())
    }
}
#[derive(Default)]
pub struct Status(pub Mutex<Option<String>>);
pub fn current(app: &AppHandle) -> Settings {
    app.state::<AppState>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}
pub fn normalize_server(value: &str) -> Result<String, String> {
    let value = value.trim();
    if !(value.to_ascii_lowercase().starts_with("https://")
        || value.to_ascii_lowercase().starts_with("http://"))
        || value.chars().any(|c| c.is_whitespace() || c == '\\')
    {
        return Err("Enter a valid HTTP or HTTPS URL.".into());
    }
    let mut url = url::Url::parse(value).map_err(|_| "Invalid server URL.")?;
    if url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Use a server URL without credentials, query parameters or fragments.".into());
    }
    let path = format!("{}/", url.path().trim_end_matches('/'));
    url.set_path(&path);
    Ok(url.into())
}
pub fn load(app: &AppHandle) -> Result<Settings, Box<dyn std::error::Error>> {
    let store = app.store("settings.json")?;
    let mut settings: Settings = store
        .get("settings")
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_default();
    if !settings.server_url.is_empty() {
        settings.server_url = normalize_server(&settings.server_url).unwrap_or_default();
    }
    settings.notification_cooldown =
        normalize_notification_cooldown_seconds(settings.notification_cooldown);
    let before_migration = settings.clone();
    match settings.migrate_services() {
        Ok(true) => {
            store.set("settings", serde_json::to_value(&settings)?);
            // Swiph3l: A failed migration write must retain the original profile for the next launch.
            if store.save().is_err() {
                store.set("settings", serde_json::to_value(before_migration)?);
            }
        }
        Ok(false) => {}
        Err(_) => {
            // Swiph3l: Invalid provider configuration must not overwrite existing account/profile data.
            settings.services.clear();
            settings.service_schema = 0;
            settings.migrate_services()?;
        }
    }
    settings.autostart = app.autolaunch().is_enabled()?;
    if settings.autostart {
        #[cfg(windows)]
        if let Err(error) = reconcile_windows_autostart(app, false) {
            println!("autostart: self-heal skipped ({error})");
        }
    }
    Ok(settings)
}
pub fn persist(app: &AppHandle, mut settings: Settings) -> Result<(), String> {
    let old = current(app);
    settings.migrate_services()?;
    settings.notification_cooldown =
        normalize_notification_cooldown_seconds(settings.notification_cooldown);
    let store = app
        .store("settings.json")
        .map_err(|_| "Could not open settings store.")?;
    let launch = app.autolaunch();
    let was_enabled = launch
        .is_enabled()
        .map_err(|_| "Could not read start-at-login preference.")?;
    if settings.autostart != was_enabled {
        if settings.autostart {
            launch.enable()
        } else {
            launch.disable()
        }
        .map_err(|_| "Could not update start-at-login preference.")?;
    }
    if settings.autostart {
        #[cfg(windows)]
        if let Err(error) = reconcile_windows_autostart(app, true) {
            println!("autostart: self-heal skipped ({error})");
        }
    }
    store.set(
        "settings",
        serde_json::to_value(&settings).map_err(|_| "Invalid settings.")?,
    );
    if store.save().is_err() {
        store.set("settings", serde_json::to_value(&old).unwrap());
        let _ = if was_enabled {
            launch.enable()
        } else {
            launch.disable()
        };
        return Err("Could not save settings.".into());
    }
    *app.state::<AppState>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = settings;
    crate::tray::refresh(app);
    crate::menu::refresh(app);
    crate::shell::broadcast_settings(app);
    crate::unread::refresh(app);
    if old.update_channel != current(app).update_channel {
        crate::updates::channel_changed(app);
    }
    Ok(())
}

#[cfg(windows)]
fn reconcile_windows_autostart(_app: &AppHandle, enforce_enabled: bool) -> Result<(), String> {
    use std::env;
    use winreg::{
        enums::{HKEY_CURRENT_USER, REG_BINARY, REG_SZ},
        RegKey, RegValue,
    };

    const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const STARTUP_APPROVED_KEY: &str =
        "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
    const STARTUP_ENABLED_BYTES: [u8; 12] = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    let exe = env::current_exe().map_err(|_| "Could not resolve executable path.")?;
    let command = format!("\"{}\"", exe.display());

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run, _) = hkcu
        .create_subkey(RUN_KEY)
        .map_err(|_| "Could not open autostart registry key.")?;

    let current = run.get_value::<String, _>(AUTOSTART_ENTRY_NAME).ok();
    if current.as_deref() != Some(command.as_str()) {
        run.set_raw_value(
            AUTOSTART_ENTRY_NAME,
            &RegValue {
                vtype: REG_SZ,
                bytes: to_utf16le(&command),
            },
        )
        .map_err(|_| "Could not repair autostart command.")?;
    }

    let (startup, _) = hkcu
        .create_subkey(STARTUP_APPROVED_KEY)
        .map_err(|_| "Could not open startup status registry key.")?;
    let has_value = startup.get_raw_value(AUTOSTART_ENTRY_NAME).is_ok();

    if enforce_enabled || !has_value {
        startup
            .set_raw_value(
                AUTOSTART_ENTRY_NAME,
                &RegValue {
                    vtype: REG_BINARY,
                    bytes: STARTUP_ENABLED_BYTES.to_vec(),
                },
            )
            .map_err(|_| "Could not repair startup visibility state.")?;
    }

    Ok(())
}

#[cfg(windows)]
fn to_utf16le(value: &str) -> Vec<u8> {
    value
        .encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(u16::to_le_bytes)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_migration_is_deterministic_idempotent_and_preserves_preferences() {
        let mut settings: Settings = serde_json::from_value(serde_json::json!({
            "serverUrl": "https://example.com/chat/", "theme": "dark",
            "desktopNotifications": true, "notificationSound": false,
            "notificationPreview": "generic", "updateChannel": "pre-release",
            "automaticUpdates": true, "closeToTray": false, "autostart": true
        }))
        .unwrap();
        assert!(settings.migrate_services().unwrap());
        assert_eq!(settings.services.len(), 1);
        assert_eq!(settings.services[0].id, "chatplus");
        assert_eq!(settings.active_service.as_deref(), Some("chatplus"));
        assert_eq!(
            settings.services[0].provider,
            crate::providers::ProviderId::SynologyChatplus
        );
        let first = serde_json::to_value(&settings).unwrap();
        assert!(!settings.migrate_services().unwrap());
        assert_eq!(serde_json::to_value(&settings).unwrap(), first);
        assert!(settings.desktop_notifications && settings.automatic_updates && settings.autostart);
        assert!(!settings.notification_sound && !settings.close_to_tray);
        assert!(matches!(settings.theme, Theme::Dark));
        assert!(matches!(settings.update_channel, UpdateChannel::PreRelease));
    }
    #[test]
    fn migration_and_disabled_active_selection_never_duplicate_legacy_service() {
        let mut settings = Settings {
            server_url: "https://example.com/chat/".into(),
            ..Settings::default()
        };
        settings.migrate_services().unwrap();
        settings.services[0].enabled = false;
        settings.migrate_services().unwrap();
        assert_eq!(settings.services.len(), 1);
        assert_eq!(settings.active_service, None);
        assert!(settings.server_url.is_empty());
        settings.services.clear();
        settings.migrate_services().unwrap();
        assert!(settings.services.is_empty());
    }
    #[test]
    fn existing_settings_gain_safe_update_defaults() {
        let settings: Settings =
            serde_json::from_value(serde_json::json!({"theme":"dark"})).unwrap();
        assert!(!settings.automatic_updates);
        assert!(matches!(settings.update_channel, UpdateChannel::Stable));
        assert!(settings.server_url.is_empty());
        assert_eq!(settings.notification_cooldown, 60);
        assert_eq!(settings.language, Language::En);
    }

    #[test]
    fn language_and_preferences_round_trip_without_resetting_account_profiles() {
        let mut settings: Settings = serde_json::from_value(serde_json::json!({
            "language": "es", "serverUrl": "https://example.com/chat/",
            "automaticUpdates": true, "updateChannel": "pre-release", "theme": "dark"
        }))
        .unwrap();
        settings.migrate_services().unwrap();
        let serialized = serde_json::to_value(&settings).unwrap();
        let restored: Settings = serde_json::from_value(serialized).unwrap();
        assert_eq!(restored.language, Language::Es);
        assert_eq!(restored.services[0].id, "chatplus");
        assert_eq!(
            restored.services[0].provider,
            crate::providers::ProviderId::SynologyChatplus
        );
        assert!(restored.automatic_updates);
        assert!(matches!(restored.update_channel, UpdateChannel::PreRelease));
        assert!(matches!(restored.theme, Theme::Dark));
    }

    #[test]
    fn notification_cooldown_accepts_only_supported_values() {
        assert_eq!(normalize_notification_cooldown_seconds(0), 0);
        assert_eq!(normalize_notification_cooldown_seconds(30), 30);
        assert_eq!(normalize_notification_cooldown_seconds(60), 60);
        assert_eq!(normalize_notification_cooldown_seconds(90), 90);
        assert_eq!(normalize_notification_cooldown_seconds(15), 60);
        assert_eq!(normalize_notification_cooldown_seconds(120), 60);
    }
    #[test]
    fn normalizes_paths() {
        assert_eq!(
            normalize_server(" https://nas.example.com/chat ").unwrap(),
            "https://nas.example.com/chat/"
        );
    }
    #[test]
    fn rejects_unsafe_configuration() {
        for s in [
            "file:///tmp",
            "https://user:secret@example.com",
            "https://example.com/?token=x",
            "https://example.com/#x",
            "https:example.com",
            "https://exa mple.com",
            "https://example.com\\evil",
        ] {
            assert!(normalize_server(s).is_err());
        }
    }
}
