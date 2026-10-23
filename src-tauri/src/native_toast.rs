//! Small WinRT sender retaining only bounded native toast handles for exact withdrawal.
use std::collections::VecDeque;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Key {
    pub service: String,
    pub identity: String,
    pub generation: u64,
}

const LIMIT: usize = 256;

// Swiph3l: Provider text is XML data, never markup. Drop XML 1.0-invalid controls
// and escape attributes as well as text; no title/body participates in identity.
fn escape(value: &str) -> String {
    let mut result = String::new();
    for character in value.chars().filter(|character| {
        matches!(*character, '\t' | '\n' | '\r')
            || (*character >= '\u{20}' && !matches!(*character, '\u{fffe}' | '\u{ffff}'))
    }) {
        match character {
            '&' => result.push_str("&amp;"),
            '<' => result.push_str("&lt;"),
            '>' => result.push_str("&gt;"),
            '"' => result.push_str("&quot;"),
            '\'' => result.push_str("&apos;"),
            _ => result.push(character),
        }
    }
    result
}

fn xml(title: &str, body: &str, attribution: &str, icon: Option<&str>, sound: bool) -> String {
    let image = icon.map_or_else(String::new, |source| {
        format!(
            "<image placement=\"appLogoOverride\" hint-crop=\"none\" src=\"{}\"/>",
            escape(source)
        )
    });
    let audio = if sound {
        "<audio src=\"ms-winsoundevent:Notification.IM\"/>"
    } else {
        "<audio silent=\"true\"/>"
    };
    format!(
        "<toast><visual><binding template=\"ToastGeneric\">{image}<text>{}</text><text>{}</text><text>{}</text></binding></visual>{audio}</toast>",
        escape(title), escape(body), escape(attribution),
    )
}

fn take<T>(values: &mut VecDeque<(Key, T)>, key: &Key) -> Option<T> {
    values
        .iter()
        .position(|(candidate, _)| candidate == key)
        .and_then(|position| values.remove(position).map(|(_, value)| value))
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::{
        cell::RefCell,
        path::Path,
        sync::{
            atomic::{AtomicU64, Ordering},
            OnceLock,
        },
        time::{SystemTime, UNIX_EPOCH},
    };
    use windows::{
        core::{Result, HSTRING},
        Data::Xml::Dom::XmlDocument,
        Foundation::TypedEventHandler,
        UI::Notifications::{
            ToastDismissalReason, ToastDismissedEventArgs, ToastNotification,
            ToastNotificationManager, ToastNotifier,
        },
    };

    struct Handle {
        toast: ToastNotification,
        notifier: ToastNotifier,
        application: HSTRING,
        tag: HSTRING,
        group: HSTRING,
    }
    impl Handle {
        fn withdraw(self) {
            let _ = self.notifier.Hide(&self.toast);
            // Hide the banner and remove only this exact entry from Action Center.
            if let Ok(history) = ToastNotificationManager::History() {
                let _ = history.RemoveGroupedTagWithId(&self.tag, &self.group, &self.application);
            }
        }
    }

    thread_local! {
        static RETAINED: RefCell<VecDeque<(Key, Handle)>> = const { RefCell::new(VecDeque::new()) };
    }
    static NEXT: AtomicU64 = AtomicU64::new(0);
    static GROUP: OnceLock<String> = OnceLock::new();

    pub(in crate::desktop_notifications) fn withdraw(key: &Key) -> bool {
        let handle = RETAINED.with(|values| take(&mut values.borrow_mut(), key));
        if let Some(handle) = handle {
            handle.withdraw();
            true
        } else {
            false
        }
    }

    pub(in crate::desktop_notifications) fn show(
        application: &str,
        title: &str,
        body: &str,
        attribution: &str,
        icon: Option<&Path>,
        sound: bool,
        key: Option<Key>,
        activated: impl Fn() + Send + 'static,
        dismissed: impl Fn(Option<ToastDismissalReason>) + Send + 'static,
    ) -> Result<()> {
        let icon = icon
            .and_then(|path| url::Url::from_file_path(path).ok())
            .map(|url| url.to_string());
        let document = XmlDocument::new()?;
        document.LoadXml(&HSTRING::from(xml(
            title,
            body,
            attribution,
            icon.as_deref(),
            sound,
        )))?;
        let toast = ToastNotification::CreateToastNotification(&document)?;
        toast.Activated(&TypedEventHandler::new(move |_, _| {
            activated();
            Ok(())
        }))?;
        toast.Dismissed(&TypedEventHandler::<
            ToastNotification,
            ToastDismissedEventArgs,
        >::new(move |_, args| {
            dismissed(args.as_ref().and_then(|args| args.Reason().ok()));
            Ok(())
        }))?;
        let application = HSTRING::from(application);
        let notifier = ToastNotificationManager::CreateToastNotifierWithId(&application)?;
        let tag = HSTRING::from(format!("{:016x}", NEXT.fetch_add(1, Ordering::Relaxed)));
        let group = HSTRING::from(GROUP.get_or_init(|| {
            format!(
                "chatplus-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis()
            )
        }));
        toast.SetTag(&tag)?;
        toast.SetGroup(&group)?;
        notifier.Show(&toast)?;
        if let Some(key) = key {
            let displaced = RETAINED.with(|values| {
                let mut values = values.borrow_mut();
                let previous = take(&mut values, &key);
                let oldest = if values.len() >= LIMIT {
                    values.pop_front().map(|(_, value)| value)
                } else {
                    None
                };
                values.push_back((
                    key,
                    Handle {
                        toast,
                        notifier,
                        application,
                        tag,
                        group,
                    },
                ));
                (previous, oldest)
            });
            for handle in [displaced.0, displaced.1].into_iter().flatten() {
                handle.withdraw();
            }
        }
        Ok(())
    }
}

#[cfg(windows)]
pub(super) use platform::{show, withdraw};

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn provider_text_and_icon_cannot_inject_toast_markup() {
        let value = xml(
            "<title>&\"'\0",
            "body</text><audio/>",
            "source\u{ffff}",
            Some("file:///icon.png?x=\"&y=<"),
            false,
        );
        assert!(value.contains("&lt;title&gt;&amp;&quot;&apos;"));
        assert!(value.contains("body&lt;/text&gt;&lt;audio/&gt;"));
        assert!(value.contains("src=\"file:///icon.png?x=&quot;&amp;y=&lt;\""));
        assert!(!value.contains('\0'));
        assert!(!value.contains('\u{ffff}'));
        assert_eq!(value.matches("<audio ").count(), 1);
        assert!(value.ends_with("<audio silent=\"true\"/></toast>"));
        assert!(xml("t", "b", "a", None, true).contains("ms-winsoundevent:Notification.IM"));
    }
    #[test]
    fn withdrawal_matches_the_complete_native_identity_and_is_one_shot() {
        let key = Key {
            service: "work".into(),
            identity: "bridge:1".into(),
            generation: 1,
        };
        let mut values = VecDeque::from([
            (key.clone(), 1),
            (
                Key {
                    service: "personal".into(),
                    ..key.clone()
                },
                2,
            ),
            (
                Key {
                    identity: "other-bridge:1".into(),
                    ..key.clone()
                },
                3,
            ),
            (
                Key {
                    generation: 2,
                    ..key.clone()
                },
                4,
            ),
        ]);
        assert_eq!(take(&mut values, &key), Some(1));
        assert_eq!(take(&mut values, &key), None);
        assert_eq!(values.len(), 3);
    }
}
