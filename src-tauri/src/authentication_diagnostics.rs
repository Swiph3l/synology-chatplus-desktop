//! Bounded Windows authentication observer. No URL, request/response content,
//! header, account or service
//! identifier enters this module's history. Nothing is written to disk. Only the
//! existing local About/settings diagnostics commands can read or explicitly
//! copy this bounded memory ring.
use crate::providers::{ProviderId, ServiceConfig};
use serde::Serialize;
use std::{collections::VecDeque, sync::Mutex};
use tauri::Manager;

const LIMIT: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Origin {
    Google,
    Facebook,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Stage {
    GoogleOauthEntry,
    GoogleOauthContinuation,
    GoogleCookieCheck,
    GoogleConnectionCheck,
    GoogleInfoError,
    GoogleSignin,
    GoogleChallenge,
    GoogleRpc,
    GoogleOther,
    FacebookCheckpoint,
    FacebookOauthCallback,
    FacebookMessages,
    FacebookOther,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
struct RequiredParameters {
    client_id: bool,
    redirect_uri: bool,
    response_type: bool,
    scope: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
struct Destination {
    origin: Origin,
    stage: Stage,
    #[serde(skip_serializing_if = "Option::is_none")]
    oauth_required_parameters_present: Option<RequiredParameters>,
}

/// The input is discarded after classification. Presence flags are meaningful
/// only on the two initial OAuth endpoints, not on opaque sign-in continuations.
fn classify(provider: ProviderId, raw: &str) -> Option<Destination> {
    if provider != ProviderId::Messenger || raw.len() > 65_536 {
        return None;
    }
    let url = url::Url::parse(raw).ok()?;
    if url.scheme() != "https"
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let path = url.path().trim_end_matches('/');
    let (origin, stage) = match url.host_str()? {
        "accounts.google.com" => (
            Origin::Google,
            if matches!(path, "/o/oauth2/auth" | "/o/oauth2/v2/auth") {
                Stage::GoogleOauthEntry
            } else if path.starts_with("/o/oauth2/") {
                Stage::GoogleOauthContinuation
            } else if path == "/CheckCookie" {
                Stage::GoogleCookieCheck
            } else if path == "/CheckConnection" {
                Stage::GoogleConnectionCheck
            } else if path == "/info/unknownerror" {
                Stage::GoogleInfoError
            } else if path.starts_with("/_/") {
                Stage::GoogleRpc
            } else if path.starts_with("/v3/signin/challenge/")
                || path.starts_with("/v2/signin/challenge/")
                || path.starts_with("/signin/v2/challenge/")
                || path.starts_with("/signin/challenge/")
            {
                Stage::GoogleChallenge
            } else if path.starts_with("/v3/signin/")
                || path.starts_with("/v2/signin/")
                || path.starts_with("/signin/")
                || matches!(path, "/ServiceLogin" | "/AccountChooser")
            {
                Stage::GoogleSignin
            } else {
                Stage::GoogleOther
            },
        ),
        "www.facebook.com" => (
            Origin::Facebook,
            if path == "/checkpoint" || path.starts_with("/checkpoint/") {
                Stage::FacebookCheckpoint
            } else if matches!(path, "/connect/login_success.html" | "/oauth/callback") {
                Stage::FacebookOauthCallback
            } else if path == "/messages" || path.starts_with("/messages/") {
                Stage::FacebookMessages
            } else {
                Stage::FacebookOther
            },
        ),
        _ => return None,
    };
    let oauth_required_parameters_present = (stage == Stage::GoogleOauthEntry).then(|| {
        let mut flags = RequiredParameters::default();
        for (name, _) in url.query_pairs() {
            match name.as_ref() {
                "client_id" => flags.client_id = true,
                "redirect_uri" => flags.redirect_uri = true,
                "response_type" => flags.response_type = true,
                "scope" => flags.scope = true,
                _ => {}
            }
        }
        flags
    });
    Some(Destination {
        origin,
        stage,
        oauth_required_parameters_present,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum EventKind {
    NavigationStarted,
    NavigationCompleted,
    Response,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Method {
    Get,
    Post,
    Other,
}

fn method(raw: &str) -> Method {
    if raw.eq_ignore_ascii_case("GET") {
        Method::Get
    } else if raw.eq_ignore_ascii_case("POST") {
        Method::Post
    } else {
        Method::Other
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Transport {
    Success,
    Unknown,
    Certificate,
    Unreachable,
    Timeout,
    InvalidResponse,
    Connection,
    Dns,
    Canceled,
    Redirect,
    AuthenticationRequired,
    Other,
}

// Numeric values are the fixed WebView2 WEB_ERROR_STATUS enumeration, never a
// provider-supplied error string. Unknown future values remain a single bucket.
fn transport(success: bool, code: i32) -> Transport {
    if success {
        return Transport::Success;
    }
    match code {
        0 => Transport::Unknown,
        1..=5 => Transport::Certificate,
        6 => Transport::Unreachable,
        7 => Transport::Timeout,
        8 => Transport::InvalidResponse,
        9..=12 => Transport::Connection,
        13 => Transport::Dns,
        14 => Transport::Canceled,
        15 => Transport::Redirect,
        17 | 18 => Transport::AuthenticationRequired,
        _ => Transport::Other,
    }
}

fn http_status(code: i32) -> Option<u16> {
    (100..=599).contains(&code).then_some(code as u16)
}

#[derive(Clone, Copy, Debug, Serialize)]
struct Event {
    kind: EventKind,
    #[serde(flatten)]
    destination: Destination,
    #[serde(skip_serializing_if = "Option::is_none")]
    method: Option<Method>,
    #[serde(skip_serializing_if = "Option::is_none")]
    http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    transport: Option<Transport>,
}

fn response_event(destination: Destination, code: i32) -> Option<Event> {
    let status = http_status(code);
    // Unknown routes can contain the actual server rejection. Keep their
    // error status without retaining a path or flooding the ring with assets.
    if matches!(destination.stage, Stage::GoogleOther | Stage::FacebookOther)
        && !status.is_some_and(|value| value >= 400)
    {
        return None;
    }
    Some(Event {
        kind: EventKind::Response,
        destination,
        method: None,
        http_status: status,
        transport: None,
    })
}

#[derive(Default)]
pub struct History(Mutex<VecDeque<Event>>);

impl History {
    fn push(&self, event: Event) {
        let mut events = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if events.len() == LIMIT {
            events.pop_front();
        }
        events.push_back(event);
    }

    fn json(&self) -> serde_json::Value {
        let events = self.0.lock().unwrap_or_else(|error| error.into_inner());
        serde_json::to_value(&*events).unwrap_or_else(|_| serde_json::json!([]))
    }

    fn append_report(&self, report: &mut String) {
        report.push_str(
            "\nAuthentication diagnostics (last 64 content-free events; Windows observer):\n",
        );
        report.push_str(&serde_json::to_string_pretty(&self.json()).unwrap_or_default());
    }
}

fn record(app: &tauri::AppHandle, event: Event) {
    if let Some(history) = app.try_state::<History>() {
        history.push(event);
    }
}

/// Used only by the existing local About/settings diagnostics commands.
/// Its value has exactly the same fixed event schema as the explicit copy report.
pub fn snapshot_json(app: &tauri::AppHandle) -> serde_json::Value {
    app.try_state::<History>()
        .map(|history| history.json())
        .unwrap_or_else(|| serde_json::json!([]))
}

pub fn append_report(app: &tauri::AppHandle, report: &mut String) {
    if let Some(history) = app.try_state::<History>() {
        history.append_report(report);
    }
}

#[cfg(windows)]
pub fn attach(app: &tauri::AppHandle, view: &tauri::Webview, service: &ServiceConfig) {
    use std::sync::Arc;
    use webview2_com::{
        CoTaskMemPWSTR,
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2NavigationCompletedEventArgs2, ICoreWebView2_2,
        },
        NavigationCompletedEventHandler, NavigationStartingEventHandler,
        WebResourceResponseReceivedEventHandler,
    };
    use windows::core::{Interface, PWSTR};
    if service.provider != ProviderId::Messenger {
        return;
    }
    let app = app.clone();
    let service = service.clone();
    // Registration/property failures are intentionally ignored. Observation must
    // neither fail authentication nor change native cancellation/handled flags.
    let _ = view.with_webview(move |view| unsafe {
        let Ok(core) = view.controller().CoreWebView2() else {
            return;
        };
        // Only the latest navigation is retained; an older completion cannot be
        // attributed to its replacement. The retained value contains no URL.
        let current = Arc::new(Mutex::new(None::<(u64, Destination)>));
        let start_current = current.clone();
        let start_app = app.clone();
        let start_service = service.clone();
        let _ = core.add_NavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(move |_, args| {
                let _ = (|| -> windows::core::Result<()> {
                    let Some(args) = args else { return Ok(()) };
                    if !crate::services::configured(&start_app, &start_service) {
                        return Ok(());
                    }
                    let mut uri = PWSTR::null();
                    args.Uri(&mut uri)?;
                    let destination = classify(
                        start_service.provider,
                        &CoTaskMemPWSTR::from(uri).to_string(),
                    );
                    let mut id = 0;
                    args.NavigationId(&mut id)?;
                    *start_current
                        .lock()
                        .unwrap_or_else(|error| error.into_inner()) =
                        destination.map(|value| (id, value));
                    if let Some(destination) = destination {
                        record(
                            &start_app,
                            Event {
                                kind: EventKind::NavigationStarted,
                                destination,
                                method: None,
                                http_status: None,
                                transport: None,
                            },
                        );
                    }
                    Ok(())
                })();
                Ok(())
            })),
            &mut 0,
        );
        let complete_app = app.clone();
        let complete_service = service.clone();
        let _ = core.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |_, args| {
                let _ = (|| -> windows::core::Result<()> {
                    let Some(args) = args else { return Ok(()) };
                    if !crate::services::configured(&complete_app, &complete_service) {
                        return Ok(());
                    }
                    let mut id = 0;
                    args.NavigationId(&mut id)?;
                    let destination = *current.lock().unwrap_or_else(|error| error.into_inner());
                    let Some((expected, destination)) = destination else {
                        return Ok(());
                    };
                    if id != expected {
                        return Ok(());
                    }
                    let mut success = Default::default();
                    args.IsSuccess(&mut success)?;
                    let mut error = Default::default();
                    let _ = args.WebErrorStatus(&mut error);
                    let status = args
                        .cast::<ICoreWebView2NavigationCompletedEventArgs2>()
                        .ok()
                        .and_then(|args| {
                            let mut status = 0;
                            args.HttpStatusCode(&mut status)
                                .ok()
                                .and_then(|_| http_status(status))
                        });
                    record(
                        &complete_app,
                        Event {
                            kind: EventKind::NavigationCompleted,
                            destination,
                            method: None,
                            http_status: status,
                            transport: Some(transport(success.as_bool(), error.0)),
                        },
                    );
                    Ok(())
                })();
                Ok(())
            })),
            &mut 0,
        );
        let Ok(extended) = core.cast::<ICoreWebView2_2>() else {
            return;
        };
        let _ = extended.add_WebResourceResponseReceived(
            &WebResourceResponseReceivedEventHandler::create(Box::new(move |_, args| {
                let _ = (|| -> windows::core::Result<()> {
                    let Some(args) = args else { return Ok(()) };
                    if !crate::services::configured(&app, &service) {
                        return Ok(());
                    }
                    let request = args.Request()?;
                    let mut uri = PWSTR::null();
                    request.Uri(&mut uri)?;
                    let Some(destination) =
                        classify(service.provider, &CoTaskMemPWSTR::from(uri).to_string())
                    else {
                        return Ok(());
                    };
                    let response = args.Response()?;
                    let mut status = 0;
                    response.StatusCode(&mut status)?;
                    let Some(mut event) = response_event(destination, status) else {
                        return Ok(());
                    };
                    let mut verb = PWSTR::null();
                    if request.Method(&mut verb).is_ok() {
                        event.method = Some(method(&CoTaskMemPWSTR::from(verb).to_string()));
                    }
                    record(&app, event);
                    Ok(())
                })();
                Ok(())
            })),
            &mut 0,
        );
    });
}

#[cfg(not(windows))]
pub fn attach(_: &tauri::AppHandle, _: &tauri::Webview, _: &ServiceConfig) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(raw: &str) -> Event {
        Event {
            kind: EventKind::Response,
            destination: classify(ProviderId::Messenger, raw).unwrap(),
            method: Some(method("POST")),
            http_status: http_status(400),
            transport: Some(transport(true, 0)),
        }
    }

    #[test]
    fn private_url_material_never_enters_exported_event_or_field_names() {
        let secret = "SYNTHETIC_PRIVATE_SENTINEL";
        for raw in [
            format!("https://accounts.google.com/o/oauth2/v2/auth?client_id={secret}&redirect_uri=https%3A%2F%2Fprivate.example%2F{secret}&response_type=code&scope={secret}&{secret}={secret}&state={secret}#{secret}"),
            format!("https://accounts.google.com/v3/signin/challenge/{secret}?Email={secret}&Password={secret}"),
            format!("https://accounts.google.com/_/signin/data/batchexecute?f.req={secret}"),
            format!("https://accounts.google.com/CheckCookie?continue={secret}#{secret}"),
            format!("https://accounts.google.com/CheckConnection?{secret}={secret}"),
            format!("https://accounts.google.com/o/oauth2/continuation/{secret}?state={secret}"),
            format!("https://accounts.google.com/info/unknownerror?error={secret}"),
            format!("https://accounts.google.com/unrecognized/{secret}?Email={secret}"),
            format!("https://www.facebook.com/messages/t/{secret}?code={secret}"),
            format!("https://www.facebook.com/checkpoint/{secret}?state={secret}"),
            format!("https://www.facebook.com/connect/login_success.html?access_token={secret}"),
        ] {
            let history = History::default();
            history.push(event(&raw));
            let exported = history.json();
            let value = &exported[0];
            let json = value.to_string();
            let mut report = String::new();
            history.append_report(&mut report);
            for forbidden in [secret, "https", "private.example", "Email", "Password", "access_token", "f.req", "state", "code="] {
                assert!(!json.contains(forbidden), "Unexpected private material: {forbidden}");
                assert!(!report.contains(forbidden), "Unexpected private material in report: {forbidden}");
            }
            let allowed = ["kind", "origin", "stage", "method", "http_status", "transport", "oauth_required_parameters_present"];
            assert!(value.as_object().unwrap().keys().all(|key| allowed.contains(&key.as_str())));
            if let Some(flags) = value.get("oauth_required_parameters_present") {
                assert!(flags.as_object().unwrap().iter().all(|(name, flag)| ["client_id", "redirect_uri", "response_type", "scope"].contains(&name.as_str()) && flag.is_boolean()));
            }
        }
    }

    #[test]
    fn observer_scope_is_exact_messenger_https_account_origins() {
        for raw in [
            "http://accounts.google.com/",
            "https://accounts.google.com:444/",
            "https://accounts.google.com.evil.example/",
            "https://google.com/",
            "https://facebook.com/",
            "https://m.facebook.com/",
            "https://user:secret@accounts.google.com/",
            "blob:https://accounts.google.com/secret",
            "data:text/html,secret",
        ] {
            assert!(classify(ProviderId::Messenger, raw).is_none(), "{raw}");
        }
        for provider in [
            ProviderId::SynologyChatplus,
            ProviderId::SynologyChat,
            ProviderId::Slack,
            ProviderId::Discord,
            ProviderId::Whatsapp,
            ProviderId::Mattermost,
        ] {
            assert!(classify(provider, "https://accounts.google.com/").is_none());
            assert!(classify(provider, "https://www.facebook.com/").is_none());
        }
    }

    #[test]
    fn required_parameter_flags_apply_only_to_initial_oauth_entry() {
        let entry = classify(ProviderId::Messenger, "https://accounts.google.com:443/o/oauth2/v2/auth?client_id=secret&scope=secret&unknown=secret").unwrap();
        assert_eq!(
            entry.oauth_required_parameters_present,
            Some(RequiredParameters {
                client_id: true,
                scope: true,
                ..Default::default()
            })
        );
        let continuation = classify(
            ProviderId::Messenger,
            "https://accounts.google.com/v3/signin/identifier?client_id=secret",
        )
        .unwrap();
        assert_eq!(continuation.stage, Stage::GoogleSignin);
        assert_eq!(continuation.oauth_required_parameters_present, None);
        assert_eq!(
            classify(
                ProviderId::Messenger,
                "https://accounts.google.com/v3/signin/challenge/pwd"
            )
            .unwrap()
            .stage,
            Stage::GoogleChallenge
        );
    }

    #[test]
    fn ring_is_bounded_and_metadata_remains_allowlisted() {
        let history = History::default();
        for status in 100..180 {
            let mut value = event("https://accounts.google.com/v3/signin/identifier");
            value.http_status = http_status(status);
            history.push(value);
        }
        let events = history.0.lock().unwrap();
        assert_eq!(events.len(), LIMIT);
        assert_eq!(events.front().unwrap().http_status, Some(116));
        assert_eq!(events.back().unwrap().http_status, Some(179));
        assert_eq!(method("get"), Method::Get);
        assert_eq!(method("SYNTHETIC_SECRET"), Method::Other);
        assert_eq!(http_status(-1), None);
        assert_eq!(http_status(600), None);
        assert_eq!(transport(false, 13), Transport::Dns);
        assert_eq!(transport(false, 123456), Transport::Other);
    }

    #[test]
    fn unknown_route_errors_are_retained_without_success_asset_noise() {
        for raw in [
            "https://accounts.google.com/unrecognized/private-token?Email=private-value",
            "https://www.facebook.com/unrecognized/private-token?state=private-value",
        ] {
            let destination = classify(ProviderId::Messenger, raw).unwrap();
            for code in [400, 403, 500] {
                let event = response_event(destination, code).unwrap();
                assert_eq!(event.kind, EventKind::Response);
                assert_eq!(event.http_status, Some(code as u16));
                let json = serde_json::to_string(&event).unwrap();
                assert!(!json.contains("private"));
                assert!(!json.contains("unrecognized"));
            }
            for code in [0, 200, 204, 301, 302] {
                assert!(response_event(destination, code).is_none());
            }
        }
        let signin = classify(
            ProviderId::Messenger,
            "https://accounts.google.com/v3/signin/identifier",
        )
        .unwrap();
        assert!(response_event(signin, 200).is_some());
    }

    #[test]
    fn fixed_google_continuation_and_cookie_routes_have_only_coarse_labels() {
        for (path, stage) in [
            ("/CheckCookie", Stage::GoogleCookieCheck),
            ("/CheckConnection", Stage::GoogleConnectionCheck),
            ("/o/oauth2/continuation", Stage::GoogleOauthContinuation),
            ("/info/unknownerror", Stage::GoogleInfoError),
        ] {
            let destination = classify(
                ProviderId::Messenger,
                &format!("https://accounts.google.com{path}?private=private-value"),
            )
            .unwrap();
            assert_eq!(destination.stage, stage);
            assert_eq!(destination.oauth_required_parameters_present, None);
            assert!(response_event(destination, 200).is_some());
            assert!(!serde_json::to_string(&destination)
                .unwrap()
                .contains("private"));
        }
        for path in [
            "/CheckCookie/private-token",
            "/CheckConnection/private-token",
            "/info/unknownerror/private-token",
        ] {
            assert_eq!(
                classify(
                    ProviderId::Messenger,
                    &format!("https://accounts.google.com{path}")
                )
                .unwrap()
                .stage,
                Stage::GoogleOther
            );
        }
    }
}
