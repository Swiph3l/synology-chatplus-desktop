use url::Url;

pub fn local_settings(url: &Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let origin = url.origin().ascii_serialization();
    (url.scheme() == "tauri" && url.host_str() == Some("localhost") && url.port().is_none())
        || (url.scheme() == "http"
            && (origin == "http://tauri.localhost"
                || (cfg!(debug_assertions) && origin == "http://127.0.0.1:1420")))
}

/// Display metadata for a pending external-link confirmation, not authorization
/// to launch it. Full URLs may contain private query values and must not be logged.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExternalTarget {
    pub url: String,
    pub origin: String,
    pub host: String,
    pub insecure_http: bool,
}

/// Only ordinary credential-free web URLs may reach the browser confirmation.
/// Blob/authenticated attachments remain in the originating WebView profile.
pub fn external_target(target: &Url) -> Option<ExternalTarget> {
    if !matches!(target.scheme(), "http" | "https")
        || !target.username().is_empty()
        || target.password().is_some()
    {
        return None;
    }
    let host = target.host_str()?.to_owned();
    // Swiph3l: URL serialization normally encodes these already. Enforce an ASCII URI
    // display even if that behavior changes: never decode percent escapes or
    // allow literal Unicode direction/control characters to disguise the target.
    let mut url = String::new();
    for character in target.as_str().chars() {
        if character.is_ascii() && !character.is_control() {
            url.push(character);
        } else {
            for byte in character.to_string().bytes() {
                use std::fmt::Write;
                let _ = write!(url, "%{byte:02X}");
            }
        }
    }
    Some(ExternalTarget {
        url,
        origin: target.origin().ascii_serialization(),
        host,
        insecure_http: target.scheme() == "http",
    })
}

pub fn same_server(target: &Url, configured: &url::Origin) -> bool {
    matches!(target.scheme(), "http" | "https")
        && target.origin() == *configured
        && target.username().is_empty()
        && target.password().is_none()
}

/// Main provider navigation may reach its own blob attachments before WebView2
/// recognizes a download. CDN previews belong in a related attachment popup,
/// never in the main service document or the operating-system URL opener.
pub fn provider_document(service: &crate::providers::ServiceConfig, target: &Url) -> bool {
    if service.provider.allows(&service.url, target) {
        return true;
    }
    target.scheme() == "blob" && crate::downloads::attachment_popup(service, target)
}

/// External anchor clicks may request confirmation, but may not take ownership
/// of provider navigation or authenticated attachment popups.
pub fn external_anchor_target(
    service: &crate::providers::ServiceConfig,
    target: &Url,
) -> Option<ExternalTarget> {
    if provider_document(service, target) || crate::downloads::attachment_popup(service, target) {
        return None;
    }
    external_target(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn provider_service(
        provider: crate::providers::ProviderId,
        url: &str,
    ) -> crate::providers::ServiceConfig {
        crate::providers::ServiceConfig {
            id: "provider-account".into(),
            provider,
            name: "Provider account".into(),
            url: url.into(),
            enabled: true,
            notifications: true,
            notification_color: crate::providers::NotificationColor::Auto,
        }
    }
    #[test]
    fn locks_navigation_to_exact_origin() {
        let origin = Url::parse("https://nas.example.com/chat/")
            .unwrap()
            .origin();
        assert!(same_server(
            &Url::parse("https://nas.example.com/chat/thread/?id=1").unwrap(),
            &origin
        ));
        for target in [
            "http://nas.example.com/chat/",
            "https://nas.example.com:8443/chat/",
            "https://nas.example.com.evil.example/",
            "https://other.example.com/",
            "file:///tmp",
            "https://user:secret@nas.example.com/",
        ] {
            assert!(!same_server(&Url::parse(target).unwrap(), &origin));
        }
    }
    #[test]
    fn remote_pages_are_not_local_settings() {
        for target in [
            "https://example.com/",
            "http://tauri.localhost.evil.example/",
            "tauri://evil/",
            "tauri://localhost:1234/index.html",
            "tauri://user@localhost/index.html",
            "http://user:secret@tauri.localhost/index.html",
            "blob:http://tauri.localhost/opaque-id",
            "blob:http://127.0.0.1:1420/opaque-id",
            "https://tauri.localhost/index.html",
        ] {
            assert!(!local_settings(&Url::parse(target).unwrap()));
        }
    }
    #[test]
    fn local_settings_accept_only_real_app_and_debug_server_routes() {
        for target in [
            "tauri://localhost/index.html?page=settings",
            "http://tauri.localhost/index.html?page=services",
        ] {
            assert!(local_settings(&Url::parse(target).unwrap()));
        }
        assert_eq!(
            local_settings(&Url::parse("http://127.0.0.1:1420/index.html").unwrap()),
            cfg!(debug_assertions)
        );
    }
    #[test]
    fn external_confirmation_preserves_exact_target_and_separates_host_origin_and_http() {
        let url = Url::parse("https://downloads.example.com:8443/a%20b.pdf?signature=x%2Fy&next=https%3A%2F%2Fevil.example#page=2").unwrap();
        let target = external_target(&url).unwrap();
        assert_eq!(target.url, url.as_str());
        assert_eq!(target.host, "downloads.example.com");
        assert_eq!(target.origin, "https://downloads.example.com:8443");
        assert!(!target.insecure_http);
        let http = external_target(&Url::parse("http://127.0.0.1:8080/file").unwrap()).unwrap();
        assert!(http.insecure_http);
        assert_eq!(http.origin, "http://127.0.0.1:8080");
        let ipv6 = external_target(&Url::parse("https://[::1]:8443/file").unwrap()).unwrap();
        assert_eq!(ipv6.host, "[::1]");
        assert_eq!(ipv6.origin, "https://[::1]:8443");
    }
    #[test]
    fn external_confirmation_displays_idn_and_directional_text_as_ascii_uri() {
        let target = external_target(
            &Url::parse("https://b\u{00fc}cher.example/\u{00dc}berblick/\u{202e}fdp.exe?q=\u{2066}value\u{2069}#\u{0001}").unwrap(),
        ).unwrap();
        assert_eq!(target.host, "xn--bcher-kva.example");
        assert_eq!(target.origin, "https://xn--bcher-kva.example");
        assert!(target.url.is_ascii());
        assert!(target.url.contains("%E2%80%AE"));
        assert!(target.url.contains("%E2%81%A6"));
        assert!(target.url.contains("%E2%81%A9"));
        assert!(!target.url.chars().any(char::is_control));
        let confusable =
            external_target(&Url::parse("https://www.paypa\u{043b}.com/").unwrap()).unwrap();
        assert!(confusable.host.contains("xn--"));
        assert_ne!(confusable.host, "www.paypal.com");
    }
    #[test]
    fn external_confirmation_never_authorizes_credentials_or_non_browser_schemes() {
        for value in [
            "https://user:secret@example.com/file",
            "https://trusted.example@evil.example/",
            "http://:secret@example.com/",
            "file:///C:/Windows/System32/cmd.exe",
            "javascript:alert(1)",
            "data:text/html,hello",
            "blob:https://example.com/attachment",
            "about:blank",
            "tauri://localhost/index.html",
            "ms-settings:notifications",
            "mailto:person@example.com",
            "tel:+1234",
            "ftp://example.com/file",
        ] {
            assert!(
                external_target(&Url::parse(value).unwrap()).is_none(),
                "{value}"
            );
        }
    }
    #[test]
    fn external_download_and_auth_urls_are_not_rewritten_or_classified_by_extension() {
        for value in [
            "https://example.com/login?client_id=app&redirect_uri=https%3A%2F%2Fnas.example%2Fcallback&state=signed%2Bstate",
            "https://cdn.example.com/file.pdf?signature=one%2Ftwo%3D",
            "https://cdn.example.com/download?filename=report.pdf#section",
            "https://cdn.example.com/no-extension?token=opaque",
        ] {
            let parsed = Url::parse(value).unwrap();
            assert_eq!(external_target(&parsed).unwrap().url, parsed.as_str());
        }
    }
    #[test]
    fn provider_document_preserves_provider_routes_and_same_origin_blob_download_navigation() {
        use crate::providers::ProviderId;
        for (provider, configured, route, blob) in [
            (
                ProviderId::SynologyChatplus,
                "https://nas.example.com/chat/",
                "https://nas.example.com/oauth/callback?code=opaque&state=signed",
                "blob:https://nas.example.com/attachment-id",
            ),
            (
                ProviderId::Discord,
                "https://discord.com/app/",
                "https://discord.com/channels/@me",
                "blob:https://discord.com/attachment-id",
            ),
            (
                ProviderId::Whatsapp,
                "https://web.whatsapp.com/",
                "https://web.whatsapp.com/",
                "blob:https://web.whatsapp.com/attachment-id",
            ),
            (
                ProviderId::Messenger,
                "https://www.facebook.com/messages/",
                "https://www.facebook.com/checkpoint/?next=%2Fmessages",
                "blob:https://www.facebook.com/attachment-id",
            ),
        ] {
            let service = provider_service(provider, configured);
            assert!(provider_document(&service, &Url::parse(route).unwrap()));
            assert!(provider_document(&service, &Url::parse(blob).unwrap()));
        }
        let local = provider_service(ProviderId::Mattermost, "http://127.0.0.1:8065/");
        assert!(provider_document(
            &local,
            &Url::parse("blob:http://127.0.0.1:8065/attachment-id").unwrap()
        ));
    }
    #[test]
    fn provider_document_denies_foreign_or_opaque_blob_and_unsupported_or_credentialed_targets() {
        let service = provider_service(
            crate::providers::ProviderId::SynologyChatplus,
            "https://nas.example.com/chat/",
        );
        for value in [
            "blob:null/attachment-id",
            "blob:https://other.example.com/attachment-id",
            "blob:https://nas.example.com.evil.example/attachment-id",
            "blob:http://nas.example.com/attachment-id",
            "blob:https://nas.example.com:8443/attachment-id",
            "blob:https://user:secret@nas.example.com/attachment-id",
            "blob:https://user@nas.example.com/attachment-id",
            "https://user:secret@nas.example.com/attachment",
            "data:application/octet-stream,attachment",
            "file:///C:/attachment.pdf",
            "javascript:alert(1)",
            "about:blank",
            "https://other.example.com/attachment.pdf",
        ] {
            assert!(
                !provider_document(&service, &Url::parse(value).unwrap()),
                "{value}"
            );
        }
    }
    #[test]
    fn provider_document_never_promotes_attachment_cdn_allowance_to_main_service_origin() {
        let service = provider_service(
            crate::providers::ProviderId::Discord,
            "https://discord.com/app/",
        );
        for value in [
            "https://cdn.discordapp.com/attachments/1/2/report.pdf?ex=signed",
            "https://media.discordapp.net/attachments/1/2/photo.png",
        ] {
            let target = Url::parse(value).unwrap();
            assert!(crate::downloads::attachment_popup(&service, &target));
            assert!(!provider_document(&service, &target));
        }
    }
}
