//! Browser notification events through WebView2; no remote Tauri IPC capability.
pub async fn permission_state(app: &tauri::AppHandle) -> String {
    #[cfg(windows)]
    {
        use tauri::Manager;
        use windows::core::w;
        let Some(window) = app.get_webview_window("main") else {
            return "unavailable".into();
        };
        let (tx, rx) = tokio::sync::oneshot::channel();
        if window.with_webview(move |view| unsafe {
            if let Ok(core) = view.controller().CoreWebView2() {
                let _ = core.ExecuteScript(w!("typeof Notification === 'undefined' ? 'unavailable' : Notification.permission"),
                    &webview2_com::ExecuteScriptCompletedHandler::create(Box::new(move |status, value| {
                        let value = if status.is_ok() { serde_json::from_str::<String>(&value).unwrap_or_default() } else { "unknown".into() };
                        let _ = tx.send(value);
                        Ok(())
                    })));
            }
        }).is_ok() {
            if let Ok(Ok(value)) = tokio::time::timeout(std::time::Duration::from_secs(2), rx).await { return value; }
        }
    }
    let _ = app;
    "unknown".into()
}

// Called only by the explicit local Enable notifications action, after OS access
// was checked. Grants only the configured origin; never changes Windows policy.
pub async fn enable_permission(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use windows::core::{Interface, HSTRING};
        let window = app
            .get_webview_window("main")
            .ok_or("Open ChatPlus first, then enable notifications.")?;
        let server = crate::state::current(app).server_url;
        let origin = url::Url::parse(&server)
            .map_err(|_| "Configure your ChatPlus server first.")?
            .origin()
            .ascii_serialization();
        let (tx, rx) = tokio::sync::oneshot::channel();
        window
            .with_webview(move |view| unsafe {
                let result = (|| -> windows::core::Result<()> {
                    let core = view
                        .controller()
                        .CoreWebView2()?
                        .cast::<ICoreWebView2_13>()?;
                    let profile = core.Profile()?.cast::<ICoreWebView2Profile4>()?;
                    profile.SetPermissionState(
                        COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS,
                        &HSTRING::from(origin),
                        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                        &webview2_com::SetPermissionStateCompletedHandler::create(Box::new(
                            move |result| {
                                let _ = tx.send(result.is_ok());
                                Ok(())
                            },
                        )),
                    )
                })();
                let _ = result;
            })
            .map_err(|_| "Could not access WebView notification permission.")?;
        return match tokio::time::timeout(std::time::Duration::from_secs(2), rx).await {
            Ok(Ok(true)) => Ok(()),
            _ => Err("Could not enable WebView notifications. Check ChatPlus notification settings and restart the app.".into()),
        };
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(())
    }
}
pub fn trusted_origin(server: &str, sender: &str) -> bool {
    let (Ok(server), Ok(sender)) = (url::Url::parse(server), url::Url::parse(sender)) else {
        return false;
    };
    matches!(sender.scheme(), "http" | "https")
        && sender.username().is_empty()
        && sender.password().is_none()
        && server.origin() == sender.origin()
}

#[cfg(windows)]
pub fn attach(app: &tauri::AppHandle, window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use crate::desktop_notifications as notifications;
    use tauri::Manager;
    use webview2_com::{
        CoTaskMemPWSTR,
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_24, COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS,
            COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DENY,
        },
        NotificationReceivedEventHandler, PermissionRequestedEventHandler,
    };
    use windows::core::{Interface, PWSTR};
    let app = app.clone();
    window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let unread_app = app.clone();
        let _ = core.add_WebMessageReceived(
            &webview2_com::WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut source = PWSTR::null();
                args.Source(&mut source)?;
                let source = CoTaskMemPWSTR::from(source).to_string();
                if !trusted_origin(&crate::state::current(&unread_app).server_url, &source) {
                    return Ok(());
                }
                let mut json = PWSTR::null();
                args.TryGetWebMessageAsString(&mut json)?;
                let json = CoTaskMemPWSTR::from(json).to_string();
                if let Some(unread) = parse_unread(&json) {
                    crate::unread::publish_from(
                        &unread_app,
                        unread.count,
                        unread.has_unread,
                        unread.source,
                        &unread.reason,
                    );
                }
                Ok(())
            })),
            &mut 0,
        );
        let Ok(extended) = core.cast::<ICoreWebView2_24>() else {
            return;
        };
        let notify_app = app.clone();
        let registered = extended
            .add_NotificationReceived(
                &NotificationReceivedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else {
                        return Ok(());
                    };
                    // Own the event before any delivery attempt, including disabled/suppressed events.
                    // WebView must not also display an unfiltered duplicate notification.
                    args.SetHandled(true)?;
                    let mut sender = PWSTR::null();
                    args.SenderOrigin(&mut sender)?;
                    let sender = CoTaskMemPWSTR::from(sender).to_string();
                    if !trusted_origin(&crate::state::current(&notify_app).server_url, &sender) {
                        return Ok(());
                    }
                    let notification = args.Notification()?;
                    let mut value = PWSTR::null();
                    notification.Title(&mut value)?;
                    let title = CoTaskMemPWSTR::from(value).to_string();
                    let mut value = PWSTR::null();
                    notification.Body(&mut value)?;
                    let body = CoTaskMemPWSTR::from(value).to_string();
                    let mut value = PWSTR::null();
                    notification.Tag(&mut value)?;
                    let tag = CoTaskMemPWSTR::from(value).to_string();
                    if notifications::deliver(&notify_app, &title, &body, &tag) {
                        let _ = notification.ReportShown();
                    }
                    Ok(())
                })),
                &mut 0,
            )
            .is_ok();
        app.state::<notifications::Service>()
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .bridge_available = registered;
        if !registered {
            return;
        }
        let permission_app = app.clone();
        let _ = core.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut kind = Default::default();
                args.PermissionKind(&mut kind)?;
                if kind != COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS {
                    return Ok(());
                }
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                let uri = CoTaskMemPWSTR::from(uri).to_string();
                let settings = crate::state::current(&permission_app);
                let allow = settings.desktop_notifications
                    && trusted_origin(&settings.server_url, &uri)
                    && notifications::permission(&permission_app).granted;
                // The explicit saved desktop-notification preference authorizes this origin only.
                // Camera/microphone and other requests retain the normal WebView behavior.
                args.SetState(if allow {
                    COREWEBVIEW2_PERMISSION_STATE_ALLOW
                } else {
                    COREWEBVIEW2_PERMISSION_STATE_DENY
                })?;
                Ok(())
            })),
            &mut 0,
        );
    })
}

struct UnreadObservation {
    has_unread: bool,
    count: Option<u32>,
    source: crate::unread::Source,
    reason: String,
}

fn parse_unread(json: &str) -> Option<UnreadObservation> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Message {
        #[serde(default)]
        chatplus_unread: u8,
        unread: Option<bool>,
        has_unread: Option<bool>,
        count: Option<u32>,
        source: Option<String>,
        reason: Option<String>,
    }

    if json.len() > 512 {
        return None;
    }
    let value: Message = serde_json::from_str(json).ok()?;
    if value.chatplus_unread != 1 {
        return None;
    }
    let has_unread = value.has_unread.or(value.unread)?;
    let source = match value.source.as_deref() {
        Some("chatplus-dom") | None => crate::unread::Source::ChatPlusDom,
        Some("title-fallback") => crate::unread::Source::TitleFallback,
        _ => return None,
    };
    let reason = value.reason.unwrap_or_else(|| "event".into());
    if reason.len() > 120 {
        return None;
    }
    Some(UnreadObservation {
        has_unread,
        count: value.count,
        source,
        reason,
    })
}
#[cfg(not(windows))]
pub fn attach(_: &tauri::AppHandle, _: &tauri::WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unread_messages_are_boolean_only() {
        assert_eq!(
            parse_unread(r#"{"chatplusUnread":1,"unread":true}"#).map(|value| value.has_unread),
            Some(true)
        );
        assert_eq!(
            parse_unread(r#"{"chatplusUnread":1,"unread":false}"#).map(|value| value.has_unread),
            Some(false)
        );
        assert_eq!(
            parse_unread(
                r#"{"chatplusUnread":1,"hasUnread":true,"count":3,"source":"chatplus-dom","reason":"badge-created"}"#
            )
            .map(|value| (value.has_unread, value.count)),
            Some((true, Some(3)))
        );
        for value in [
            r#"{"chatplusUnread":1,"unread":"true"}"#,
            r#"{"chatplusUnread":1,"source":"unknown","unread":true}"#,
            "null",
            "{}",
        ] {
            assert!(parse_unread(value).is_none());
        }
    }
    #[test]
    fn events_require_exact_configured_origin() {
        assert!(trusted_origin(
            "https://nas.example.com/chat/",
            "https://nas.example.com/"
        ));
        for sender in [
            "https://nas.example.com.evil.example/",
            "http://nas.example.com/",
            "https://nas.example.com:8443/",
            "https://user:password@nas.example.com/",
            "file:///tmp/test",
            "null",
        ] {
            assert!(!trusted_origin("https://nas.example.com/chat/", sender));
        }
    }
}
