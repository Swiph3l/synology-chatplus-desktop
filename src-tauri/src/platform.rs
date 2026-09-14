/// WebView2 provides reliable transport completion; generic Tauri page-finished
/// events on other platforms cannot distinguish a server document from an error page.
#[cfg(windows)]
pub fn observe_connection(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
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
    window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            connection::set(&app, Connection::Unknown);
            return;
        };
        let handler_app = app.clone();
        let result = core.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut success = Default::default();
                    args.IsSuccess(&mut success)?;
                    let state = if success.as_bool() {
                        crate::desktop_notifications::begin_tracking(&handler_app);
                        Connection::Connected
                    } else {
                        crate::desktop_notifications::pause_tracking(&handler_app);
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
                    connection::set(&handler_app, state);
                }
                Ok(())
            })),
            &mut 0,
        );
        if result.is_err() {
            connection::set(&app, Connection::Unknown);
        }
    })
}
#[cfg(not(windows))]
pub fn observe_connection(_: &tauri::AppHandle, _: &tauri::WebviewWindow) -> tauri::Result<()> {
    Ok(())
}
