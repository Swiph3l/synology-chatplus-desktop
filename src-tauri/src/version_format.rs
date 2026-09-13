/// Shared by the build script and tests. Packaging mode is not a release channel.
pub fn version(source: &str, tag: Option<&str>, commit: Option<&str>) -> (String, String) {
    if let Some(tag) = tag {
        let value = tag.strip_prefix('v').unwrap_or(tag);
        if let Ok(parsed) = semver::Version::parse(value) {
            let channel = if parsed.pre.is_empty() {
                "stable"
            } else if parsed.pre.as_str().split('.').next() == Some("alpha") {
                "alpha"
            } else if parsed.pre.as_str().split('.').next() == Some("beta") {
                "beta"
            } else {
                "development"
            };
            return (value.into(), channel.into());
        }
    }
    let suffix = commit.map(|s| format!("+{s}")).unwrap_or_default();
    (format!("{source}-dev{suffix}"), "development".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_build_is_development_even_when_optimized() {
        assert_eq!(
            version("0.1.0", None, Some("a92bc14")),
            ("0.1.0-dev+a92bc14".into(), "development".into())
        );
        assert_eq!(version("0.1.0", None, None).0, "0.1.0-dev");
    }
    #[test]
    fn semantic_tags_supply_display_version_and_channel() {
        for (tag, channel) in [
            ("v0.1.0-alpha.1", "alpha"),
            ("v0.1.0-beta.2", "beta"),
            ("v0.1.0", "stable"),
        ] {
            let result = version("0.1.0", Some(tag), Some("abcdef0"));
            assert_eq!(result.0, tag.trim_start_matches('v'));
            assert_eq!(result.1, channel);
        }
        assert_eq!(
            version("0.1.0", Some("not-a-version"), None).1,
            "development"
        );
    }
}
