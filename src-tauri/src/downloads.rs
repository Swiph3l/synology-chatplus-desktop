//! Attachment transfers stay in WebView2, including provider cookies and Windows download protection.
use crate::providers::{ProviderId, ServiceConfig};
use tauri::{AppHandle, Webview};

#[cfg(windows)]
use std::sync::{Mutex, OnceLock};
#[cfg(any(windows, test))]
use std::{
    collections::{HashSet, VecDeque},
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
    fn reserve_selected(&mut self, destination: &Path) -> Result<PathBuf, &'static str> {
        if !destination.is_absolute() || destination.file_name().is_none() {
            return Err("destination-unavailable");
        }
        // Swiph3l: The native picker owns overwrite confirmation. Preserve its exact
        // selected name; decoding/renaming now would save somewhere unapproved.
        if !self.0.insert(path_key(destination)) {
            return Err("destination-in-use");
        }
        Ok(destination.to_owned())
    }
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
        return url::Url::parse(target.path()).is_ok_and(|inner| {
            inner.username().is_empty()
                && inner.password().is_none()
                && url::Url::parse(&service.url).is_ok_and(|configured| {
                    target.origin() == configured.origin()
                        && !matches!(target.origin(), url::Origin::Opaque(_))
                })
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

pub fn popup_allowed(service: &ServiceConfig, target: &url::Url) -> bool {
    target.as_str() == "about:blank"
        || service.provider.allows(&service.url, target)
        || attachment_popup(service, target)
}

fn attachment_popup_script(service: &ServiceConfig, target: &url::Url) -> Option<String> {
    if target.scheme() != "https" || !attachment_popup(service, target) {
        return None;
    }
    let target = serde_json::to_string(target.as_str()).ok()?;
    Some(format!(
        "(()=>{{try{{return window.open({target}, '_blank') !== null}}catch{{return false}}}})()"
    ))
}

fn popup_failed(app: &AppHandle, service_id: &str) {
    #[cfg(windows)]
    event(app, service_id, "failed", None);
    #[cfg(not(windows))]
    let _ = (app, service_id);
}

/// Re-route a recognized attachment navigation through its originating public
/// popup path, preserving the related WebView environment and provider profile.
pub fn open_attachment_popup(
    app: &AppHandle,
    service: &ServiceConfig,
    target: &url::Url,
) -> Result<(), String> {
    use tauri::Manager;
    let Some(script) = attachment_popup_script(service, target) else {
        popup_failed(app, &service.id);
        return Err("Unsupported attachment target.".into());
    };
    if !crate::services::configured(app, service) {
        popup_failed(app, &service.id);
        return Err("The originating service changed. Try the attachment again.".into());
    }
    let app = app.clone();
    let service = service.clone();
    let dispatch_failure_app = app.clone();
    let dispatch_failure_id = service.id.clone();
    // No COM references leave the UI thread. Off-thread dispatch also prevents
    // Tauri's main-thread fast path from reentering NavigationStarting.
    let scheduled = std::thread::Builder::new()
        .name("attachment-popup".into())
        .spawn(move || {
            let failure_app = app.clone();
            let failure_id = service.id.clone();
            let handle = app.clone();
            if app
                .run_on_main_thread(move || {
                    let Some(view) = handle.get_webview(&crate::services::label(&service.id))
                    else {
                        popup_failed(&handle, &service.id);
                        return;
                    };
                    if !crate::services::configured(&handle, &service)
                        || !view.url().is_ok_and(|source| {
                            crate::navigation::provider_document(&service, &source)
                        })
                    {
                        popup_failed(&handle, &service.id);
                        return;
                    }
                    let callback_app = handle.clone();
                    let callback_id = service.id.clone();
                    if view
                        .eval_with_callback(&script, move |result| {
                            if !matches!(serde_json::from_str::<bool>(&result), Ok(true)) {
                                popup_failed(&callback_app, &callback_id);
                            }
                        })
                        .is_err()
                    {
                        popup_failed(&handle, &service.id);
                    }
                })
                .is_err()
            {
                popup_failed(&failure_app, &failure_id);
            }
        });
    if scheduled.is_err() {
        popup_failed(&dispatch_failure_app, &dispatch_failure_id);
        return Err("Could not open the attachment. Try again.".into());
    }
    Ok(())
}

#[cfg(windows)]
fn event(app: &AppHandle, service: &str, state: &'static str, path: Option<&Path>) {
    use tauri::Emitter;
    // Only the user-selected local path enters the ephemeral shell UI. Signed
    // provider URLs, cookies and message content never enter events or logs.
    let _ = app.emit_to(
        "main",
        "attachment-download",
        serde_json::json!({"serviceId": service, "state": state, "path": path.map(|path| path.to_string_lossy())}),
    );
}

#[cfg(any(windows, test))]
struct DialogQueue<T> {
    pending: VecDeque<T>,
    active: bool,
    scheduled: bool,
}
#[cfg(any(windows, test))]
impl<T> Default for DialogQueue<T> {
    fn default() -> Self {
        Self {
            pending: VecDeque::new(),
            active: false,
            scheduled: false,
        }
    }
}
#[cfg(any(windows, test))]
impl<T> DialogQueue<T> {
    fn push(&mut self, item: T) -> Result<bool, T> {
        if self.pending.len() >= 32 {
            return Err(item);
        }
        self.pending.push_back(item);
        let schedule = !self.active && !self.scheduled;
        self.scheduled |= schedule;
        Ok(schedule)
    }
    fn take(&mut self) -> Option<T> {
        self.scheduled = false;
        if self.active {
            return None;
        }
        let item = self.pending.pop_front()?;
        self.active = true;
        Some(item)
    }
    fn finished(&mut self) -> bool {
        self.active = false;
        let schedule = !self.pending.is_empty() && !self.scheduled;
        self.scheduled |= schedule;
        schedule
    }
}

#[cfg(windows)]
struct PendingDownload {
    args: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2DownloadStartingEventArgs,
    deferral: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Deferral,
    service: String,
    session: ServiceConfig,
    owner: isize,
    selected: std::cell::RefCell<Option<PathBuf>>,
}
#[cfg(windows)]
impl Drop for PendingDownload {
    fn drop(&mut self) {
        unsafe {
            let _ = self.deferral.Complete();
        }
    }
}
#[cfg(windows)]
thread_local! {
    // COM references never cross their originating WebView UI apartment.
    static DIALOGS: std::cell::RefCell<DialogQueue<PendingDownload>> = std::cell::RefCell::new(DialogQueue::default());
}

#[cfg(windows)]
fn schedule_dialog(app: &AppHandle) {
    let app = app.clone();
    // Swiph3l: Tauri may run UI dispatch inline on the UI thread. Dispatch from a worker
    // so the modal picker always starts after DownloadStarting has returned.
    std::thread::spawn(move || {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(pending) = DIALOGS.with(|queue| queue.borrow_mut().take()) {
                if prepare_download(&handle, &pending).is_err() {
                    unsafe {
                        let _ = pending.args.SetCancel(true);
                    }
                    event(
                        &handle,
                        &pending.service,
                        "failed",
                        pending.selected.borrow().as_deref(),
                    );
                }
                drop(pending); // Complete the deferral on its owning UI apartment.
                if DIALOGS.with(|queue| queue.borrow_mut().finished()) {
                    schedule_dialog(&handle);
                }
            }
        });
    });
}

#[cfg(windows)]
fn save_as(
    app: &AppHandle,
    owner: isize,
    suggested: &Path,
) -> windows::core::Result<Option<PathBuf>> {
    use windows::{
        core::HSTRING,
        Win32::{
            Foundation::HWND,
            System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER},
            UI::Shell::*,
        },
    };
    unsafe {
        let dialog: IFileSaveDialog =
            CoCreateInstance(&FileSaveDialog, None, CLSCTX_INPROC_SERVER)?;
        dialog.SetOptions(
            dialog.GetOptions()?
                | FOS_FORCEFILESYSTEM
                | FOS_PATHMUSTEXIST
                | FOS_OVERWRITEPROMPT
                | FOS_NOCHANGEDIR,
        )?;
        dialog.SetTitle(&HSTRING::from(crate::i18n::t(app, "downloads.saveAsTitle")))?;
        if let Some(name) = suggested.file_name() {
            dialog.SetFileName(&HSTRING::from(name))?;
        }
        if let Some(extension) = suggested.extension() {
            dialog.SetDefaultExtension(&HSTRING::from(extension))?;
        }
        if let Some(parent) = suggested.parent() {
            if let Ok(folder) = SHCreateItemFromParsingName::<_, _, IShellItem>(
                &HSTRING::from(parent.as_os_str()),
                None,
            ) {
                dialog.SetFolder(&folder)?;
            }
        }
        match dialog.Show(Some(HWND(owner as *mut _))) {
            Ok(()) => {
                let path = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
                Ok(Some(PathBuf::from(webview2_com::take_pwstr(path))))
            }
            Err(error) if error.code().0 == 0x800704c7u32 as i32 => Ok(None),
            Err(error) => Err(error),
        }
    }
}

#[cfg(windows)]
fn download_error() -> windows::core::Error {
    windows::core::Error::from_hresult(windows::core::HRESULT(0x80004005u32 as i32))
}

#[cfg(windows)]
fn prepare_download(app: &AppHandle, pending: &PendingDownload) -> windows::core::Result<()> {
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, StateChangedEventHandler};
    use windows::core::{HSTRING, PWSTR};
    unsafe {
        if !crate::services::configured(app, &pending.session) {
            pending.args.SetCancel(true)?;
            event(app, &pending.service, "cancelled", None);
            return Ok(());
        }
        let mut suggested = PWSTR::null();
        pending.args.ResultFilePath(&mut suggested)?;
        let suggested = PathBuf::from(webview2_com::take_pwstr(suggested));
        let proposed = names()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .reserve(&suggested, Path::try_exists)
            .map_err(|_| download_error())?;
        let proposed = Reservation(proposed);
        let Some(selected) = save_as(app, pending.owner, &proposed.0)? else {
            pending.args.SetCancel(true)?;
            event(app, &pending.service, "cancelled", None);
            return Ok(());
        };
        *pending.selected.borrow_mut() = Some(selected.clone());
        if !crate::services::configured(app, &pending.session) {
            pending.args.SetCancel(true)?;
            event(app, &pending.service, "cancelled", Some(&selected));
            return Ok(());
        }
        let reservation = if path_key(&selected) == path_key(&proposed.0) {
            proposed
        } else {
            Reservation(
                names()
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .reserve_selected(&selected)
                    .map_err(|_| download_error())?,
            )
        };
        let destination = reservation.0.clone();
        pending
            .args
            .SetResultFilePath(&HSTRING::from(destination.as_os_str()))?;
        let operation = pending.args.DownloadOperation()?;
        let state_app = app.clone();
        let state_service = pending.service.clone();
        let state_path = destination.clone();
        let reservation = std::cell::RefCell::new(Some(reservation));
        operation.add_StateChanged(
            &StateChangedEventHandler::create(Box::new(move |operation, _| {
                let Some(operation) = operation else {
                    return Ok(());
                };
                let mut state = COREWEBVIEW2_DOWNLOAD_STATE::default();
                let mut reason = COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON::default();
                if operation.State(&mut state).is_err() {
                    event(&state_app, &state_service, "failed", Some(&state_path));
                    return Ok(());
                }
                if state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED {
                    if operation.InterruptReason(&mut reason).is_err() {
                        event(&state_app, &state_service, "failed", Some(&state_path));
                        return Ok(());
                    }
                }
                let state = download_state(state, reason);
                let mut can_resume = Default::default();
                let resumable = state != "failed"
                    || operation.CanResume(&mut can_resume).is_err()
                    || can_resume.as_bool();
                if reservation_finished(state, resumable) {
                    reservation.borrow_mut().take();
                }
                event(&state_app, &state_service, state, Some(&state_path));
                Ok(())
            })),
            &mut 0,
        )?;
        // Keep the browser's transfer controls and Windows security protection;
        // only destination selection is owned by ChatPlus.
        pending.args.SetHandled(false)?;
        event(app, &pending.service, "requested", Some(&destination));
        Ok(())
    }
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
    use webview2_com::{DownloadStartingEventHandler, Microsoft::Web::WebView2::Win32::*};
    use windows::core::Interface;
    let owner = view.window().hwnd()?.0 as isize;
    let Some(session) = crate::state::current(app)
        .services
        .into_iter()
        .find(|service| service.id == service_id && service.enabled)
    else {
        event(app, service_id, "unavailable", None);
        return Ok(());
    };
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
                    let Ok(deferral) = args.GetDeferral() else {
                        let _ = args.SetCancel(true);
                        event(&handler_app, &handler_service, "failed", None);
                        return Ok(());
                    };
                    let pending = PendingDownload {
                        args: args.clone(),
                        deferral,
                        service: handler_service.clone(),
                        session: session.clone(),
                        owner,
                        selected: Default::default(),
                    };
                    match DIALOGS.with(|queue| queue.borrow_mut().push(pending)) {
                        Ok(true) => schedule_dialog(&handler_app),
                        Ok(false) => {}
                        Err(pending) => {
                            let _ = pending.args.SetCancel(true);
                            event(&handler_app, &handler_service, "failed", None);
                            // Dropping completes the rejected deferral on this UI thread.
                        }
                    }
                    Ok(())
                })),
                &mut 0,
            )
        })();
        if result.is_err() {
            event(&app, &service, "unavailable", None);
        }
    })
}

#[cfg(not(windows))]
pub fn attach(_: &AppHandle, _: &Webview, _: &str) -> tauri::Result<()> {
    Ok(())
}

pub fn is_popup_label(label: &str) -> bool {
    label.strip_prefix("attachment-").is_some_and(|serial| {
        !serial.is_empty() && serial.bytes().all(|byte| byte.is_ascii_digit())
    })
}

fn popup_background(theme: &crate::state::Theme, system: tauri::Theme) -> tauri::window::Color {
    let dark = match theme {
        crate::state::Theme::Dark => true,
        crate::state::Theme::Light => false,
        crate::state::Theme::System => system == tauri::Theme::Dark,
    };
    crate::shell::background_color(dark)
}

/// Update only app-owned chrome/default canvas, never provider or PDF document CSS.
pub fn apply_popup_appearance(
    window: &tauri::WebviewWindow,
    theme: &crate::state::Theme,
) -> tauri::Result<()> {
    use tauri::Manager;
    if !is_popup_label(window.label()) {
        return Ok(());
    }
    // Swiph3l: This auxiliary frame has no menu. Native per-window theme updates
    // are safe here without changing the main window's menu/theme lifecycle.
    window.set_theme(theme.native())?;
    window.set_background_color(Some(popup_background(theme, window.theme()?)))?;
    window.set_title(&crate::i18n::t(
        window.app_handle(),
        "window.attachmentTitle",
    ))
}

pub fn popup(
    app: &AppHandle,
    service: &ServiceConfig,
    features: tauri::webview::NewWindowFeatures,
) -> tauri::Result<tauri::WebviewWindow> {
    use std::sync::atomic::{AtomicU64, Ordering};
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let configured = service.clone();
    let popup_service = service.clone();
    let nav_app = app.clone();
    let popup_app = app.clone();
    let label = format!("attachment-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let popup_label = label.clone();
    let nav_label = label.clone();
    let theme = crate::state::current(app).theme;
    let system = app
        .get_window("main")
        .and_then(|window| window.theme().ok())
        .unwrap_or(tauri::Theme::Light);
    let center = features.position().is_none();
    let mut builder = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title(crate::i18n::t(app, "window.attachmentTitle"))
    .visible(false)
    .theme(theme.native())
    .background_color(popup_background(&theme, system))
    .inner_size(900., 650.)
    // Swiph3l: Defaults precede opener features so explicit size/position survive.
    // The related WebView2 environment/profile must keep authentication/blob access.
    .window_features(features)
    .on_navigation(move |target| {
        if !crate::services::configured(&nav_app, &configured) {
            return false;
        }
        if popup_allowed(&configured, target) {
            true
        } else {
            crate::services::external(&nav_app, &configured, target, &nav_label);
            false
        }
    })
    .on_new_window(move |target, _| {
        if crate::services::configured(&popup_app, &popup_service) {
            if popup_allowed(&popup_service, &target) {
                // Reuse this attachment view instead of recursively opening
                // unbounded blank windows; the original provider stays intact.
                if target.as_str() != "about:blank" {
                    if let Some(view) = popup_app.get_webview(&popup_label) {
                        let _ = view.navigate(target);
                    }
                }
            } else {
                crate::services::external(&popup_app, &popup_service, &target, &popup_label);
            }
        }
        tauri::webview::NewWindowResponse::Deny
    });
    if center {
        builder = builder.center();
    }
    #[cfg(windows)]
    if let Some(main) = app.get_window("main") {
        builder = builder.owner_raw(main.hwnd()?);
    }
    let window = builder.build()?;
    let setup = (|| -> tauri::Result<()> {
        // Configure app chrome before the initially blank related view can become
        // visible. Do not inherit the desktop's File/View/Window/Help menu.
        #[cfg(not(target_os = "macos"))]
        window.remove_menu()?;
        apply_popup_appearance(&window, &theme)?;
        let themed_window = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::ThemeChanged(system) = event {
                if crate::state::current(themed_window.app_handle()).theme
                    == crate::state::Theme::System
                {
                    // System changes update only the native/default canvas, without
                    // reinjecting anything into the remote document or recursing set_theme.
                    let _ = themed_window.set_background_color(Some(popup_background(
                        &crate::state::Theme::System,
                        *system,
                    )));
                }
            }
        });
        attach(app, window.as_ref(), &service.id)?;
        window.show()
    })();
    if let Err(error) = setup {
        // Swiph3l: build() already registered this hidden window with Tauri.
        // Dropping the handle would leave an orphan after a later setup failure.
        if window.destroy().is_err() {
            let _ = window.close();
        }
        return Err(error);
    }
    Ok(window)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn attachment_canvas_respects_explicit_and_system_theme_without_touching_document_content() {
        use crate::state::Theme;
        for (theme, system, expected) in [
            (Theme::Dark, tauri::Theme::Light, (22, 26, 32, 255)),
            (Theme::Light, tauri::Theme::Dark, (246, 247, 249, 255)),
            (Theme::System, tauri::Theme::Dark, (22, 26, 32, 255)),
            (Theme::System, tauri::Theme::Light, (246, 247, 249, 255)),
        ] {
            let color = popup_background(&theme, system);
            assert_eq!((color.0, color.1, color.2, color.3), expected);
        }
    }
    #[test]
    fn attachment_chrome_updates_are_scoped_to_app_generated_popup_labels() {
        for label in ["attachment-0", "attachment-123"] {
            assert!(is_popup_label(label));
        }
        for label in [
            "main",
            "settings",
            "service-attachment-1",
            "external-link-1",
            "attachment-",
            "attachment-private",
        ] {
            assert!(!is_popup_label(label));
        }
    }
    #[test]
    fn self_attachment_popup_script_accepts_only_recognized_targets_and_json_escapes_exact_url() {
        let discord = service(ProviderId::Discord);
        let target = url::Url::parse(
            "https://cdn.discordapp.com/attachments/1/2/report.pdf?token=a'\"\\)&name=%E7%8C%AB",
        )
        .unwrap();
        let script = attachment_popup_script(&discord, &target).unwrap();
        let encoded = script
            .split_once("window.open(")
            .unwrap()
            .1
            .split_once(", '_blank')")
            .unwrap()
            .0;
        assert_eq!(
            serde_json::from_str::<String>(encoded).unwrap(),
            target.as_str()
        );
        assert!(script.ends_with("catch{return false}})()"));
        for rejected in [
            "https://discord.com/channels/1/2",
            "https://evil.example/report.pdf",
            "https://cdn.discordapp.com/assets/file.pdf",
            "http://cdn.discordapp.com/attachments/1/2/file.pdf",
            "blob:https://chat.example.com/id",
            "https://user:secret@cdn.discordapp.com/attachments/1/2/file.pdf",
        ] {
            assert!(
                attachment_popup_script(&discord, &rejected.parse().unwrap()).is_none(),
                "{rejected}"
            );
        }
        assert!(attachment_popup_script(&service(ProviderId::Whatsapp), &target).is_none());
    }
    #[test]
    fn save_dialog_queue_serializes_reentrant_downloads_and_bounds_pending_deferrals() {
        let mut queue = DialogQueue::default();
        assert_eq!(queue.push("first"), Ok(true));
        assert_eq!(queue.push("second"), Ok(false));
        assert_eq!(queue.take(), Some("first"));
        assert_eq!(queue.push("arrived-during-modal"), Ok(false));
        assert_eq!(
            queue.take(),
            None,
            "a native picker message loop cannot start a nested picker"
        );
        assert!(queue.finished());
        assert_eq!(queue.take(), Some("second"));
        assert!(queue.finished());
        assert_eq!(queue.take(), Some("arrived-during-modal"));
        assert!(!queue.finished());
        assert_eq!(queue.take(), None);
        let mut bounded = DialogQueue::default();
        for token in 0..32 {
            assert!(bounded.push(token).is_ok());
        }
        assert_eq!(
            bounded.push(32),
            Err(32),
            "caller retains rejected deferral to cancel/complete it"
        );
    }

    #[test]
    fn explicit_save_selection_preserves_exact_destination_and_prevents_parallel_overwrite() {
        let mut names = Names::default();
        let chosen = std::env::temp_dir()
            .join("chosen folder")
            .join("Final%20report 🐈.pdf");
        assert_eq!(
            names.reserve_selected(&chosen),
            Ok(chosen.clone()),
            "never decode or rename the path after native Save As confirmation"
        );
        assert_eq!(names.reserve_selected(&chosen), Err("destination-in-use"));
        let same_case_insensitive = chosen.with_file_name("FINAL%20REPORT 🐈.PDF");
        assert_eq!(
            names.reserve_selected(&same_case_insensitive),
            Err("destination-in-use")
        );
        assert!(names
            .reserve_selected(Path::new("unapproved-relative.pdf"))
            .is_err());
        names.release(&chosen);
        assert_eq!(names.reserve_selected(&chosen), Ok(chosen));
    }

    #[test]
    fn provider_popup_keeps_same_origin_authentication_without_allowing_external_or_opaque_targets()
    {
        let service = service(ProviderId::SynologyChatplus);
        for allowed in [
            "about:blank",
            "https://chat.example.com/attachment?id=opaque",
            "blob:https://chat.example.com/opaque",
        ] {
            assert!(
                popup_allowed(&service, &allowed.parse().unwrap()),
                "{allowed}"
            );
        }
        for denied in [
            "https://other.example.com/file.pdf",
            "https://chat.example.com.evil.example/file.pdf",
            "blob:null/opaque",
            "blob:https://other.example.com/opaque",
            "file:///file.pdf",
            "data:text/html,hello",
        ] {
            assert!(
                !popup_allowed(&service, &denied.parse().unwrap()),
                "{denied}"
            );
        }
    }
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
            notification_color: crate::providers::NotificationColor::Auto,
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
            "blob:https://user:secret@chat.example.com/id",
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
