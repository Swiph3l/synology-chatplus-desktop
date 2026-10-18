//! Provider links leave ChatPlus only after a fresh, native user confirmation.
use crate::{navigation, providers::ServiceConfig, state};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct Service(Arc<AtomicBool>);

struct Pending(Arc<AtomicBool>);
impl Drop for Pending {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn permitted(settings: &state::Settings, service: &ServiceConfig, target: &url::Url) -> bool {
    settings.external_links
        && settings.services.iter().any(|current| {
            current.enabled
                && current.id == service.id
                && current.provider == service.provider
                && current.url == service.url
        })
        && navigation::external_target(target).is_some()
}

fn open_confirmed(
    accepted: bool,
    settings: &state::Settings,
    service: &ServiceConfig,
    target: &url::Url,
    open: impl FnOnce(&str) -> Result<(), ()>,
) -> Result<(), ()> {
    if accepted && permitted(settings, service, target) {
        open(target.as_str())?;
    }
    Ok(())
}

pub fn request(app: &AppHandle, service: &ServiceConfig, target: &url::Url, source_window: &str) {
    if !permitted(&state::current(app), service, target) {
        return;
    }
    let Some(target) = navigation::external_target(target) else {
        return;
    };
    let Some(window) = app.get_window(source_window) else {
        return;
    };
    let active = app.state::<Service>().0.clone();
    // Swiph3l: A popup and a navigation callback can describe the same click. Never stack
    // native prompts or remember an approval for a later URL/click.
    if active
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }
    let pending = Pending(active);
    let app = app.clone();
    let service = service.clone();
    // Swiph3l: Tauri may execute run_on_main_thread inline when already on the UI thread.
    // Queue from another thread so the WebView callback returns before modal UI.
    let _ = std::thread::Builder::new()
        .name("external-link-confirmation".into())
        .spawn(move || {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                let _pending = pending;
                let Ok(url) = url::Url::parse(&target.url) else {
                    return;
                };
                if !permitted(&state::current(&handle), &service, &url) {
                    return;
                }
                if handle.get_window(window.label()).is_none() {
                    return;
                }
                let accepted = match confirm(&handle, &window, &target) {
                    Ok(accepted) => accepted,
                    Err(()) => {
                        failed(&handle);
                        return;
                    }
                };
                // Swiph3l: Settings/service removal may change while the native dialog is
                // open. Approval applies only to this exact retained destination.
                if open_confirmed(accepted, &state::current(&handle), &service, &url, |url| {
                    handle.opener().open_url(url, None::<&str>).map_err(|_| ())
                })
                .is_err()
                {
                    failed(&handle);
                }
            });
        });
}

fn failed(app: &AppHandle) {
    crate::shell::report(app, crate::i18n::t(app, "externalLink.failed"));
}

#[cfg(windows)]
fn confirm(
    app: &AppHandle,
    window: &tauri::Window,
    target: &navigation::ExternalTarget,
) -> Result<bool, ()> {
    use windows::{
        core::{HSTRING, PCWSTR},
        Win32::UI::Controls::{
            TaskDialogIndirect, TASKDIALOGCONFIG, TASKDIALOGCONFIG_0, TASKDIALOG_BUTTON,
            TDF_ALLOW_DIALOG_CANCELLATION, TDF_POSITION_RELATIVE_TO_WINDOW, TD_WARNING_ICON,
        },
    };
    const OPEN: i32 = 100;
    const CANCEL: i32 = 2;
    if !window.is_visible().unwrap_or(false) {
        return Ok(false);
    }
    let owner = window.hwnd().map_err(|_| ())?;
    let title = HSTRING::from("ChatPlus Desktop");
    let instruction = HSTRING::from(crate::i18n::t(app, "externalLink.title"));
    let mut content = crate::i18n::t(app, "externalLink.body").replace("{url}", &target.url);
    if target.insecure_http {
        content.push_str("\n\n");
        content.push_str(&crate::i18n::t(app, "externalLink.httpWarning"));
    }
    let content = HSTRING::from(content);
    let origin = HSTRING::from(&target.origin);
    let open = HSTRING::from(crate::i18n::t(app, "externalLink.open"));
    let cancel = HSTRING::from(crate::i18n::t(app, "common.cancel"));
    let buttons = [
        TASKDIALOG_BUTTON {
            nButtonID: OPEN,
            pszButtonText: PCWSTR(open.as_ptr()),
        },
        TASKDIALOG_BUTTON {
            nButtonID: CANCEL,
            pszButtonText: PCWSTR(cancel.as_ptr()),
        },
    ];
    let config = TASKDIALOGCONFIG {
        cbSize: std::mem::size_of::<TASKDIALOGCONFIG>() as u32,
        hwndParent: owner,
        dwFlags: TDF_ALLOW_DIALOG_CANCELLATION | TDF_POSITION_RELATIVE_TO_WINDOW,
        pszWindowTitle: PCWSTR(title.as_ptr()),
        Anonymous1: TASKDIALOGCONFIG_0 {
            pszMainIcon: TD_WARNING_ICON,
        },
        pszMainInstruction: PCWSTR(instruction.as_ptr()),
        pszContent: PCWSTR(content.as_ptr()),
        pszFooter: PCWSTR(origin.as_ptr()),
        cButtons: buttons.len() as u32,
        pButtons: buttons.as_ptr(),
        nDefaultButton: CANCEL,
        cxWidth: 380,
        ..Default::default()
    };
    let mut selected = CANCEL;
    unsafe { TaskDialogIndirect(&config, Some(&mut selected), None, None) }.map_err(|_| ())?;
    Ok(selected == OPEN)
}

#[cfg(not(windows))]
fn confirm(_: &AppHandle, _: &tauri::Window, _: &navigation::ExternalTarget) -> Result<bool, ()> {
    // No unconfirmed fallback: this client currently ships Windows native UI.
    Err(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (state::Settings, ServiceConfig, url::Url) {
        let mut settings = state::Settings::default();
        let service = ServiceConfig {
            id: "account-a".into(),
            provider: crate::providers::ProviderId::Whatsapp,
            name: "Account A".into(),
            url: "https://web.whatsapp.com/".into(),
            enabled: true,
            notifications: true,
            notification_color: crate::providers::NotificationColor::Auto,
        };
        settings.external_links = true;
        settings.services = vec![service.clone()];
        (
            settings,
            service,
            "https://example.com/path?value=1".parse().unwrap(),
        )
    }

    #[test]
    fn retained_url_is_rechecked_against_current_preference_and_service() {
        let (mut settings, service, url) = fixture();
        assert!(permitted(&settings, &service, &url));
        settings.external_links = false;
        assert!(!permitted(&settings, &service, &url));
        settings.external_links = true;
        settings.services[0].enabled = false;
        assert!(!permitted(&settings, &service, &url));
        settings.services[0].enabled = true;
        settings.services[0].url = "https://discord.com/app/".into();
        assert!(!permitted(&settings, &service, &url));
        settings.services = vec![service.clone()];
        settings.services[0].id = "account-b".into();
        assert!(!permitted(&settings, &service, &url));
        settings.services.clear();
        assert!(!permitted(&settings, &service, &url));
    }

    #[test]
    fn credentials_and_non_web_schemes_cannot_enter_the_opener_path() {
        let (settings, service, _) = fixture();
        for input in [
            "https://user:secret@example.com/",
            "file:///C:/Windows/system32/cmd.exe",
            "javascript:alert(1)",
            "data:text/html,test",
            "blob:https://web.whatsapp.com/private",
            "ms-settings:notifications",
        ] {
            assert!(!permitted(&settings, &service, &input.parse().unwrap()));
        }
    }

    #[test]
    fn cancelled_or_failed_prompt_releases_only_its_own_pending_slot() {
        let active = Arc::new(AtomicBool::new(false));
        assert!(active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok());
        let pending = Pending(active.clone());
        assert!(active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err());
        drop(pending);
        assert!(active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok());
        drop(Pending(active.clone()));
        assert!(!active.load(Ordering::Acquire));
    }

    #[test]
    fn cancel_never_opens_and_accept_opens_the_exact_retained_url_once() {
        let (settings, service, url) = fixture();
        let opened = std::cell::RefCell::new(Vec::new());
        let opener = |target: &str| {
            opened.borrow_mut().push(target.to_owned());
            Ok(())
        };
        open_confirmed(false, &settings, &service, &url, opener).unwrap();
        assert!(opened.borrow().is_empty());
        open_confirmed(true, &settings, &service, &url, opener).unwrap();
        assert_eq!(*opened.borrow(), vec![url.as_str().to_owned()]);
    }

    #[test]
    fn accepting_a_stale_prompt_never_reopens_removed_or_changed_service() {
        let (mut settings, service, url) = fixture();
        settings.services.clear();
        open_confirmed(true, &settings, &service, &url, |_| panic!("must not open")).unwrap();
        settings.services.push(service.clone());
        settings.external_links = false;
        open_confirmed(true, &settings, &service, &url, |_| panic!("must not open")).unwrap();
        settings.external_links = true;
        assert!(open_confirmed(true, &settings, &service, &url, |_| Err(())).is_err());
    }
}
