//! Attachment transfers stay in WebView2, including provider cookies and Windows download protection.
use crate::providers::{ProviderId, ServiceConfig};
use tauri::{AppHandle, Webview};

#[cfg(windows)]
use std::sync::{Mutex, OnceLock};
#[cfg(any(windows, test))]
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

#[cfg(any(windows, test))]
const MAX_FILENAME_UNITS: usize = 224;

#[cfg(any(windows, test))]
fn decode_filename(value: &str) -> String {
    let mut decoded = Vec::with_capacity(value.len());
    let mut bytes = value.bytes().peekable();
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let mut escaped = bytes.clone();
            if let (Some(high), Some(low)) = (escaped.next(), escaped.next()) {
                if let (Some(high), Some(low)) =
                    ((high as char).to_digit(16), (low as char).to_digit(16))
                {
                    decoded.push((high * 16 + low) as u8);
                    bytes = escaped;
                    continue;
                }
            }
        }
        decoded.push(byte);
    }
    String::from_utf8(decoded).unwrap_or_else(|_| value.into())
}

#[cfg(any(windows, test))]
fn truncate_units(value: &str, limit: usize) -> String {
    let mut used = 0;
    value
        .chars()
        .take_while(|character| {
            used += character.len_utf16();
            used <= limit
        })
        .collect()
}

#[cfg(any(windows, test))]
fn filename_parts(value: &str) -> (&str, &str) {
    match value.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() && !extension.is_empty() => {
            (stem, &value[stem.len()..])
        }
        _ => (value, ""),
    }
}

#[cfg(any(windows, test))]
fn safe_filename(value: &str) -> Result<String, &'static str> {
    let decoded = decode_filename(value);
    let cleaned: String = decoded
        .chars()
        .map(|character| {
            // Swiph3l: Encoded separators, Windows device syntax and bidi controls must
            // not turn a provider-suggested name into another path or disguise its extension.
            if character.is_control()
                || matches!(character,
            '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*' | '\u{061c}' |
            '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    let cleaned = cleaned.trim_end_matches([' ', '.']).trim_start_matches(' ');
    let mut cleaned = if cleaned.is_empty() {
        "attachment".into()
    } else {
        cleaned.to_owned()
    };
    let device = cleaned
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end()
        .to_uppercase();
    let reserved = matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            device.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        });
    if reserved {
        cleaned.insert(0, '_');
    }
    let (stem, extension) = filename_parts(&cleaned);
    let extension_units = extension.encode_utf16().count();
    if extension_units >= MAX_FILENAME_UNITS {
        return Err("filename-too-long");
    }
    Ok(format!(
        "{}{}",
        truncate_units(stem, MAX_FILENAME_UNITS - extension_units),
        extension
    ))
}

#[cfg(any(windows, test))]
#[derive(Default)]
struct Names(HashSet<String>);

#[cfg(any(windows, test))]
fn path_key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

#[cfg(any(windows, test))]
impl Names {
    fn reserve(
        &mut self,
        destination: &Path,
        mut exists: impl FnMut(&Path) -> std::io::Result<bool>,
    ) -> Result<PathBuf, &'static str> {
        let parent = destination
            .parent()
            .filter(|parent| parent.is_absolute())
            .ok_or("destination-unavailable")?;
        let name = safe_filename(
            destination
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or("filename-unavailable")?,
        )?;
        let (stem, extension) = filename_parts(&name);
        for number in 0..10_000 {
            let filename = if number == 0 {
                name.clone()
            } else {
                format!("{stem} ({number}){extension}")
            };
            let path = parent.join(filename);
            let key = path_key(&path);
            // Swiph3l: Existence alone misses simultaneous downloads in separate provider
            // WebViews; reserve names across profiles before WebView2 starts writing.
            if !self.0.contains(&key) && !exists(&path).map_err(|_| "destination-unavailable")? {
                self.0.insert(key);
                return Ok(path);
            }
        }
        Err("duplicate-limit")
    }
    fn release(&mut self, path: &Path) {
        self.0.remove(&path_key(path));
    }
}

#[cfg(windows)]
fn names() -> &'static Mutex<Names> {
    static NAMES: OnceLock<Mutex<Names>> = OnceLock::new();
    NAMES.get_or_init(Default::default)
}

#[cfg(windows)]
struct Reservation(PathBuf);
#[cfg(windows)]
impl Drop for Reservation {
    fn drop(&mut self) {
        names()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .release(&self.0);
    }
}

pub fn attachment_popup(service: &ServiceConfig, target: &url::Url) -> bool {
    if target.scheme() == "blob" {
        return url::Url::parse(&service.url).is_ok_and(|configured| {
            target.origin() == configured.origin()
                && !matches!(target.origin(), url::Origin::Opaque(_))
        });
    }
    service.provider == ProviderId::Discord
        && target.scheme() == "https"
        && target.port_or_known_default() == Some(443)
        && target.username().is_empty()
        && target.password().is_none()
        && matches!(
            target.host_str(),
            Some("cdn.discordapp.com" | "media.discordapp.net")
        )
        && target.path().starts_with("/attachments/")
        && target.path_segments().is_some_and(|mut parts| {
            parts.next() == Some("attachments")
                && parts.next().is_some_and(|id| !id.is_empty())
                && parts.next().is_some_and(|id| !id.is_empty())
                && parts.next().is_some_and(|name| !name.is_empty())
        })
}

#[cfg(windows)]
fn event(app: &AppHandle, service: &str, state: &'static str) {
    use tauri::Emitter;
    // Swiph3l: Attachment names and signed provider URLs can contain private data;
    // the shell only receives the service identity and a fixed lifecycle code.
    let _ = app.emit_to(
        "main",
        "attachment-download",
        serde_json::json!({"serviceId": service, "state": state}),
    );
}

#[cfg(windows)]
fn report(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        crate::shell::report(
            &handle,
            "Could not start the attachment download. Check the download folder and try again."
                .into(),
        )
    });
}

#[cfg(windows)]
fn download_state(
    state: webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_DOWNLOAD_STATE,
    reason: webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON,
) -> &'static str {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    if state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED {
        "completed"
    } else if state == COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS {
        "in-progress"
    } else if reason == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED {
        "cancelled"
    } else if reason == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_PAUSED {
        "paused"
    } else {
        "failed"
    }
}

#[cfg(windows)]
fn reservation_finished(state: &str, resumable: bool) -> bool {
    matches!(state, "completed" | "cancelled") || (state == "failed" && !resumable)
}

#[cfg(windows)]
pub fn attach(app: &AppHandle, view: &Webview, service_id: &str) -> tauri::Result<()> {
    use webview2_com::{
        DownloadStartingEventHandler, Microsoft::Web::WebView2::Win32::*, StateChangedEventHandler,
    };
    use windows::core::{Interface, HSTRING, PWSTR};
    let app = app.clone();
    let service = service_id.to_owned();
    view.with_webview(move |view| unsafe {
        let result = (|| -> windows::core::Result<()> {
            let core = view
                .controller()
                .CoreWebView2()?
                .cast::<ICoreWebView2_4>()?;
            let handler_app = app.clone();
            let handler_service = service.clone();
            core.add_DownloadStarting(
                &DownloadStartingEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else {
                        return Ok(());
                    };
                    let prepared = (|| -> windows::core::Result<()> {
                        let mut suggested = PWSTR::null();
                        args.ResultFilePath(&mut suggested)?;
                        // WebView2 already resolves Content-Disposition (including filename*)
                        // and its profile's download directory; do not copy cookies into an HTTP client.
                        let suggested = PathBuf::from(webview2_com::take_pwstr(suggested));
                        let destination = names()
                            .lock()
                            .unwrap_or_else(|error| error.into_inner())
                            .reserve(&suggested, Path::try_exists)
                            .map_err(|_| {
                                windows::core::Error::from_hresult(windows::core::HRESULT(
                                    0x80004005u32 as i32,
                                ))
                            })?;
                        let reservation = Reservation(destination);
                        args.SetResultFilePath(&HSTRING::from(reservation.0.as_os_str()))?;
                        let operation = args.DownloadOperation()?;
                        let state_app = handler_app.clone();
                        let state_service = handler_service.clone();
                        let reservation = std::cell::RefCell::new(Some(reservation));
                        operation.add_StateChanged(
                            &StateChangedEventHandler::create(Box::new(move |operation, _| {
                                let Some(operation) = operation else {
                                    return Ok(());
                                };
                                let mut state = COREWEBVIEW2_DOWNLOAD_STATE::default();
                                let mut reason = COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON::default();
                                operation.State(&mut state)?;
                                if state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED {
                                    operation.InterruptReason(&mut reason)?;
                                }
                                let state = download_state(state, reason);
                                let mut can_resume = Default::default();
                                let resumable = state != "failed"
                                    || operation.CanResume(&mut can_resume).is_err()
                                    || can_resume.as_bool();
                                if reservation_finished(state, resumable) {
                                    reservation.borrow_mut().take();
                                }
                                // Swiph3l: The browser can retain failed downloads in its UI history;
                                // only resumable operations still own an in-flight filename.
                                event(&state_app, &state_service, state);
                                Ok(())
                            })),
                            &mut 0,
                        )?;
                        // Swiph3l: Tauri/Wry's on_download hook sets Handled=true and hides
                        // the native UI; direct WebView2 observation preserves Save As,
                        // cancel/retry controls and Windows security warnings without auto-opening files.
                        args.SetHandled(false)?;
                        event(&handler_app, &handler_service, "requested");
                        Ok(())
                    })();
                    if prepared.is_err() {
                        let _ = args.SetCancel(true);
                        event(&handler_app, &handler_service, "failed");
                        report(&handler_app);
                    }
                    Ok(())
                })),
                &mut 0,
            )
        })();
        if result.is_err() {
            event(&app, &service, "unavailable");
            report(&app);
        }
    })
}

#[cfg(not(windows))]
pub fn attach(_: &AppHandle, _: &Webview, _: &str) -> tauri::Result<()> {
    Ok(())
}

pub fn popup(
    app: &AppHandle,
    service: &ServiceConfig,
    features: tauri::webview::NewWindowFeatures,
) -> tauri::Result<tauri::WebviewWindow> {
    use std::sync::atomic::{AtomicU64, Ordering};
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let configured = service.clone();
    let nav_app = app.clone();
    let window = WebviewWindowBuilder::new(
        app,
        format!("attachment-{}", NEXT.fetch_add(1, Ordering::Relaxed)),
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    // Swiph3l: The popup must use the opener's WebView2 environment/profile;
    // a fresh profile would lose authentication and blob attachment access.
    .window_features(features)
    .title("ChatPlus Desktop - Attachment")
    .inner_size(900., 650.)
    .on_navigation(move |target| {
        if target.as_str() == "about:blank" || attachment_popup(&configured, target) {
            true
        } else {
            crate::services::external(&nav_app, target);
            false
        }
    })
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .build()?;
    attach(app, window.as_ref(), &service.id)?;
    Ok(window)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn attachment_names_preserve_spaces_unicode_and_all_extensions() {
        for name in [
            "Annual report 2026.pdf",
            "archive.zip",
            "notes.txt",
            "Zdjęcie 🐈.png",
            "photo.jpeg",
            "table.xlsx",
            "document.docx",
            "slides.pptx",
        ] {
            assert_eq!(safe_filename(name).unwrap(), name);
        }
        assert_eq!(
            safe_filename("Annual%20report%202026.pdf").unwrap(),
            "Annual report 2026.pdf"
        );
        assert_eq!(
            safe_filename("Za%C5%BC%C3%B3%C5%82%C4%87.pdf").unwrap(),
            "Zażółć.pdf"
        );
        assert_eq!(safe_filename("a+b%2520.pdf").unwrap(), "a+b%20.pdf");
        assert_eq!(safe_filename("invalid%ff.pdf").unwrap(), "invalid%ff.pdf");
    }
    #[test]
    fn attachment_names_cannot_escape_directory_or_hide_extensions() {
        for (input, expected) in [
            ("..%2F..%5Csecret.pdf", ".._.._secret.pdf"),
            ("CON.pdf", "_CON.pdf"),
            ("LPT¹.txt", "_LPT¹.txt"),
            ("..", "attachment"),
            (" report.pdf. ", "report.pdf"),
            ("x\u{202e}fdp.exe", "x_fdp.exe"),
            ("file:stream.pdf", "file_stream.pdf"),
        ] {
            assert_eq!(safe_filename(input).unwrap(), expected);
        }
        let name = safe_filename(&format!("{}.xlsx", "🐈".repeat(250))).unwrap();
        assert!(name.ends_with(".xlsx"));
        assert!(name.encode_utf16().count() <= MAX_FILENAME_UNITS);
    }
    #[test]
    fn duplicate_names_are_reserved_across_simultaneous_downloads_and_existing_files() {
        let mut names = Names::default();
        let root = std::env::temp_dir();
        let requested = root.join("report%20name.pdf");
        let first = names.reserve(&requested, |_| Ok(false)).unwrap();
        assert_eq!(first, root.join("report name.pdf"));
        let second = names
            .reserve(&root.join("REPORT NAME.pdf"), |_| Ok(false))
            .unwrap();
        assert_eq!(second, root.join("REPORT NAME (1).pdf"));
        let third = names
            .reserve(&requested, |path| {
                Ok(path.file_name().unwrap() == "report name (1).pdf")
            })
            .unwrap();
        assert_eq!(third, root.join("report name (2).pdf"));
        names.release(&first);
        assert_eq!(names.reserve(&requested, |_| Ok(false)).unwrap(), first);
        assert!(names
            .reserve(Path::new("relative.pdf"), |_| Ok(false))
            .is_err());
        assert!(Names::default()
            .reserve(&requested, |_| Err(
                std::io::ErrorKind::PermissionDenied.into()
            ))
            .is_err());
    }
    #[test]
    fn existing_download_is_never_selected_or_changed_and_parallel_names_are_distinct() {
        let directory = std::env::temp_dir().join(format!(
            "chatplus-download-regression-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        let original = directory.join("Annual report.pdf");
        std::fs::write(&original, b"already downloaded").unwrap();
        let names = std::sync::Arc::new(std::sync::Mutex::new(Names::default()));
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
        let destinations = std::thread::scope(|scope| {
            (0..8)
                .map(|_| {
                    let names = names.clone();
                    let barrier = barrier.clone();
                    let original = original.clone();
                    scope.spawn(move || {
                        barrier.wait();
                        names
                            .lock()
                            .unwrap()
                            .reserve(&original, Path::try_exists)
                            .unwrap()
                    })
                })
                .collect::<Vec<_>>()
                .into_iter()
                .map(|worker| worker.join().unwrap())
                .collect::<HashSet<_>>()
        });
        assert_eq!(destinations.len(), 8);
        assert!(!destinations.contains(&original));
        assert!(destinations
            .iter()
            .all(|path| path.parent() == Some(directory.as_path())
                && path.extension().unwrap() == "pdf"));
        assert_eq!(std::fs::read(&original).unwrap(), b"already downloaded");
        std::fs::remove_file(original).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
    fn service(provider: ProviderId) -> ServiceConfig {
        ServiceConfig {
            id: "test".into(),
            provider,
            name: "test".into(),
            url: "https://chat.example.com/".into(),
            enabled: true,
            notifications: true,
        }
    }
    #[test]
    fn attachment_popups_keep_blob_origin_and_discord_cdn_boundaries() {
        let discord = service(ProviderId::Discord);
        for target in [
            "https://cdn.discordapp.com/attachments/1/2/report.pdf?ex=signed",
            "https://media.discordapp.net/attachments/1/2/photo.png",
            "blob:https://chat.example.com/id",
        ] {
            assert!(
                attachment_popup(&discord, &target.parse().unwrap()),
                "{target}"
            );
        }
        for target in [
            "http://cdn.discordapp.com/attachments/1/2/a.pdf",
            "https://cdn.discordapp.com:8443/attachments/1/2/a.pdf",
            "https://cdn.discordapp.com.evil.example/attachments/1/2/a.pdf",
            "https://user:password@cdn.discordapp.com/attachments/1/2/a.pdf",
            "https://cdn.discordapp.com/assets/a.js",
            "https://cdn.discordapp.com/attachments/1/2/",
            "blob:https://other.example.com/id",
            "blob:null/id",
            "file:///report.pdf",
        ] {
            assert!(
                !attachment_popup(&discord, &target.parse().unwrap()),
                "{target}"
            );
        }
        assert!(!attachment_popup(
            &service(ProviderId::SynologyChat),
            &"https://cdn.discordapp.com/attachments/1/2/a.pdf"
                .parse()
                .unwrap()
        ));
    }
    #[cfg(windows)]
    #[test]
    fn native_lifecycle_distinguishes_cancel_pause_failure_and_success_without_metadata() {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        for (state, reason, expected) in [
            (
                COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED,
                COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NONE,
                "completed",
            ),
            (
                COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS,
                COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NONE,
                "in-progress",
            ),
            (
                COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED,
                COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED,
                "cancelled",
            ),
            (
                COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED,
                COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_PAUSED,
                "paused",
            ),
            (
                COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED,
                COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_SERVER_FORBIDDEN,
                "failed",
            ),
            (
                COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED,
                COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_SECURITY_CHECK_FAILED,
                "failed",
            ),
        ] {
            assert_eq!(download_state(state, reason), expected);
        }
        assert!(reservation_finished("completed", true));
        assert!(reservation_finished("cancelled", true));
        assert!(reservation_finished("failed", false));
        assert!(!reservation_finished("failed", true));
        assert!(!reservation_finished("paused", false));
        assert!(!reservation_finished("in-progress", false));
    }
}
