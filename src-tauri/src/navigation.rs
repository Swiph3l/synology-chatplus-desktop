use url::Url;

pub fn local_settings(url: &Url) -> bool {
    let origin = url.origin().ascii_serialization();
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || origin == "http://tauri.localhost"
        || (cfg!(debug_assertions) && origin == "http://127.0.0.1:1420")
}

pub fn same_server(target: &Url, configured: &url::Origin) -> bool {
    matches!(target.scheme(), "http" | "https")
        && target.origin() == *configured
        && target.username().is_empty()
        && target.password().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
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
        ] {
            assert!(!local_settings(&Url::parse(target).unwrap()));
        }
    }
}
