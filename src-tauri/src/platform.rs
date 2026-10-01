/// WebView2 provides reliable transport completion; generic Tauri page-finished
/// events on other platforms cannot distinguish a server document from an error page.
#[cfg(windows)]
pub fn observe_connection(
    app: &tauri::AppHandle,
    window: &tauri::Webview,
    service_id: &str,
) -> tauri::Result<()> {
    use crate::connection::{self, Connection};
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED,
            COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED,
        },
        NavigationCompletedEventHandler,
    };
    let app = app.clone();
    let service_id = service_id.to_string();
    window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            connection::set_for(&app, &service_id, Connection::Unknown);
            return;
        };
        let handler_app = app.clone();
        let handler_id = service_id.clone();
        let result = core.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut success = Default::default();
                    args.IsSuccess(&mut success)?;
                    let state = if success.as_bool() {
                        crate::desktop_notifications::begin_tracking_for(&handler_app, &handler_id);
                        Connection::Connected
                    } else {
                        crate::desktop_notifications::pause_tracking_for(&handler_app, &handler_id);
                        let mut status = Default::default();
                        args.WebErrorStatus(&mut status)?;
                        if status == COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED {
                            return Ok(());
                        }
                        if status == COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED {
                            Connection::Offline
                        } else {
                            Connection::Error
                        }
                    };
                    connection::set_for(&handler_app, &handler_id, state);
                }
                Ok(())
            })),
            &mut 0,
        );
        if result.is_err() {
            connection::set_for(&app, &service_id, Connection::Unknown);
        }
    })
}
#[cfg(not(windows))]
pub fn observe_connection(_: &tauri::AppHandle, _: &tauri::Webview, _: &str) -> tauri::Result<()> {
    Ok(())
}
