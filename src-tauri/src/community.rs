//! Public credit and community destinations bundled with the app, without API lookups.
use serde::Deserialize;
use std::{collections::HashSet, sync::OnceLock};

#[derive(Deserialize)]
struct Contributor {
    id: String,
    username: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommunityFork {
    id: String,
    contributor_id: String,
    owner: String,
    repository: String,
}

#[derive(Deserialize)]
struct Registry {
    contributors: Vec<Contributor>,
    forks: Vec<CommunityFork>,
}

fn valid_id(value: &str) -> bool {
    value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn valid_username(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 39
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        && !value.starts_with('-')
        && !value.ends_with('-')
}

fn valid_repository(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
}

impl Registry {
    fn parse(json: &str) -> Result<Self, &'static str> {
        let registry: Self =
            serde_json::from_str(json).map_err(|_| "Invalid community registry.")?;
        let mut ids = HashSet::new();
        let mut usernames = HashSet::new();
        for contributor in &registry.contributors {
            if !valid_id(&contributor.id)
                || !valid_username(&contributor.username)
                || !ids.insert(contributor.id.as_str())
                || !usernames.insert(contributor.username.to_ascii_lowercase())
            {
                return Err("Invalid community contributor.");
            }
        }
        let mut fork_ids = HashSet::new();
        for fork in &registry.forks {
            if !valid_id(&fork.id)
                || !valid_username(&fork.owner)
                || !valid_repository(&fork.repository)
                || !ids.contains(fork.contributor_id.as_str())
                || !fork_ids.insert(fork.id.as_str())
            {
                return Err("Invalid community variant.");
            }
        }
        Ok(registry)
    }

    fn link(&self, target: &str) -> Option<String> {
        if target.len() > 100 {
            return None;
        }
        let repository = crate::project::PROJECT.github_repository_url;
        match target {
            "contribute" => Some(format!("{repository}/blob/main/CONTRIBUTING.md")),
            "contributors" => Some(format!("{repository}/graphs/contributors")),
            "fork" => Some(format!("{repository}/fork")),
            "forks" => Some(format!("{repository}/forks")),
            _ => {
                let (kind, id) = target.split_once(':')?;
                match kind {
                    "person" => self
                        .contributors
                        .iter()
                        .find(|contributor| contributor.id == id)
                        .map(|contributor| format!("https://github.com/{}", contributor.username)),
                    "fork" => self.forks.iter().find(|fork| fork.id == id).map(|fork| {
                        format!("https://github.com/{}/{}", fork.owner, fork.repository)
                    }),
                    _ => None,
                }
            }
        }
    }
}

pub fn link(target: &str) -> Option<String> {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    // Swiph3l: The renderer passes a credit ID; every browser destination is
    // resolved from reviewed, bundled metadata, never a renderer-supplied URL.
    REGISTRY
        .get_or_init(|| {
            Registry::parse(include_str!("../../contributors.json"))
                .expect("valid bundled community registry")
        })
        .link(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_credit_and_contribution_links_resolve_to_exact_github_destinations() {
        let registry = Registry::parse(include_str!("../../contributors.json")).unwrap();
        for contributor in &registry.contributors {
            assert_eq!(
                registry.link(&format!("person:{}", contributor.id)),
                Some(format!("https://github.com/{}", contributor.username))
            );
        }
        for fork in &registry.forks {
            assert_eq!(
                registry.link(&format!("fork:{}", fork.id)),
                Some(format!(
                    "https://github.com/{}/{}",
                    fork.owner, fork.repository
                ))
            );
        }
        for target in ["contribute", "contributors", "fork", "forks"] {
            let url = url::Url::parse(&registry.link(target).unwrap()).unwrap();
            assert_eq!(url.scheme(), "https");
            assert_eq!(url.host_str(), Some("github.com"));
            assert!(url
                .path()
                .starts_with("/Swiph3l/synology-chatplus-desktop/"));
        }
    }

    #[test]
    fn unknown_ids_paths_and_arbitrary_urls_cannot_be_opened_as_community_links() {
        for target in [
            "",
            "person:unknown",
            "fork:unknown",
            "person:../Swiph3l",
            "person:swiph3l/other",
            "person:swiph3l?tab=repositories",
            "https://example.com",
            "javascript:alert(1)",
            "fork:turbogizzmo-macos#other",
        ] {
            assert!(link(target).is_none(), "{target}");
        }
    }

    #[test]
    fn malformed_paths_duplicate_credits_and_unattributed_variants_are_rejected() {
        let original: serde_json::Value =
            serde_json::from_str(include_str!("../../contributors.json")).unwrap();
        for username in [
            "../escape",
            "user/other",
            "user?query",
            "user#fragment",
            "user%2Fother",
            "user@example.com",
        ] {
            let mut value = original.clone();
            value["contributors"][0]["username"] = username.into();
            assert!(Registry::parse(&value.to_string()).is_err(), "{username}");
        }
        let mut duplicate = original.clone();
        duplicate["contributors"][1]["id"] = duplicate["contributors"][0]["id"].clone();
        assert!(Registry::parse(&duplicate.to_string()).is_err());
        let mut unknown = original.clone();
        unknown["forks"][0]["contributorId"] = "unknown".into();
        assert!(Registry::parse(&unknown.to_string()).is_err());
        for repository in [
            "..",
            "../elsewhere",
            "repo?query",
            "repo#fragment",
            "repo%2Fother",
        ] {
            let mut value = original.clone();
            value["forks"][0]["repository"] = repository.into();
            assert!(Registry::parse(&value.to_string()).is_err());
        }
    }
}
