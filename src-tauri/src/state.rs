use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_store::StoreExt;

pub const AUTOSTART_ENTRY_NAME: &str = "ChatPlus Desktop";

static SETTINGS_STORE_WRITE: Mutex<()> = Mutex::new(());

struct SettingsStore(std::sync::Arc<tauri_plugin_store::Store<tauri::Wry>>);

fn with_settings_store<T>(
    app: &AppHandle,
    action: impl FnOnce(&tauri_plugin_store::Store<tauri::Wry>) -> Result<T, String>,
) -> Result<T, String> {
    let _write = SETTINGS_STORE_WRITE
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if app.try_state::<SettingsStore>().is_none() {
        let store = app
            .store_builder("settings.json")
            .disable_auto_save()
            .build()
            .map_err(|_| "Could not open settings store.")?;
        // Keep the same store/cache in application state, but remove the plugin's
        // automatic exit writer, which otherwise bypasses atomic replacement.
        store.close_resource();
        // StoreBuilder suppresses load failures. Never let an unreadable or
        // malformed existing file become an empty profile that migration saves.
        let target = tauri_plugin_store::resolve_store_path(app, "settings.json")
            .map_err(|_| "Could not resolve settings store.")?;
        if target
            .try_exists()
            .map_err(|_| "Could not read settings store.")?
        {
            store
                .reload_ignore_defaults()
                .map_err(|_| "Could not read settings store.")?;
        }
        app.manage(SettingsStore(store));
    }
    let store = app.state::<SettingsStore>();
    action(&store.0)
}

pub fn stored_value(app: &AppHandle, key: &str) -> Result<Option<serde_json::Value>, String> {
    with_settings_store(app, |store| Ok(store.get(key)))
}

pub fn persist_value(app: &AppHandle, key: &str, value: serde_json::Value) -> Result<(), String> {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMPORARY: AtomicU64 = AtomicU64::new(0);
    with_settings_store(app, |store| {
        // Keep the existing store object and all unrelated keys, including the
        // updater timestamp. Only a complete replacement reaches the disk/cache.
        let mut entries: std::collections::BTreeMap<_, _> = store.entries().into_iter().collect();
        entries.insert(key.to_owned(), value.clone());
        let bytes = serde_json::to_vec_pretty(&entries).map_err(|_| "Invalid settings.")?;
        let target = tauri_plugin_store::resolve_store_path(app, "settings.json")
            .map_err(|_| "Could not resolve settings store.")?;
        let directory = target.parent().ok_or("Could not resolve settings store.")?;
        std::fs::create_dir_all(directory).map_err(|_| "Could not save settings.")?;
        let (temporary, mut file) = loop {
            let serial = NEXT_TEMPORARY.fetch_add(1, Ordering::Relaxed);
            let temporary =
                directory.join(format!(".settings-{}-{serial}.tmp", std::process::id()));
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
            {
                Ok(file) => break (temporary, file),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => return Err("Could not save settings.".into()),
            }
        };
        let result = (|| -> std::io::Result<()> {
            file.write_all(&bytes)?;
            file.sync_all()?;
            // Windows must not keep the temporary file open while replacing the
            // existing file. Both files are on the same volume.
            drop(file);
            std::fs::rename(&temporary, &target)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
            return Err("Could not save settings.".into());
        }
        store.set(key, value);
        Ok(())
    })
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    En,
    Pl,
    Es,
    De,
    Fr,
    Ja,
    #[serde(rename = "zh-TW")]
    ZhTw,
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
// Derive against this same field definition so legacy input can be normalized
// before decoding, without maintaining a second copy of the settings schema.
#[serde(remote = "Self", rename_all = "camelCase", default)]
pub struct Settings {
    pub onboarding_completed: bool,
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
    pub include_beta_updates: bool,
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
            onboarding_completed: false,
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
            include_beta_updates: false,
            desktop_notifications: false,
            notification_preview: NotificationPreview::Sender,
            notification_cooldown: default_notification_cooldown_seconds(),
            notification_sound: true,
            unread_title: true,
            unread_tray: true,
        }
    }
}

impl Serialize for Settings {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        Self::serialize(self, serializer)
    }
}

impl<'de> Deserialize<'de> for Settings {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let mut value = serde_json::Value::deserialize(deserializer)?;
        migrate_update_preference(&mut value);
        migrate_onboarding_preference(&mut value);
        Self::deserialize(value).map_err(serde::de::Error::custom)
    }
}

fn migrate_onboarding_preference(value: &mut serde_json::Value) -> bool {
    let Some(settings) = value.as_object_mut() else {
        return false;
    };
    if settings.contains_key("onboardingCompleted") {
        return false;
    }
    // Missing means a profile written before onboarding existed, including an
    // intentionally empty workspace. Only a new Settings::default is pending.
    settings.insert("onboardingCompleted".into(), true.into());
    true
}

fn migrate_update_preference(value: &mut serde_json::Value) -> bool {
    let Some(settings) = value.as_object_mut() else {
        return false;
    };
    let old_update_channel = settings.remove("updateChannel");
    let old_channel = settings.remove("channel");
    let mut migrated = old_update_channel.is_some() || old_channel.is_some();
    if !settings.contains_key("includeBetaUpdates") {
        let legacy = old_update_channel.or(old_channel);
        let include_beta_updates = legacy
            .as_ref()
            .and_then(serde_json::Value::as_str)
            .map(|channel| {
                matches!(
                    channel.trim().to_ascii_lowercase().as_str(),
                    "beta" | "pre-release" | "prerelease" | "pre_release" | "preview"
                )
            })
            .unwrap_or(false);
        settings.insert("includeBetaUpdates".into(), include_beta_updates.into());
        migrated = true;
    }
    migrated
}

fn migrated_settings_value(
    settings: &Settings,
    previous: Option<serde_json::Value>,
) -> Result<serde_json::Value, serde_json::Error> {
    let serialized = serde_json::to_value(settings)?;
    if let Some(serde_json::Value::Object(mut previous)) = previous {
        // Keep unknown settings fields as well as the store's unrelated keys.
        // This lets a newer profile survive being read by an older executable.
        previous.extend(serialized.as_object().unwrap().clone());
        Ok(serde_json::Value::Object(previous))
    } else {
        Ok(serialized)
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
                notification_color: crate::providers::NotificationColor::Auto,
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
fn load_preferences(
    stored: &mut Option<serde_json::Value>,
    existing_profile: bool,
) -> Result<(Settings, bool), serde_json::Error> {
    let mut migrated = false;
    if let Some(value) = stored.as_mut() {
        migrated |= migrate_update_preference(value);
        migrated |= migrate_onboarding_preference(value);
    }
    let mut settings: Settings = stored
        .clone()
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_default();
    // An empty legacy store is still an existing profile. A fresh pending
    // profile has an explicit false flag, so restarting it stays distinguishable.
    // A configured first service also completes onboarding on a later launch,
    // even if the user closed its initial window before pressing Continue.
    if (existing_profile && stored.is_none())
        || !settings.services.is_empty()
        || !settings.server_url.is_empty()
    {
        migrated |= !settings.onboarding_completed;
        settings.onboarding_completed = true;
    }
    Ok((settings, migrated))
}

pub fn load(app: &AppHandle) -> Result<Settings, Box<dyn std::error::Error>> {
    let existing_profile =
        tauri_plugin_store::resolve_store_path(app, "settings.json")?.try_exists()?;
    let mut stored = stored_value(app, "settings")?;
    let (mut settings, preferences_migrated) = load_preferences(&mut stored, existing_profile)?;
    if !settings.server_url.is_empty() {
        settings.server_url = normalize_server(&settings.server_url).unwrap_or_default();
    }
    settings.notification_cooldown =
        normalize_notification_cooldown_seconds(settings.notification_cooldown);
    match settings.migrate_services() {
        Ok(service_migrated) if service_migrated || preferences_migrated => {
            // Swiph3l: A failed migration write must retain the original profile for the next launch.
            let _ = persist_value(app, "settings", migrated_settings_value(&settings, stored)?);
        }
        Ok(_) => {}
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
    // A later settings draft must not undo an explicit Skip or Continue.
    settings.onboarding_completed |= old.onboarding_completed;
    settings.migrate_services()?;
    settings.notification_cooldown =
        normalize_notification_cooldown_seconds(settings.notification_cooldown);
    let value = serde_json::to_value(&settings).map_err(|_| "Invalid settings.")?;
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
    if let Err(error) = persist_value(app, "settings", value) {
        let _ = if was_enabled {
            launch.enable()
        } else {
            launch.disable()
        };
        return Err(error);
    }
    *app.state::<AppState>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = settings;
    crate::tray::refresh(app);
    crate::menu::refresh(app);
    crate::shell::broadcast_settings(app);
    crate::unread::refresh(app);
    if old.include_beta_updates != current(app).include_beta_updates {
        crate::updates::preference_changed(app);
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
    fn fresh_onboarding_survives_restart_and_skip_stays_complete_without_services() {
        let (mut fresh, _) = load_preferences(&mut None, false).unwrap();
        assert!(!fresh.onboarding_completed);
        fresh.migrate_services().unwrap();
        let mut stored = Some(serde_json::to_value(&fresh).unwrap());
        let (mut restarted, migrated) = load_preferences(&mut stored, true).unwrap();
        assert!(!migrated);
        assert!(!restarted.onboarding_completed);
        assert!(restarted.services.is_empty());
        restarted.onboarding_completed = true;
        let mut skipped = Some(serde_json::to_value(&restarted).unwrap());
        let (skipped, migrated) = load_preferences(&mut skipped, true).unwrap();
        assert!(!migrated);
        assert!(skipped.onboarding_completed);
        assert!(skipped.services.is_empty());
        assert!(skipped.active_service.is_none());
    }

    #[test]
    fn existing_empty_profiles_and_beta_five_configuration_never_start_onboarding() {
        for value in [
            None,
            Some(serde_json::json!({})),
            Some(serde_json::json!({"serviceSchema": 1, "services": []})),
            Some(
                serde_json::json!({"serverUrl": "https://example.com/chat/", "theme": "dark", "language": "pl"}),
            ),
        ] {
            let mut stored = value;
            let (mut settings, _) = load_preferences(&mut stored, true).unwrap();
            assert!(settings.onboarding_completed);
            settings.migrate_services().unwrap();
            if !settings.services.is_empty() {
                assert_eq!(settings.services[0].id, "chatplus");
                assert_eq!(settings.language, Language::Pl);
                assert!(matches!(settings.theme, Theme::Dark));
            }
            let mut persisted = Some(migrated_settings_value(&settings, stored).unwrap());
            let (reopened, migrated) = load_preferences(&mut persisted, true).unwrap();
            assert!(reopened.onboarding_completed);
            assert!(!migrated);
        }
    }

    #[test]
    fn a_service_saved_during_onboarding_opens_normally_on_a_later_launch() {
        let mut pending = Settings {
            server_url: "https://example.com/chat/".into(),
            ..Settings::default()
        };
        pending.migrate_services().unwrap();
        let serialized = serde_json::to_value(&pending).unwrap();
        let saved: Settings = serde_json::from_value(serialized.clone()).unwrap();
        assert!(
            !saved.onboarding_completed,
            "an in-session save still permits Add another"
        );
        let mut stored = Some(serialized);
        let (reopened, migrated) = load_preferences(&mut stored, true).unwrap();
        assert!(migrated);
        assert!(reopened.onboarding_completed);
        assert_eq!(reopened.services, saved.services);
        assert_eq!(reopened.active_service, saved.active_service);
        let mut round_trip = Some(migrated_settings_value(&reopened, stored).unwrap());
        assert!(!load_preferences(&mut round_trip, true).unwrap().1);
    }

    #[test]
    fn onboarding_migration_preserves_unrelated_profile_fields_and_is_idempotent() {
        let mut stored = Some(serde_json::json!({
            "theme": "dark", "includeBetaUpdates": true,
            "serviceSchema": 1, "futurePreference": {"keep": true}
        }));
        let (settings, migrated) = load_preferences(&mut stored, true).unwrap();
        assert!(migrated);
        assert!(settings.onboarding_completed);
        assert!(settings.include_beta_updates);
        let mut value = migrated_settings_value(&settings, stored).unwrap();
        assert_eq!(value["futurePreference"], serde_json::json!({"keep": true}));
        assert_eq!(value["onboardingCompleted"], true);
        assert!(!migrate_onboarding_preference(&mut value));
    }

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
        assert!(settings.include_beta_updates);
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
        assert!(!settings.include_beta_updates);
        assert!(settings.server_url.is_empty());
        assert_eq!(settings.notification_cooldown, 60);
        assert_eq!(settings.language, Language::En);
    }

    #[test]
    fn legacy_update_preferences_migrate_without_resetting_other_settings() {
        for (field, legacy, expected) in [
            ("updateChannel", "stable", false),
            ("updateChannel", "beta", true),
            ("updateChannel", "pre-release", true),
            ("channel", "Stable", false),
            ("channel", "Beta", true),
            ("channel", "Prerelease", true),
            ("channel", "pre_release", true),
        ] {
            let mut value = serde_json::json!({
                "theme": "dark", "language": "pl", "automaticUpdates": true,
                "notificationSound": false, "notificationCooldown": 90
            });
            value[field] = legacy.into();
            let settings: Settings = serde_json::from_value(value).unwrap();
            assert_eq!(settings.include_beta_updates, expected, "{field}: {legacy}");
            assert!(settings.automatic_updates);
            assert!(!settings.notification_sound);
            assert_eq!(settings.notification_cooldown, 90);
            assert!(matches!(settings.theme, Theme::Dark));
            assert_eq!(settings.language, Language::Pl);
        }
    }

    #[test]
    fn explicit_beta_preference_takes_priority_over_legacy_channels() {
        for (preference, legacy) in [(false, "pre-release"), (true, "stable")] {
            let settings: Settings = serde_json::from_value(serde_json::json!({
                "includeBetaUpdates": preference,
                "updateChannel": legacy,
                "channel": "beta"
            }))
            .unwrap();
            assert_eq!(settings.include_beta_updates, preference);
        }
    }

    #[test]
    fn settings_serialize_only_the_beta_preference_and_round_trip() {
        for include_beta_updates in [false, true] {
            let settings = Settings {
                include_beta_updates,
                language: Language::Es,
                ..Settings::default()
            };
            let serialized = serde_json::to_value(&settings).unwrap();
            assert_eq!(serialized["includeBetaUpdates"], include_beta_updates);
            assert!(serialized.get("updateChannel").is_none());
            assert!(serialized.get("channel").is_none());
            let restored: Settings = serde_json::from_value(serialized).unwrap();
            assert_eq!(restored.include_beta_updates, include_beta_updates);
            assert_eq!(restored.language, Language::Es);
        }
    }

    #[test]
    fn update_preference_migration_is_idempotent_and_preserves_unknown_fields() {
        let mut original = serde_json::json!({
            "updateChannel": "pre-release", "channel": "stable",
            "serviceSchema": 1, "automaticUpdates": true,
            "futurePreference": {"keep": true}
        });
        assert!(migrate_update_preference(&mut original));
        assert!(!migrate_update_preference(&mut original));
        let settings: Settings = serde_json::from_value(original.clone()).unwrap();
        let migrated = migrated_settings_value(&settings, Some(original)).unwrap();
        assert_eq!(migrated["includeBetaUpdates"], true);
        assert_eq!(migrated["automaticUpdates"], true);
        assert_eq!(
            migrated["futurePreference"],
            serde_json::json!({"keep": true})
        );
        assert!(migrated.get("updateChannel").is_none());
        assert!(migrated.get("channel").is_none());

        let mut missing = serde_json::json!({"serviceSchema": 1});
        assert!(migrate_update_preference(&mut missing));
        assert_eq!(missing["includeBetaUpdates"], false);
        assert!(!migrate_update_preference(&mut missing));
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
        assert!(restored.include_beta_updates);
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
