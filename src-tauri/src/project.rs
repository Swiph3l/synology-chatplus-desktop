use serde::Serialize;
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Serialize)]
pub struct Project {
    pub project_name: &'static str,
    pub project_description: &'static str,
    pub maintainer: &'static str,
    pub license: &'static str,
    pub github_repository_url: &'static str,
    pub github_issues_url: &'static str,
    pub github_star_url: &'static str,
    pub support_url: Option<&'static str>,
}
const REPOSITORY: &str = "https://github.com/Swiph3l/synology-chatplus-desktop";
pub const PROJECT: Project = Project {
    project_name: "ChatPlus Desktop",
    project_description: "Unofficial community desktop client for Synology ChatPlus.",
    maintainer: "Swiph3l",
    license: "GNU GPLv3",
    github_repository_url: REPOSITORY,
    github_star_url: REPOSITORY,
    github_issues_url: "https://github.com/Swiph3l/synology-chatplus-desktop/issues",
    support_url: None,
};
#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Link {
    Github,
    Issues,
    Star,
    Support,
}
impl Project {
    pub fn link(&self, link: Link) -> Option<&str> {
        match link {
            Link::Github => Some(self.github_repository_url),
            Link::Issues => Some(self.github_issues_url),
            Link::Star => Some(self.github_star_url),
            Link::Support => self.support_url.filter(|s| !s.trim().is_empty()),
        }
    }
}
pub fn open(app: &tauri::AppHandle, link: Link) -> Result<(), String> {
    let value = PROJECT
        .link(link)
        .ok_or("This project link is not configured.")?;
    let url = url::Url::parse(value).map_err(|_| "Invalid project link.")?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err("Invalid project link.".into());
    }
    app.opener()
        .open_url(value, None::<&str>)
        .map_err(|_| "Could not open the default browser.".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn community_links_are_explicit_and_support_is_optional() {
        assert_eq!(PROJECT.link(Link::Star), PROJECT.link(Link::Github));
        assert!(PROJECT.link(Link::Issues).unwrap().ends_with("/issues"));
        assert!(PROJECT.link(Link::Support).is_none());
        let mut project = PROJECT.clone();
        project.support_url = Some(" ");
        assert!(project.link(Link::Support).is_none());
    }
}
