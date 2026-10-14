use crate::state::{self, Language};
use std::{collections::HashMap, sync::OnceLock};
use tauri::AppHandle;

type Dictionary = HashMap<String, String>;
fn dictionaries() -> &'static [Dictionary; 7] {
    static DICTIONARIES: OnceLock<[Dictionary; 7]> = OnceLock::new();
    // Swiph3l: Native menus and the local frontend share these resources so translations cannot drift between surfaces.
    DICTIONARIES.get_or_init(|| {
        [
            serde_json::from_str(include_str!("../../src/i18n/en.json"))
                .expect("valid English resources"),
            serde_json::from_str(include_str!("../../src/i18n/pl.json"))
                .expect("valid Polish resources"),
            serde_json::from_str(include_str!("../../src/i18n/es.json"))
                .expect("valid Spanish resources"),
            serde_json::from_str(include_str!("../../src/i18n/de.json"))
                .expect("valid German resources"),
            serde_json::from_str(include_str!("../../src/i18n/fr.json"))
                .expect("valid French resources"),
            serde_json::from_str(include_str!("../../src/i18n/ja.json"))
                .expect("valid Japanese resources"),
            serde_json::from_str(include_str!("../../src/i18n/zh-TW.json"))
                .expect("valid Traditional Chinese resources"),
        ]
    })
}
pub fn text(language: &Language, key: &str) -> String {
    let index = match language {
        Language::En => 0,
        Language::Pl => 1,
        Language::Es => 2,
        Language::De => 3,
        Language::Fr => 4,
        Language::Ja => 5,
        Language::ZhTw => 6,
    };
    dictionaries()[index]
        .get(key)
        .unwrap_or_else(|| panic!("Missing localization key: {key}"))
        .clone()
}
pub fn t(app: &AppHandle, key: &str) -> String {
    text(&state::current(app).language, key)
}
pub fn localize(language: &Language, value: &str) -> String {
    dictionaries()[0]
        .iter()
        .find(|(_, english)| english.as_str() == value)
        .map(|(key, _)| text(language, key))
        .unwrap_or_else(|| value.into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_resources_cover_all_english_keys_and_no_empty_values() {
        let dictionaries = dictionaries();
        for dictionary in &dictionaries[1..] {
            // New locales also include frontend updater strings in the same
            // JSON file; every native English key must still be translated.
            for key in dictionaries[0].keys() {
                assert!(
                    dictionary
                        .get(key)
                        .is_some_and(|value| !value.trim().is_empty()),
                    "{key}"
                );
            }
        }
        assert_eq!(text(&Language::Es, "services.remove"), "Eliminar servicio");
    }

    #[test]
    fn all_supported_languages_round_trip_without_resetting_settings() {
        for (code, language) in [
            ("en", Language::En),
            ("pl", Language::Pl),
            ("es", Language::Es),
            ("de", Language::De),
            ("fr", Language::Fr),
            ("ja", Language::Ja),
            ("zh-TW", Language::ZhTw),
        ] {
            let settings: state::Settings = serde_json::from_value(serde_json::json!({
                "language": code,
                "theme": "dark",
                "includeBetaUpdates": true,
                "serviceSchema": 1,
                "services": [{
                    "id": "retained-service", "provider": "synology-chatplus",
                    "name": "Retained", "url": "https://example.com/chat/",
                    "enabled": true, "notifications": false,
                    "notificationColor": "#123456"
                }],
                "activeService": "retained-service"
            }))
            .unwrap();
            assert_eq!(settings.language, language);
            assert!(settings.include_beta_updates);
            assert_eq!(settings.services[0].id, "retained-service");
            let saved = serde_json::to_value(&settings).unwrap();
            assert_eq!(saved["language"], code);
            let reopened: state::Settings = serde_json::from_value(saved).unwrap();
            assert_eq!(reopened.language, language);
            assert_eq!(reopened.services, settings.services);
            assert!(reopened.include_beta_updates);
            assert!(!text(&language, "common.settings").is_empty());
            assert!(!text(&language, "menu.file").is_empty());
        }
    }
}
