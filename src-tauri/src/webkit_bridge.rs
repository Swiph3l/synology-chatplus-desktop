//! Linux/macOS provider transport through native evaluation callbacks. Remote
//! documents have no Tauri commands or capabilities. Only their bounded top-frame
//! outbox is sampled; an independent evaluation checks its document identity.
use super::{parse_diagnostic, parse_unread, trusted_origin, EventHistory};

const BATCH_LIMIT: usize = 32;
const MESSAGE_LIMIT: usize = 32_768;
const RESULT_LIMIT: usize = 2_097_152;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Batch {
    document_id: String,
    url: String,
    attention_epoch: Option<String>,
    messages: Vec<String>,
}

fn parse_batch(json: &str) -> Option<Batch> {
    if json.len() > RESULT_LIMIT {
        return None;
    }
    let value: Batch = serde_json::from_str(json).ok()?;
    (valid_document(&value.document_id)
        && value.url.len() <= 16_384
        && value.messages.len() <= BATCH_LIMIT
        && value
            .messages
            .iter()
            .all(|message| message.len() <= MESSAGE_LIMIT))
    .then_some(value)
}

fn valid_document(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document {
    document_id: String,
    url: String,
    attention_epoch: Option<String>,
}

fn current_document(batch: &Batch, value: &str, current: &url::Url) -> bool {
    if value.len() > 65_536 {
        return false;
    }
    let Ok(document) = serde_json::from_str::<Document>(value) else {
        return false;
    };
    document.document_id == batch.document_id
        && document.attention_epoch == batch.attention_epoch
        && document.url == batch.url
        && url::Url::parse(&document.url).is_ok_and(|url| url == *current)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IncomingNotification {
    chatplus_notification: u8,
    session: String,
    id: u64,
    title: String,
    body: String,
    tag: String,
    silent: bool,
}

fn parse_notification(json: &str) -> Option<IncomingNotification> {
    if json.len() > MESSAGE_LIMIT {
        return None;
    }
    let mut value: IncomingNotification = serde_json::from_str(json).ok()?;
    if value.chatplus_notification != 1
        || !valid_document(&value.session)
        || value.id == 0
        || value.id > 9_007_199_254_740_991
    {
        return None;
    }
    value.title = value.title.chars().take(160).collect();
    value.body = value.body.chars().take(500).collect();
    value.tag = super::bounded_notification_tag(&value.tag).into();
    Some(value)
}

#[cfg(any(not(windows), test))]
use tauri::Manager;

#[cfg(any(not(windows), test))]
const DOCUMENT: &str = "(()=>({documentId:window.__chatplusWebkitBridge?.documentId,url:location.href,attentionEpoch:window.__chatplusUnreadObservationEpoch??null}))()";

#[cfg(any(not(windows), test))]
pub(crate) async fn evaluate(
    view: &tauri::Webview,
    script: impl Into<String>,
) -> Result<String, ()> {
    let receiver = start_evaluation(view, script)?;
    tokio::time::timeout(std::time::Duration::from_secs(2), receiver)
        .await
        .map_err(|_| ())?
        .map_err(|_| ())
}

#[cfg(any(not(windows), test))]
fn start_evaluation(
    view: &tauri::Webview,
    script: impl Into<String>,
) -> Result<tokio::sync::oneshot::Receiver<String>, ()> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = std::sync::Mutex::new(Some(sender));
    view.eval_with_callback(script, move |value| {
        if let Some(sender) = sender
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
        {
            let _ = sender.send(value);
        }
    })
    .map_err(|_| ())?;
    Ok(receiver)
}

#[cfg(any(not(windows), test))]
async fn evaluate_live(
    app: &tauri::AppHandle,
    service: &crate::providers::ServiceConfig,
    bridge: u64,
    view: &tauri::Webview,
    script: impl Into<String>,
) -> Result<String, ()> {
    let mut receiver = start_evaluation(view, script)?;
    loop {
        tokio::select! {
            value = &mut receiver => return value.map_err(|_| ()),
            _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {
                if !live(app, service, bridge) || app.get_webview(view.label()).is_none() {
                    return Err(());
                }
            }
        }
    }
}

#[cfg(any(not(windows), test))]
pub fn attach(
    app: &tauri::AppHandle,
    view: &tauri::Webview,
    service: &crate::providers::ServiceConfig,
) -> tauri::Result<()> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let bridge = NEXT.fetch_add(1, Ordering::Relaxed);
    crate::external_links::track_source(app, view.label(), bridge);
    {
        let tracking = app.state::<crate::desktop_notifications::Service>();
        tracking
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .bridges
            .insert(
                service.id.clone(),
                (bridge, service.supports_notifications()),
            );
    }
    let app = app.clone();
    let service = service.clone();
    let label = view.label().to_string();
    tauri::async_runtime::spawn(async move {
        run(&app, &label, &service, bridge).await;
        let tracking = app.state::<crate::desktop_notifications::Service>();
        let mut tracking = tracking.0.lock().unwrap_or_else(|error| error.into_inner());
        if tracking
            .bridges
            .get(&service.id)
            .is_some_and(|(current, _)| *current == bridge)
        {
            tracking.bridges.remove(&service.id);
        }
    });
    Ok(())
}

#[cfg(any(not(windows), test))]
fn live(app: &tauri::AppHandle, service: &crate::providers::ServiceConfig, bridge: u64) -> bool {
    crate::services::configured(app, service) && super::current_bridge(app, &service.id, bridge)
}

#[cfg(any(not(windows), test))]
async fn run(
    app: &tauri::AppHandle,
    label: &str,
    service: &crate::providers::ServiceConfig,
    bridge: u64,
) {
    let mut history = EventHistory::<(String, u64)>::default();
    while live(app, service, bridge) {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if !live(app, service, bridge) {
            break;
        }
        let Some(view) = app.get_webview(label) else {
            break;
        };
        let Ok(before) = view.url() else {
            continue;
        };
        if !trusted_origin(&service.url, before.as_str()) {
            continue;
        }
        // Keep one pending receiver through OS sleep/renderer suspension. Never
        // submit another drain before it finishes; lifecycle checks cancel stale
        // sessions and a resumed renderer can recover without discarding packets.
        let Ok(value) = evaluate_live(
            app,
            service,
            bridge,
            &view,
            "window.__chatplusWebkitBridge?.drain()??null",
        )
        .await
        else {
            break;
        };
        let Some(batch) = parse_batch(&value) else {
            continue;
        };
        if batch.messages.is_empty() {
            continue;
        }
        let Ok(verification) = evaluate_live(app, service, bridge, &view, DOCUMENT).await else {
            break;
        };
        let Ok(current) = view.url() else {
            continue;
        };
        if current != before
            || !current_document(&batch, &verification, &current)
            || !live(app, service, bridge)
        {
            continue;
        }
        for packet in &batch.messages {
            if !live(app, service, bridge) {
                return;
            }
            crate::external_links::receive_packet(app, &view, service, &current, packet);
            if let Some(diagnostic) = parse_diagnostic(packet) {
                if diagnostic.source.accepts(service.unread_source_provider()) {
                    crate::diagnostics::notification(
                        app,
                        &service.id,
                        diagnostic.event,
                        diagnostic.reason,
                        diagnostic.generation,
                    );
                }
            } else if let Some(observation) = parse_unread(packet) {
                if !service.supports_unread() {
                    continue;
                }
                if let Some(epoch) = observation.attention_epoch.as_deref() {
                    if batch.attention_epoch.as_deref() != Some(epoch) {
                        continue;
                    }
                    let Some(query) = crate::unread::begin_attention_query(
                        app,
                        &service.id,
                        observation.known.then_some(observation.has_unread),
                    ) else {
                        continue;
                    };
                    loop {
                        let result = crate::unread::publish_attention_for(
                            app,
                            service,
                            bridge,
                            &query,
                            epoch,
                            observation.evidence.revision.unwrap(),
                            observation.known.then_some(observation.has_unread),
                            observation.count,
                        );
                        if result != crate::unread::AttentionPublication::Retry {
                            break;
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                        let Ok(verification) =
                            evaluate_live(app, service, bridge, &view, DOCUMENT).await
                        else {
                            return;
                        };
                        let Ok(current) = view.url() else {
                            return;
                        };
                        if !live(app, service, bridge)
                            || !current_document(&batch, &verification, &current)
                        {
                            return;
                        }
                    }
                } else {
                    crate::unread::publish_for(
                        app,
                        &service.id,
                        observation.count,
                        observation.known.then_some(observation.has_unread),
                        observation.source,
                        &observation.reason,
                        observation.acknowledgement,
                        &observation.read_arrivals,
                        observation.proof_only,
                        observation.provider_zero,
                        observation.conversation_read,
                        &observation.evidence,
                    );
                }
            } else if let Some(incoming) = parse_notification(packet) {
                if !service.supports_notifications() {
                    continue;
                }
                let (token, first) = history.observe((incoming.session, incoming.id));
                let generation = crate::unread::begin_incoming_for(
                    app,
                    &service.id,
                    first,
                    history.read_generation(token),
                );
                history.remember_read_generation(token, generation.read);
                let viewing = evaluate_live(
                    app,
                    service,
                    bridge,
                    &view,
                    super::viewing_query(&incoming.tag, &incoming.title, generation.read),
                )
                .await;
                // A conservative completion never invents a read when evaluation
                // fails, the document changes, or the source session is replaced.
                if !live(app, service, bridge) {
                    return;
                }
                crate::unread::complete_incoming_for(app, &service.id, generation.read, first);
                let verification = if viewing.is_ok() {
                    evaluate_live(app, service, bridge, &view, DOCUMENT).await
                } else {
                    Err(())
                };
                if !live(app, service, bridge) {
                    return;
                }
                let document_current = verification.as_ref().is_ok_and(|value| {
                    view.url()
                        .is_ok_and(|url| current_document(&batch, value, &url))
                });
                let viewed =
                    document_current && viewing.as_ref().is_ok_and(|value| value == "true");
                let owns_unread = crate::unread::provider_tracks_browser_arrivals(service.provider);
                if owns_unread
                    && crate::unread::acknowledged_after(app, &service.id, generation.read)
                {
                    crate::unread::accept_read_for(app, &service.id, &[generation.read]);
                    if verification.is_err() || !document_current {
                        return;
                    }
                    continue;
                }
                let native_viewed = crate::unread::incoming_for(
                    app,
                    &service.id,
                    first,
                    generation.read,
                    generation.visibility,
                    viewed,
                );
                let _ = view.eval(format!(
                    "window.__chatplusCompleteArrival?.({})",
                    generation.read
                ));
                if owns_unread
                    && native_viewed
                    && !crate::unread::arrival_requires_read(app, &service.id, generation.read)
                {
                    crate::unread::accept_read_for(app, &service.id, &[generation.read]);
                }
                crate::desktop_notifications::deliver_for(
                    app,
                    &service.id,
                    &incoming.title,
                    &incoming.body,
                    &incoming.tag,
                    &format!("{bridge}:{token}"),
                    first,
                    generation.visibility,
                    viewed,
                    generation.read,
                    incoming.silent,
                );
                if verification.is_err() || !document_current {
                    return;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_document_or_address_cannot_publish_a_drained_packet() {
        let id = "0123456789abcdef0123456789abcdef";
        let value = serde_json::json!({"documentId":id,"url":"https://nas.test/chat/","attentionEpoch":null,"messages":["{}"]});
        let batch = parse_batch(&value.to_string()).unwrap();
        let document = serde_json::json!({"documentId":id,"url":"https://nas.test/chat/","attentionEpoch":null});
        let url = url::Url::parse("https://nas.test/chat/").unwrap();
        assert!(current_document(&batch, &document.to_string(), &url));
        let mut changed = document.clone();
        changed["documentId"] = "11111111111111111111111111111111".into();
        assert!(!current_document(&batch, &changed.to_string(), &url));
        assert!(!current_document(
            &batch,
            &document.to_string(),
            &url::Url::parse("https://other.test/chat/").unwrap()
        ));
        let mut changed = value;
        changed["messages"] = serde_json::json!(vec!["{}"; BATCH_LIMIT + 1]);
        assert!(parse_batch(&changed.to_string()).is_none());
    }
    #[test]
    fn notification_identity_is_exact_and_untrusted_text_is_bounded() {
        let mut value = serde_json::json!({"chatplusNotification":1,"session":"0123456789abcdef0123456789abcdef","id":1,"title":"x".repeat(200),"body":"b".repeat(700),"tag":"t".repeat(513),"silent":false});
        let incoming = parse_notification(&value.to_string()).unwrap();
        assert_eq!(incoming.title.len(), 160);
        assert_eq!(incoming.body.len(), 500);
        assert!(incoming.tag.is_empty());
        value["id"] = 0.into();
        assert!(parse_notification(&value.to_string()).is_none());
        value["id"] = 1.into();
        value["session"] = "".into();
        assert!(parse_notification(&value.to_string()).is_none());
    }
}
