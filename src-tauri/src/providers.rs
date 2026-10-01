//! Closed provider registry. Remote services never receive native IPC permissions.
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderId {
    SynologyChatplus,
    SynologyChat,
    Slack,
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
        }
    }
    pub fn validate_url(self, value: &str) -> Result<String, String> {
        let normalized = crate::state::normalize_server(value)?;
        let url = Url::parse(&normalized).map_err(|_| "Invalid service URL.")?;
        if self == Self::Slack && !slack_origin(&url) {
            return Err("Use an HTTPS Slack workspace URL or https://app.slack.com/.".into());
        }
        Ok(normalized)
    }
    pub fn allows(self, configured: &str, target: &Url) -> bool {
        if self == Self::Slack {
            return slack_origin(target);
        }
        Url::parse(configured)
            .is_ok_and(|url| crate::navigation::same_server(target, &url.origin()))
    }
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
        for provider in [ProviderId::SynologyChat, ProviderId::Slack] {
            assert!(!provider.definition().unread);
            assert!(!provider.definition().notifications);
            assert!(!provider.definition().theme);
        }
        assert!(serde_json::from_str::<ProviderId>("\"browser\"").is_err());
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
