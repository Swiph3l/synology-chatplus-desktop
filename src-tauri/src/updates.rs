use crate::state::{self, UpdateChannel};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::StoreExt;
use tauri_plugin_updater::{Update, Updater, UpdaterExt};
use tokio::sync::Notify;

const INTERVAL: u64 = 6 * 60 * 60;
const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024;
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Configuration {
    pub owner: String,
    pub repository: String,
    pub updater_enabled: bool,
    pub updater_public_key: String,
}
pub fn configuration() -> Configuration {
    serde_json::from_str(include_str!("../../project.json")).expect("bundled project metadata")
}
impl Configuration {
    fn repository_url(&self) -> Result<String, String> {
        let valid = |s: &str| {
            !s.is_empty()
                && s.len() <= 100
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
                && s != "."
                && s != ".."
        };
        if !valid(&self.owner) || !valid(&self.repository) {
            return Err("Update repository is not configured correctly.".into());
        }
        Ok(format!(
            "https://github.com/{}/{}",
            self.owner, self.repository
        ))
    }
    fn ready(&self) -> bool {
        self.updater_enabled
            && !self.updater_public_key.trim().is_empty()
            && self.repository_url().is_ok()
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub configured: bool,
    pub channel: UpdateChannel,
    pub phase: String,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub notes: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub message: String,
    pub last_successful_check: Option<u64>,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            channel: UpdateChannel::Stable,
            configured: configuration().ready(),
            phase: "idle".into(),
            current_version: env!("CARGO_PKG_VERSION").into(),
            latest_version: None,
            notes: String::new(),
            downloaded: 0,
            total: None,
            message: String::new(),
            last_successful_check: None,
        }
    }
}
#[derive(Default)]
pub struct Service(pub Mutex<Inner>);
#[derive(Default)]
pub struct Inner {
    snapshot: Snapshot,
    update: Option<Update>,
    verified_bytes: Option<Vec<u8>>,
    cancel: Option<Arc<Notify>>,
    next_auto_attempt: u64,
}
pub fn snapshot(app: &AppHandle) -> Snapshot {
    let mut value = app
        .state::<Service>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .snapshot
        .clone();
    value.channel = state::current(app).update_channel;
    value
}
fn emit(app: &AppHandle) {
    let value = snapshot(app);
    for label in ["update", "about", "settings"] {
        let _ = app.emit_to(label, "update-state", &value);
    }
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub fn accepts(current: &Version, candidate: &Version, channel: &UpdateChannel) -> bool {
    candidate.cmp_precedence(current).is_gt()
        && (matches!(channel, UpdateChannel::PreRelease) || candidate.pre.is_empty())
}
pub fn automatic_due(enabled: bool, last: Option<u64>, next: u64, at: u64) -> bool {
    enabled && at >= next && last.is_none_or(|last| at.saturating_sub(last) >= INTERVAL)
}
fn https_asset(url: &url::Url, config: &Configuration) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && url.path().starts_with(&format!(
            "/{}/{}/releases/download/",
            config.owner, config.repository
        ))
}
pub fn builder<R: Runtime>(
    app: &AppHandle<R>,
    endpoint: url::Url,
    key: String,
    channel: UpdateChannel,
) -> Result<Updater, String> {
    app.updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|_| "Invalid HTTPS update endpoint.")?
        .pubkey(key)
        .timeout(Duration::from_secs(120))
        .version_comparator(move |current, remote| accepts(&current, &remote.version, &channel))
        .configure_client(|client| {
            client
                .https_only(true)
                .redirect(reqwest::redirect::Policy::limited(5))
        })
        .build()
        .map_err(|_| "Could not configure signed updates.".into())
}
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: url::Url,
}

enum EndpointSelection {
    Found(url::Url),
    MissingManifest,
}

fn manifest_name(channel: &UpdateChannel) -> &'static str {
    match channel {
        UpdateChannel::Stable => "latest.json",
        UpdateChannel::PreRelease => "latest-prerelease.json",
    }
}

fn select_release_manifest(
    release: Release,
    config: &Configuration,
    channel: &UpdateChannel,
) -> Option<url::Url> {
    // Pre-release must never read the stable manifest.
    // TODO(Swiph3l): verify this against a clean beta.1 -> beta.2 install.
    release
        .assets
        .into_iter()
        .find(|a| a.name == manifest_name(channel) && https_asset(&a.browser_download_url, config))
        .map(|a| a.browser_download_url)
}

async fn endpoint(
    config: &Configuration,
    channel: &UpdateChannel,
) -> Result<EndpointSelection, String> {
    let repository = config.repository_url()?;
    if matches!(channel, UpdateChannel::Stable) {
        return Ok(EndpointSelection::Found(
            format!("{repository}/releases/latest/download/latest.json")
                .parse()
                .unwrap(),
        ));
    }
    // Published release JSON, never HTML scraping. No account token is used.
    let client = reqwest::Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(20))
        .user_agent("ChatPlus-Desktop-Updater")
        .build()
        .map_err(|_| "Could not create update connection.")?;
    let response = client
        .get(format!(
            "https://api.github.com/repos/{}/{}/releases?per_page=100",
            config.owner, config.repository
        ))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| "Unable to reach GitHub. Try again later.")?
        .error_for_status()
        .map_err(|_| "GitHub update metadata is unavailable.")?;
    let releases: Vec<Release> = response
        .json()
        .await
        .map_err(|_| "Invalid GitHub release metadata.")?;
    let current = Version::parse(env!("CARGO_PKG_VERSION")).unwrap();
    let mut releases: Vec<_> = releases
        .into_iter()
        .filter(|r| !r.draft)
        .filter_map(|r| {
            Version::parse(r.tag_name.trim_start_matches('v'))
                .ok()
                .map(|v| (v, r))
        })
        .filter(|(v, _)| accepts(&current, v, channel))
        .collect();
    releases.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, release) in releases {
        if let Some(url) = select_release_manifest(release, config, channel) {
            return Ok(EndpointSelection::Found(url));
        }
    }
    Ok(EndpointSelection::MissingManifest)
}
pub async fn check(app: &AppHandle, manual: bool) -> Result<Snapshot, String> {
    let config = configuration();
    let channel = state::current(app).update_channel;
    {
        let state = app.state::<Service>();
        let mut inner = state.0.lock().unwrap_or_else(|e| e.into_inner());
        if matches!(
            inner.snapshot.phase.as_str(),
            "checking" | "downloading" | "ready" | "installing"
        ) {
            return Ok(inner.snapshot.clone());
        }
        if !config.ready() {
            inner.snapshot.message =
                "Signed updates are not configured for this development build.".into();
            inner.snapshot.phase = "unconfigured".into();
            drop(inner);
            emit(app);
            return Ok(snapshot(app));
        }
        inner.snapshot.phase = "checking".into();
        inner.snapshot.message = "Checking for updates...".into();
        inner.snapshot.latest_version = None;
        inner.snapshot.notes.clear();
        inner.update = None;
        inner.verified_bytes = None;
    }
    emit(app);
    let result =
        async {
            let endpoint =
                match endpoint(&config, &channel).await? {
                    EndpointSelection::Found(endpoint) => endpoint,
                    EndpointSelection::MissingManifest => {
                        return Ok((None, Some(
                    "No eligible pre-release manifest was found for the selected channel."
                        .to_string(),
                )));
                    }
                };
            let update = builder(
                app,
                endpoint,
                config.updater_public_key.clone(),
                channel.clone(),
            )?
            .check()
            .await
            .map_err(|_| {
                "Unable to check for updates. Check your connection and try again.".to_string()
            })?;
            Ok((update, None))
        }
        .await;
    let mut show = false;
    {
        let service = app.state::<Service>();
        let mut inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
        if state::current(app).update_channel != channel {
            inner.snapshot.phase = "idle".into();
            inner.snapshot.message = "Update channel changed. Check again.".into();
            drop(inner);
            emit(app);
            return Ok(snapshot(app));
        }
        match result {
            Ok((update, message_override)) => {
                if let Some(ref update) = update {
                    if !https_asset(&update.download_url, &config)
                        || Version::parse(&update.version).ok().is_none_or(|v| {
                            !accepts(
                                &Version::parse(env!("CARGO_PKG_VERSION")).unwrap(),
                                &v,
                                &channel,
                            )
                        })
                    {
                        inner.snapshot.phase = "error".into();
                        inner.snapshot.message = "Update metadata failed validation.".into();
                        drop(inner);
                        emit(app);
                        return Err("Update metadata failed validation.".into());
                    }
                    inner.snapshot.latest_version = Some(update.version.clone());
                    inner.snapshot.notes = update
                        .body
                        .as_deref()
                        .unwrap_or("No release notes provided.")
                        .chars()
                        .take(16000)
                        .collect();
                    inner.snapshot.phase = "available".into();
                    inner.snapshot.message = "An update is available.".into();
                    show = true;
                } else {
                    inner.snapshot.phase = "current".into();
                    inner.snapshot.message =
                        message_override.unwrap_or_else(|| "You're up to date.".to_string());
                }
                inner.update = update;
                inner.snapshot.last_successful_check = Some(now());
                if let Ok(store) = app.store("settings.json") {
                    store.set("lastUpdateCheck", now());
                    let _ = store.save();
                }
            }
            Err(error) => {
                inner.snapshot.phase = "error".into();
                inner.snapshot.message = error;
            }
        }
    }
    emit(app);
    if show || manual {
        let _ = crate::shell::update(app);
    }
    Ok(snapshot(app))
}
pub async fn download(app: &AppHandle) -> Result<(), String> {
    let (update, cancel) = {
        let service = app.state::<Service>();
        let mut inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
        if inner.snapshot.phase != "available" {
            return Err("Check for an update before downloading.".into());
        }
        let update = inner.update.clone().ok_or("No update available.")?;
        if !accepts(
            &Version::parse(env!("CARGO_PKG_VERSION")).unwrap(),
            &Version::parse(&update.version).map_err(|_| "Invalid version.")?,
            &state::current(app).update_channel,
        ) {
            return Err("Check again for the selected channel.".into());
        }
        let cancel = Arc::new(Notify::new());
        inner.cancel = Some(cancel.clone());
        inner.verified_bytes = None;
        inner.snapshot.phase = "downloading".into();
        inner.snapshot.downloaded = 0;
        inner.snapshot.total = None;
        inner.snapshot.message = "Downloading update...".into();
        (update, cancel)
    };
    emit(app);
    let mut last_event = std::time::Instant::now();
    let mut too_large = false;
    let future = update.download(
        |chunk, total| {
            let service = app.state::<Service>();
            let mut inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
            inner.snapshot.downloaded = inner.snapshot.downloaded.saturating_add(chunk as u64);
            inner.snapshot.total = total;
            if inner.snapshot.downloaded > MAX_DOWNLOAD || total.is_some_and(|n| n > MAX_DOWNLOAD) {
                too_large = true;
                cancel.notify_one();
            }
            drop(inner);
            if last_event.elapsed() > Duration::from_millis(150) {
                emit(app);
                last_event = std::time::Instant::now();
            }
        },
        || {},
    );
    let result =
        tokio::select! { biased; _ = cancel.notified() => None, result = future => Some(result) };
    let service = app.state::<Service>();
    let mut inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
    inner.cancel = None;
    match result {
        Some(Ok(bytes)) if !too_large => {
            inner.verified_bytes = Some(bytes);
            inner.snapshot.phase = "ready".into();
            inner.snapshot.message =
                "Signature verified. Restart and update when you are ready.".into();
        }
        None if !too_large => {
            inner.snapshot.phase = "available".into();
            inner.snapshot.message = "Download cancelled.".into();
        }
        _ => {
            inner.snapshot.phase = "available".into();
            inner.snapshot.message =
                "Download or signature verification failed. Nothing was installed.".into();
        }
    }
    drop(inner);
    emit(app);
    Ok(())
}
pub fn cancel(app: &AppHandle) {
    if let Some(cancel) = &app
        .state::<Service>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .cancel
    {
        cancel.notify_one();
    }
}
pub fn channel_changed(app: &AppHandle) {
    let service = app.state::<Service>();
    let mut inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
    if inner.snapshot.phase == "downloading" {
        if let Some(cancel) = &inner.cancel {
            cancel.notify_one();
        }
    } else if !matches!(inner.snapshot.phase.as_str(), "checking" | "installing") {
        inner.verified_bytes = None;
        inner.update = None;
        inner.snapshot.latest_version = None;
        inner.snapshot.notes.clear();
        inner.snapshot.phase = "idle".into();
        inner.snapshot.message = "Update channel changed. Check again.".into();
    }
    drop(inner);
    emit(app);
}
pub fn install(app: &AppHandle, confirmed: bool) -> Result<(), String> {
    if !confirmed {
        return Err("Confirm restart before installing.".into());
    }
    let (update, bytes) = {
        let service = app.state::<Service>();
        let mut inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
        if inner.snapshot.phase != "ready" {
            return Err("A verified download is required.".into());
        }
        let update = inner.update.clone().ok_or("No verified update.")?;
        let channel = state::current(app).update_channel;
        if !accepts(
            &Version::parse(env!("CARGO_PKG_VERSION")).unwrap(),
            &Version::parse(&update.version).map_err(|_| "Invalid version.")?,
            &channel,
        ) {
            return Err("This version is not eligible for the selected channel.".into());
        }
        let bytes = inner.verified_bytes.take().ok_or("No verified download.")?;
        inner.snapshot.phase = "installing".into();
        inner.snapshot.message = "Starting update installer...".into();
        (update, bytes)
    };
    emit(app);
    if update.install(&bytes).is_err() {
        let service = app.state::<Service>();
        let mut inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
        inner.verified_bytes = Some(bytes);
        inner.snapshot.phase = "ready".into();
        inner.snapshot.message = "Installation failed. Close other instances and try again.".into();
        drop(inner);
        emit(app);
        return Err("Could not start the update installer.".into());
    }
    #[cfg(not(windows))]
    app.restart();
    Ok(())
}
pub fn open_release_page(app: &AppHandle) -> Result<(), String> {
    let config = configuration();
    let base = config.repository_url()?;
    let value = snapshot(app)
        .latest_version
        .map(|v| format!("{base}/releases/tag/v{v}"))
        .unwrap_or(format!("{base}/releases"));
    app.opener()
        .open_url(value, None::<&str>)
        .map_err(|_| "Could not open release notes.".into())
}
pub fn start(app: &AppHandle) {
    if let Ok(store) = app.store("settings.json") {
        let last = store.get("lastUpdateCheck").and_then(|v| v.as_u64());
        app.state::<Service>()
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .snapshot
            .last_successful_check = last;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        loop {
            let settings = state::current(&app);
            let due = {
                let service = app.state::<Service>();
                let mut inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
                let due = automatic_due(
                    settings.automatic_updates
                        && !settings.server_url.is_empty()
                        && configuration().ready(),
                    inner.snapshot.last_successful_check,
                    inner.next_auto_attempt,
                    now(),
                );
                if due {
                    inner.next_auto_attempt = now() + INTERVAL;
                }
                due
            };
            if due {
                let _ = check(&app, false).await;
            }
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;

    fn asset(name: &str, url: &str) -> Asset {
        Asset {
            name: name.into(),
            browser_download_url: url.parse().unwrap(),
        }
    }

    fn release(tag: &str, assets: Vec<Asset>) -> Release {
        Release {
            tag_name: tag.into(),
            draft: false,
            assets,
        }
    }

    #[test]
    fn beta_upgrade_and_manifest_channels() {
        assert_eq!(manifest_name(&UpdateChannel::Stable), "latest.json");
        assert_eq!(
            manifest_name(&UpdateChannel::PreRelease),
            "latest-prerelease.json"
        );
        let current = Version::parse("0.5.0-beta.1").unwrap();
        let next = Version::parse("0.5.0-beta.2").unwrap();
        assert!(accepts(&current, &next, &UpdateChannel::PreRelease));
        assert!(!accepts(&current, &next, &UpdateChannel::Stable));
        assert!(!accepts(&next, &current, &UpdateChannel::PreRelease));
        assert!(accepts(
            &current,
            &Version::parse("0.5.0").unwrap(),
            &UpdateChannel::Stable
        ));
        assert!(accepts(
            &Version::parse("0.5.0-beta.2").unwrap(),
            &Version::parse("0.5.0-rc.1").unwrap(),
            &UpdateChannel::PreRelease
        ));
        assert!(accepts(
            &Version::parse("0.5.0-rc.1").unwrap(),
            &Version::parse("0.5.0").unwrap(),
            &UpdateChannel::PreRelease
        ));
    }
    #[test]
    fn channel_policy_never_downgrades() {
        let current = Version::parse("0.1.0").unwrap();
        for version in ["0.0.9", "0.1.0", "0.1.0+build"] {
            assert!(!accepts(
                &current,
                &Version::parse(version).unwrap(),
                &UpdateChannel::PreRelease
            ));
        }
        assert!(!accepts(
            &current,
            &Version::parse("0.2.0-rc.1").unwrap(),
            &UpdateChannel::Stable
        ));
        assert!(accepts(
            &current,
            &Version::parse("0.2.0-rc.1").unwrap(),
            &UpdateChannel::PreRelease
        ));
        assert!(accepts(
            &current,
            &Version::parse("0.1.1").unwrap(),
            &UpdateChannel::Stable
        ));
    }
    #[test]
    fn disabled_and_recent_checks_do_not_request_network() {
        assert!(!automatic_due(false, None, 0, 100));
        assert!(!automatic_due(true, Some(100), 0, 101));
        assert!(!automatic_due(true, None, 200, 100));
        assert!(automatic_due(true, Some(100), 0, 100 + INTERVAL));
    }

    #[test]
    fn semver_prerelease_order_is_strictly_increasing() {
        let beta1 = Version::parse("0.5.0-beta.1").unwrap();
        let beta2 = Version::parse("0.5.0-beta.2").unwrap();
        let rc1 = Version::parse("0.5.0-rc.1").unwrap();
        let stable = Version::parse("0.5.0").unwrap();
        assert!(accepts(&beta1, &beta2, &UpdateChannel::PreRelease));
        assert!(!accepts(&beta2, &beta1, &UpdateChannel::PreRelease));
        assert!(accepts(&beta2, &rc1, &UpdateChannel::PreRelease));
        assert!(accepts(&beta2, &stable, &UpdateChannel::PreRelease));
        assert!(accepts(&rc1, &stable, &UpdateChannel::PreRelease));
    }

    #[test]
    fn prerelease_manifest_selection_never_falls_back_to_stable_manifest() {
        let config = configuration();
        let release = release(
            "v0.5.0-beta.2",
            vec![
                asset(
                    "latest.json",
                    "https://github.com/Swiph3l/synology-chatplus-desktop/releases/download/v0.5.0-beta.2/latest.json",
                ),
                asset(
                    "latest-prerelease.json",
                    "https://github.com/Swiph3l/synology-chatplus-desktop/releases/download/v0.5.0-beta.2/latest-prerelease.json",
                ),
            ],
        );
        let selected = select_release_manifest(release, &config, &UpdateChannel::PreRelease)
            .unwrap()
            .to_string();
        assert!(selected.ends_with("latest-prerelease.json"));
    }

    #[test]
    fn prerelease_without_prerelease_manifest_returns_none() {
        let config = configuration();
        let release = release(
            "v0.5.0-beta.2",
            vec![asset(
                "latest.json",
                "https://github.com/Swiph3l/synology-chatplus-desktop/releases/download/v0.5.0-beta.2/latest.json",
            )],
        );
        assert!(select_release_manifest(release, &config, &UpdateChannel::PreRelease).is_none());
    }

    #[test]
    fn manifest_selection_is_shared_for_manual_and_automatic_checks() {
        // Keep the channel decision in one place so manual and automatic checks cannot diverge.
        let automatic_manifest = manifest_name(&UpdateChannel::PreRelease);
        let manual_manifest = manifest_name(&UpdateChannel::PreRelease);
        assert_eq!(automatic_manifest, manual_manifest);
        assert_eq!(automatic_manifest, "latest-prerelease.json");
        assert_eq!(manifest_name(&UpdateChannel::Stable), "latest.json");
    }
    #[test]
    fn updater_assets_are_confined_to_project_https() {
        let c = configuration();
        assert!(!https_asset(
            &"http://github.com/Swiph3l/synology-chatplus-desktop/releases/download/v1/a"
                .parse()
                .unwrap(),
            &c
        ));
        assert!(!https_asset(&"https://example.com/a".parse().unwrap(), &c));
        let disabled = Configuration {
            updater_enabled: false,
            ..c
        };
        assert!(!disabled.ready());
    }
}

#[cfg(test)]
#[path = "updater_tests.rs"]
mod updater_tests;
