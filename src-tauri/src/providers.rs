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
                unread: false,
                notifications: false,
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
    for service in services {
        if service.id.is_empty()
            || service.id.len() > 64
            || !service
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || !ids.insert(service.id.clone())
        {
            return Err(
                "Service IDs must be unique and contain only letters, numbers and hyphens.".into(),
            );
        }
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
    fn providers_do_not_share_dom_adapters() {
        assert!(ProviderId::SynologyChatplus.definition().unread);
        for provider in [
            ProviderId::SynologyChat,
            ProviderId::Slack,
            ProviderId::Discord,
        ] {
            assert!(!provider.definition().unread);
            assert!(!provider.definition().notifications);
            assert!(!provider.definition().theme);
        }
        assert!(serde_json::from_str::<ProviderId>("\"browser\"").is_err());
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
        assert!(services.iter().all(|s| !s.notifications));
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
}
