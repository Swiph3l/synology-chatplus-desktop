//! Closed provider registry. Remote services never receive native IPC permissions.
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderId {
    SynologyChatplus,
    SynologyChat,
    Slack,
    Discord,
    Mattermost,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDefinition {
    pub display_name: &'static str,
    pub icon: &'static str,
    pub experimental: bool,
    pub unread: bool,
    pub notifications: bool,
    pub theme: bool,
}
impl ProviderId {
    pub fn definition(self) -> ProviderDefinition {
        match self {
            Self::SynologyChatplus => ProviderDefinition {
                display_name: "ChatPlus",
                icon: "CP",
                experimental: false,
                unread: true,
                notifications: true,
                theme: true,
            },
            Self::SynologyChat => ProviderDefinition {
                display_name: "Synology Chat",
                icon: "SC",
                experimental: true,
                unread: true,
                notifications: true,
                theme: false,
            },
            Self::Slack => ProviderDefinition {
                display_name: "Slack",
                icon: "S",
                experimental: true,
                unread: false,
                notifications: false,
                theme: false,
            },
            Self::Discord => ProviderDefinition {
                display_name: "Discord",
                icon: "D",
                experimental: true,
                unread: true,
                notifications: true,
                theme: false,
            },
            Self::Mattermost => ProviderDefinition {
                display_name: "Mattermost",
                icon: "M",
                experimental: true,
                unread: false,
                notifications: false,
                theme: false,
            },
        }
    }
    pub fn validate_url(self, value: &str) -> Result<String, String> {
        if self == Self::Discord && value.trim().is_empty() {
            return Ok("https://discord.com/app/".into());
        }
        let normalized = crate::state::normalize_server(value)?;
        let url = Url::parse(&normalized).map_err(|_| "Invalid service URL.")?;
        if self == Self::Slack && !slack_origin(&url) {
            return Err("Use an HTTPS Slack workspace URL or https://app.slack.com/.".into());
        }
        if self == Self::Discord && !discord_origin(&url) {
            return Err("Discord web sessions require https://discord.com/.".into());
        }
        Ok(normalized)
    }
    pub fn allows(self, configured: &str, target: &Url) -> bool {
        if self == Self::Slack {
            return slack_origin(target);
        }
        if self == Self::Discord {
            return discord_origin(target);
        }
        Url::parse(configured)
            .is_ok_and(|url| crate::navigation::same_server(target, &url.origin()))
    }
}
fn discord_origin(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.host_str() == Some("discord.com")
        && url.username().is_empty()
        && url.password().is_none()
}
fn slack_origin(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url
            .host_str()
            .is_some_and(|host| host == "slack.com" || host.ends_with(".slack.com"))
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceConfig {
    pub id: String,
    pub provider: ProviderId,
    pub name: String,
    pub url: String,
    pub enabled: bool,
    #[serde(default = "notifications_default")]
    pub notifications: bool,
}
impl ServiceConfig {
    // The stable service ID is also its profile ID; provider type and display name
    // never determine a storage partition. The migrated primary keeps its old path.
    pub fn profile_directory(
        &self,
        app_local_data: &std::path::Path,
    ) -> Option<std::path::PathBuf> {
        (self.id != "chatplus").then(|| app_local_data.join("services").join(&self.id))
    }
}
fn notifications_default() -> bool {
    true
}
pub fn normalize_services(services: &mut [ServiceConfig]) -> Result<(), String> {
    if services.len() > 12 {
        return Err("Configure at most 12 services.".into());
    }
    let mut ids = std::collections::HashSet::new();
    // Validate every profile identity before changing any configuration. Windows
    // treats these ASCII path components case-insensitively; keep stored spelling
    // for valid IDs so this check never moves an existing profile.
    for service in services.iter() {
        if service.id.is_empty()
            || service.id.len() > 64
            || !service
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err("Service IDs must contain only letters, numbers and hyphens.".into());
        }
        let profile_id = service.id.to_ascii_lowercase();
        if matches!(profile_id.as_str(), "con" | "prn" | "aux" | "nul")
            || (profile_id.len() == 4
                && (profile_id.starts_with("com") || profile_id.starts_with("lpt"))
                && matches!(profile_id.as_bytes()[3], b'1'..=b'9'))
        {
            return Err("Service IDs must not use reserved Windows device names.".into());
        }
        if !ids.insert(profile_id) {
            return Err("Service IDs must be unique regardless of letter case.".into());
        }
    }
    for service in services {
        service.name = service.name.trim().chars().take(60).collect();
        if service.name.is_empty() {
            service.name = service.provider.definition().display_name.into();
        }
        service.url = service.provider.validate_url(&service.url)?;
        if !service.provider.definition().notifications {
            service.notifications = false;
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn profile_service(id: &str) -> ServiceConfig {
        ServiceConfig {
            id: id.into(),
            provider: ProviderId::Discord,
            name: " Account ".into(),
            url: String::new(),
            enabled: true,
            notifications: false,
        }
    }
    #[test]
    fn service_profiles_reject_traversal_and_duplicate_ids() {
        let service = ServiceConfig {
            id: "service-a".into(),
            provider: ProviderId::SynologyChatplus,
            name: "Example".into(),
            url: "https://example.com/chat/".into(),
            enabled: true,
            notifications: true,
        };
        assert!(normalize_services(&mut [service.clone(), service.clone()]).is_err());
        for id in ["../profile", "x/y", "x\\y", "", "."] {
            let mut invalid = service.clone();
            invalid.id = id.into();
            assert!(normalize_services(&mut [invalid]).is_err());
        }
        let mut slack = service;
        slack.provider = ProviderId::Slack;
        slack.url = "https://app.slack.com/".into();
        let mut services = [slack];
        normalize_services(&mut services).unwrap();
        assert!(!services[0].notifications);
    }
    #[test]
    fn service_profiles_reject_case_collisions_before_changing_configuration() {
        let first = profile_service("Account");
        let mut second = profile_service("account");
        // A disabled account still owns its persistent identity.
        second.enabled = false;
        let mut services = vec![first, second];
        let original = services.clone();
        let root = std::path::Path::new("profiles");
        assert_eq!(
            services[0]
                .profile_directory(root)
                .unwrap()
                .to_string_lossy()
                .to_ascii_lowercase(),
            services[1]
                .profile_directory(root)
                .unwrap()
                .to_string_lossy()
                .to_ascii_lowercase()
        );
        assert_eq!(
            normalize_services(&mut services).unwrap_err(),
            "Service IDs must be unique regardless of letter case."
        );
        assert_eq!(services, original);
    }

    #[test]
    fn valid_profile_id_spelling_survives_normalization_rename_and_restart() {
        let mut services = vec![
            profile_service("Discord-Personal"),
            profile_service("Discord-Work"),
        ];
        let root = std::path::Path::new("profiles");
        let paths = services
            .iter()
            .map(|service| service.profile_directory(root))
            .collect::<Vec<_>>();
        normalize_services(&mut services).unwrap();
        assert_eq!(services[0].id, "Discord-Personal");
        assert_eq!(services[1].id, "Discord-Work");
        assert_eq!(
            paths[0],
            Some(root.join("services").join("Discord-Personal"))
        );
        services[0].name = "Renamed account".into();
        normalize_services(&mut services).unwrap();
        let mut restarted: Vec<ServiceConfig> =
            serde_json::from_slice(&serde_json::to_vec(&services).unwrap()).unwrap();
        normalize_services(&mut restarted).unwrap();
        assert_eq!(restarted, services);
        assert_eq!(
            restarted
                .iter()
                .map(|service| service.profile_directory(root))
                .collect::<Vec<_>>(),
            paths
        );
    }

    #[test]
    fn service_profiles_reject_windows_device_names_without_rejecting_valid_prefixes() {
        let mut reserved = ["CON", "con", "PrN", "aUx", "nUl"]
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        for number in 1..=9 {
            reserved.push(format!("COM{number}"));
            reserved.push(format!("lpt{number}"));
        }
        for id in reserved {
            let mut service = profile_service(&id);
            let original = service.clone();
            assert_eq!(
                normalize_services(std::slice::from_mut(&mut service)).unwrap_err(),
                "Service IDs must not use reserved Windows device names.",
                "{id}"
            );
            assert_eq!(service, original);
        }
        for id in [
            "COM10",
            "lpt10",
            "console",
            "auxiliary",
            "nul-account",
            "COM1-personal",
        ] {
            let mut service = profile_service(id);
            normalize_services(std::slice::from_mut(&mut service)).unwrap();
            assert_eq!(service.id, id);
        }
    }

    #[test]
    fn providers_do_not_share_dom_adapters() {
        for provider in [
            ProviderId::SynologyChatplus,
            ProviderId::SynologyChat,
            ProviderId::Discord,
        ] {
            assert!(provider.definition().unread);
            assert!(provider.definition().notifications);
        }
        for provider in [ProviderId::Slack, ProviderId::Mattermost] {
            assert!(!provider.definition().unread);
            assert!(!provider.definition().notifications);
            assert!(!provider.definition().theme);
        }
        assert!(serde_json::from_str::<ProviderId>("\"browser\"").is_err());
        assert!(!ProviderId::SynologyChat.definition().theme);
        assert!(!ProviderId::Discord.definition().theme);
    }
    #[test]
    fn notification_capability_keeps_existing_service_mute_and_profiles() {
        for provider in [
            ProviderId::SynologyChatplus,
            ProviderId::SynologyChat,
            ProviderId::Discord,
        ] {
            let mut service = profile_service("muted-profile");
            service.provider = provider;
            service.url = if provider == ProviderId::Discord {
                String::new()
            } else {
                "https://example.com/chat/".into()
            };
            service.notifications = false;
            let profile = service.profile_directory(std::path::Path::new("profiles"));
            normalize_services(std::slice::from_mut(&mut service)).unwrap();
            assert!(!service.notifications);
            assert_eq!(
                service.profile_directory(std::path::Path::new("profiles")),
                profile
            );
            service.notifications = true;
            normalize_services(std::slice::from_mut(&mut service)).unwrap();
            assert!(service.notifications);
        }
    }
    #[test]
    fn discord_configuration_and_auth_navigation_are_exact_origin_only() {
        assert_eq!(
            ProviderId::Discord.validate_url("").unwrap(),
            "https://discord.com/app/"
        );
        assert_eq!(
            serde_json::from_str::<ProviderId>("\"discord\"").unwrap(),
            ProviderId::Discord
        );
        for value in [
            "https://discord.com/app",
            "https://discord.com/login",
            "https://discord.com/channels/@me",
        ] {
            assert!(ProviderId::Discord.validate_url(value).is_ok());
            assert!(
                ProviderId::Discord.allows("https://discord.com/app/", &Url::parse(value).unwrap())
            );
        }
        for value in [
            "http://discord.com/app",
            "https://discord.com:8443/app",
            "https://discord.com.evil.example/",
            "https://evil.discord.com/",
            "https://discordapp.com/",
            "https://discord.gg/",
            "https://support.discord.com/",
            "https://user:password@discord.com/",
        ] {
            assert!(ProviderId::Discord.validate_url(value).is_err());
            assert!(!ProviderId::Discord
                .allows("https://discord.com/app/", &Url::parse(value).unwrap()));
        }
        assert!(ProviderId::Discord
            .validate_url("https://discord.com/app?token=anything")
            .is_err());
        assert!(ProviderId::Discord.allows(
            "https://discord.com/app/",
            &Url::parse("https://discord.com/login?redirect_to=%2Fapp").unwrap()
        ));
    }
    #[test]
    fn same_provider_accounts_keep_independent_stable_profiles() {
        let personal = ServiceConfig {
            id: "discord-personal".into(),
            provider: ProviderId::Discord,
            name: "Personal Discord".into(),
            url: String::new(),
            enabled: true,
            notifications: true,
        };
        let mut work = personal.clone();
        work.id = "discord-work".into();
        work.name = "Work Discord".into();
        let mut services = vec![personal, work];
        normalize_services(&mut services).unwrap();
        let root = std::path::Path::new("profiles");
        let paths = services
            .iter()
            .map(|s| s.profile_directory(root))
            .collect::<Vec<_>>();
        assert_ne!(paths[0], paths[1]);
        assert_eq!(
            paths[0],
            Some(root.join("services").join("discord-personal"))
        );
        assert!(services.iter().all(|s| s.notifications));
        services[0].name = "Renamed".into();
        assert_eq!(services[0].profile_directory(root), paths[0]);
        let saved = serde_json::to_vec(&services).unwrap();
        let mut restarted: Vec<ServiceConfig> = serde_json::from_slice(&saved).unwrap();
        normalize_services(&mut restarted).unwrap();
        assert_eq!(restarted[1].profile_directory(root), paths[1]);
        restarted.remove(0);
        assert_eq!(restarted[0].profile_directory(root), paths[1]);
        let mut legacy = services[0].clone();
        legacy.id = "chatplus".into();
        legacy.provider = ProviderId::SynologyChatplus;
        assert_eq!(legacy.profile_directory(root), None);
    }
    #[test]
    fn slack_requires_exact_https_domain_boundary() {
        for url in [
            "https://app.slack.com/client/",
            "https://workspace.slack.com/",
            "https://slack.com/signin/",
        ] {
            assert!(ProviderId::Slack.validate_url(url).is_ok());
        }
        for url in [
            "https://slack.com.evil.example/",
            "http://app.slack.com/",
            "https://app.slack.com:8443/",
            "https://user:pass@slack.com/",
        ] {
            assert!(ProviderId::Slack.validate_url(url).is_err());
        }
    }

    #[test]
    fn mattermost_registration_and_serialization_keep_conservative_capabilities() {
        let provider: ProviderId = serde_json::from_str("\"mattermost\"").unwrap();
        assert_eq!(provider, ProviderId::Mattermost);
        assert_eq!(serde_json::to_string(&provider).unwrap(), "\"mattermost\"");
        let definition = provider.definition();
        assert_eq!(definition.display_name, "Mattermost");
        assert!(definition.experimental);
        assert!(!definition.unread);
        assert!(!definition.notifications);
        assert!(!definition.theme);
        for unknown in ["mattermost-cloud", "Mattermost", "unknown"] {
            assert!(serde_json::from_value::<ProviderId>(serde_json::json!(unknown)).is_err());
        }
    }

    #[test]
    fn mattermost_requires_a_safe_custom_server_and_normalizes_it() {
        for (input, expected) in [
            (" https://CHAT.example.com ", "https://chat.example.com/"),
            (
                "https://mattermost.example.com:443",
                "https://mattermost.example.com/",
            ),
            ("http://localhost:8065", "http://localhost:8065/"),
            (
                "https://chat.example.com/mattermost///",
                "https://chat.example.com/mattermost/",
            ),
        ] {
            assert_eq!(
                ProviderId::Mattermost.validate_url(input).unwrap(),
                expected
            );
        }
        for invalid in [
            "",
            "chat.example.com",
            "not a URL",
            "https://",
            "https://[invalid]",
            "ftp://chat.example.com",
            "file:///chat",
            "javascript:alert(1)",
            "data:text/html,chat",
            "https://user:password@chat.example.com",
            "https://chat.example.com/?token=example",
            "https://chat.example.com/#token",
            "https://chat.example.com/a b",
            "https://chat.example.com\\other",
        ] {
            assert!(
                ProviderId::Mattermost.validate_url(invalid).is_err(),
                "{invalid}"
            );
        }
    }

    #[test]
    fn mattermost_navigation_and_popups_follow_the_configured_origin() {
        let configured = "https://chat.example.com:8443/mattermost/";
        for target in [
            "https://chat.example.com:8443/login",
            "https://chat.example.com:8443/company/channels/town-square",
            "https://chat.example.com:8443/oauth/complete?code=example",
        ] {
            assert!(ProviderId::Mattermost.allows(configured, &Url::parse(target).unwrap()));
        }
        for external in [
            "https://chat.example.com/login",
            "http://chat.example.com:8443/login",
            "https://chat.example.com.evil.example:8443/",
            "https://other.example.com:8443/",
            "https://mattermost.com/",
            "https://identity.example.com/login",
            "https://user:password@chat.example.com:8443/login",
            "file:///chat",
            "javascript:alert(1)",
        ] {
            assert!(
                !ProviderId::Mattermost.allows(configured, &Url::parse(external).unwrap()),
                "{external}"
            );
        }
        assert!(!ProviderId::Mattermost
            .allows("invalid", &Url::parse("https://chat.example.com/").unwrap()));
    }

    #[test]
    fn mattermost_accounts_have_stable_separate_profiles_after_rename_and_restart() {
        let mut services: Vec<ServiceConfig> = ["company", "private"]
            .into_iter()
            .map(|id| ServiceConfig {
                id: format!("mattermost-{id}"),
                provider: ProviderId::Mattermost,
                name: format!("Mattermost — {id}"),
                // Same server, distinct accounts: isolation must use service ID.
                url: "https://chat.example.com/".into(),
                enabled: true,
                notifications: true,
            })
            .collect();
        normalize_services(&mut services).unwrap();
        assert!(services.iter().all(|s| !s.notifications));
        let root = std::path::Path::new("profiles");
        let profiles = services
            .iter()
            .map(|s| s.profile_directory(root))
            .collect::<Vec<_>>();
        assert_ne!(profiles[0], profiles[1]);
        assert_eq!(
            profiles[0],
            Some(root.join("services").join("mattermost-company"))
        );
        services[0].name = "Client A".into();
        assert_eq!(services[0].profile_directory(root), profiles[0]);
        let mut restarted: Vec<ServiceConfig> =
            serde_json::from_slice(&serde_json::to_vec(&services).unwrap()).unwrap();
        normalize_services(&mut restarted).unwrap();
        assert_eq!(restarted, services);
        assert_eq!(restarted[1].profile_directory(root), profiles[1]);
    }
}
