//! Synthetic provider capabilities belong only to the isolated debug profile.
//!
//! Keep the stored provider identity and normal production registry unchanged.

#[cfg(any(all(windows, debug_assertions), test))]
use crate::providers::ProviderId;
use crate::providers::ServiceConfig;

#[cfg(any(all(windows, debug_assertions), test))]
const IDENTIFIER: &str = "io.github.swiph3l.chatplus-desktop.services-validation";
#[cfg(all(windows, debug_assertions))]
static ENABLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

pub fn initialize(identifier: &str) {
    #[cfg(all(windows, debug_assertions))]
    let _ = ENABLED.set(profile_enabled(true, identifier));
    #[cfg(not(all(windows, debug_assertions)))]
    let _ = identifier;
}

pub fn mattermost(service: &ServiceConfig) -> bool {
    #[cfg(all(windows, debug_assertions))]
    {
        return eligible(
            ENABLED.get().copied().unwrap_or(false),
            service.provider,
            &service.url,
        );
    }
    #[cfg(not(all(windows, debug_assertions)))]
    {
        let _ = service;
        false
    }
}

#[cfg(any(all(windows, debug_assertions), test))]
fn profile_enabled(supported_build: bool, identifier: &str) -> bool {
    supported_build && identifier == IDENTIFIER
}

#[cfg(any(all(windows, debug_assertions), test))]
fn eligible(validation_profile: bool, provider: ProviderId, value: &str) -> bool {
    validation_profile
        && provider == ProviderId::Mattermost
        && url::Url::parse(value).is_ok_and(|url| {
            url.scheme() == "http"
                && url.host_str() == Some("127.0.0.1")
                && url.port() == Some(17830)
                && url.username().is_empty()
                && url.password().is_none()
                && url.query().is_none()
                && url.fragment().is_none()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixture_profile_is_disabled_for_production_builds_and_other_identifiers() {
        assert!(profile_enabled(true, IDENTIFIER));
        assert!(!profile_enabled(false, IDENTIFIER));
        for identifier in [
            "io.github.swiph3l.chatplus-desktop",
            "io.github.swiph3l.chatplus-desktop.services-validation-extra",
            "",
        ] {
            assert!(!profile_enabled(true, identifier));
        }
    }

    #[test]
    fn synthetic_mattermost_requires_the_validation_profile_and_exact_fixture_origin() {
        let fixture = "http://127.0.0.1:17830/mattermost/";
        assert!(eligible(true, ProviderId::Mattermost, fixture));
        assert!(!eligible(false, ProviderId::Mattermost, fixture));
        assert!(!eligible(true, ProviderId::Slack, fixture));
        for value in [
            "https://127.0.0.1:17830/mattermost/",
            "http://localhost:17830/mattermost/",
            "http://127.0.0.1:17831/mattermost/",
            "http://127.0.0.1/mattermost/",
            "http://127.0.0.1:17830.example.com/mattermost/",
            "http://example.com:17830/mattermost/",
            "http://user@127.0.0.1:17830/mattermost/",
            "http://user:password@127.0.0.1:17830/mattermost/",
            "http://127.0.0.1:17830/mattermost/?mode=fixture",
            "http://127.0.0.1:17830/mattermost/#fixture",
        ] {
            assert!(!eligible(true, ProviderId::Mattermost, value), "{value}");
        }
    }

    #[test]
    fn production_mattermost_capabilities_and_source_identity_remain_unsupported() {
        let service = ServiceConfig {
            id: "production-mattermost".into(),
            provider: ProviderId::Mattermost,
            name: "Mattermost".into(),
            url: "https://mattermost.example.com/".into(),
            enabled: true,
            notifications: true,
            notification_color: Default::default(),
        };
        assert!(!mattermost(&service));
        assert!(!service.supports_notifications());
        assert!(!service.supports_unread());
        assert_eq!(service.unread_source_provider(), ProviderId::Mattermost);
        assert!(!crate::unread::Source::ChatPlusDom.accepts(service.unread_source_provider()));
        assert!(!ProviderId::Mattermost.definition().notifications);
        assert!(!ProviderId::Mattermost.definition().unread);
    }
}
