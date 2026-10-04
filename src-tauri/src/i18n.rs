use crate::state::{self, Language};
use std::{collections::HashMap, sync::OnceLock};
use tauri::AppHandle;

type Dictionary = HashMap<String, String>;
fn dictionaries() -> &'static [Dictionary; 3] {
    static DICTIONARIES: OnceLock<[Dictionary; 3]> = OnceLock::new();
    // Swiph3l: Native menus and the local frontend share these resources so translations cannot drift between surfaces.
    DICTIONARIES.get_or_init(|| {
        [
            serde_json::from_str(include_str!("../../src/i18n/en.json"))
                .expect("valid English resources"),
            serde_json::from_str(include_str!("../../src/i18n/pl.json"))
                .expect("valid Polish resources"),
            serde_json::from_str(include_str!("../../src/i18n/es.json"))
                .expect("valid Spanish resources"),
        ]
    })
}
pub fn text(language: &Language, key: &str) -> String {
    let index = match language {
        Language::En => 0,
        Language::Pl => 1,
        Language::Es => 2,
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
    fn native_resources_have_identical_keys_and_no_empty_values() {
        let dictionaries = dictionaries();
        for dictionary in &dictionaries[1..] {
            assert_eq!(dictionary.len(), dictionaries[0].len());
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
}
