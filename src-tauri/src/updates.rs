use crate::state;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, Updater, UpdaterExt};
use tokio::sync::Notify;

const INTERVAL: u64 = 6 * 60 * 60;
const STARTUP_DELAY: u64 = 10;
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
    pub include_beta_updates: bool,
    pub phase: String,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub notes: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub message: String,
    pub message_code: String,
    pub last_successful_check: Option<u64>,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            include_beta_updates: false,
            configured: configuration().ready(),
            phase: "idle".into(),
            current_version: env!("CARGO_PKG_VERSION").into(),
            latest_version: None,
            notes: String::new(),
            downloaded: 0,
            total: None,
            message: String::new(),
            message_code: String::new(),
            last_successful_check: None,
        }
    }
}
impl Snapshot {
    fn message(&mut self, code: &str, text: impl Into<String>) {
        self.message_code = code.into();
        self.message = text.into();
    }
    fn for_preference(mut self, include_beta_updates: bool) -> Self {
        // Persistence can become visible before preference_changed acquires the
        // updater lock. Never expose a candidate selected by the old preference.
        if self.include_beta_updates != include_beta_updates {
            self.latest_version = None;
            self.notes.clear();
            self.downloaded = 0;
            self.total = None;
            if !matches!(
                self.phase.as_str(),
                "checking" | "downloading" | "installing"
            ) {
                self.phase = "idle".into();
            }
            self.message(
                "preference-changed",
                "Update preference changed. Check again.",
            );
        }
        self.include_beta_updates = include_beta_updates;
        self
    }
}

struct AutomaticSchedule {
    next_attempt: Option<Duration>,
}
impl Default for AutomaticSchedule {
    fn default() -> Self {
        Self {
            next_attempt: Some(Duration::from_secs(STARTUP_DELAY)),
        }
    }
}
impl AutomaticSchedule {
    fn claim(&mut self, enabled: bool, busy: bool, elapsed: Duration) -> bool {
        if !enabled || busy || self.next_attempt.is_some_and(|next| elapsed < next) {
            return false;
        }
        // Swiph3l: Attempts, including failures, advance a monotonic clock so an
        // offline endpoint cannot cause retry storms or wall-clock changes to skip checks.
        self.next_attempt = Some(elapsed.saturating_add(Duration::from_secs(INTERVAL)));
        true
    }
}
fn operation_busy(phase: &str) -> bool {
    matches!(phase, "checking" | "downloading" | "ready" | "installing")
}
#[derive(Default)]
pub struct Service(pub Mutex<Inner>);
#[derive(Default)]
pub struct Inner {
    snapshot: Snapshot,
    update: Option<Update>,
    release_tag: Option<String>,
    verified_bytes: Option<Vec<u8>>,
    cancel: Option<Arc<Notify>>,
    cancel_requested: bool,
    request_generation: u64,
}
impl Inner {
    fn begin_check(&mut self) -> Option<u64> {
        // Swiph3l: Startup, scheduled and manual checks share this locked gate;
        // a second request must not replace a download or a verified installer.
        if operation_busy(&self.snapshot.phase) {
            return None;
        }
        self.snapshot.phase = "checking".into();
        self.snapshot.message("checking", "Checking for updates...");
        Some(self.request_generation)
    }
    fn reset_preference(&mut self, include_beta_updates: bool) {
        self.verified_bytes = None;
        self.update = None;
        self.release_tag = None;
        self.snapshot.latest_version = None;
        self.snapshot.notes.clear();
        self.snapshot.downloaded = 0;
        self.snapshot.total = None;
        self.snapshot.include_beta_updates = include_beta_updates;
        self.snapshot.phase = "idle".into();
        self.snapshot.message(
            "preference-changed",
            "Update preference changed. Check again.",
        );
    }
    fn change_preference(&mut self, include_beta_updates: bool) {
        self.request_generation = self.request_generation.wrapping_add(1);
        let phase = self.snapshot.phase.clone();
        if phase == "downloading" {
            if let Some(cancel) = &self.cancel {
                cancel.notify_one();
            }
        }
        // Invalidate immediately, including during HTTP/verification. Keep the
        // operation gate closed until its stale completion has released the lock.
        self.reset_preference(include_beta_updates);
        if matches!(phase.as_str(), "checking" | "downloading" | "installing") {
            self.snapshot.phase = phase;
        }
    }
    fn discard_stale(
        &mut self,
        generation: u64,
        include_beta_updates: bool,
        current: bool,
    ) -> bool {
        if self.request_generation == generation && current == include_beta_updates {
            return false;
        }
        self.reset_preference(current);
        true
    }
    fn check_failed(&mut self, error: String) {
        // Swiph3l: A temporary network failure does not invalidate an already
        // discovered signed update or silently remove its indication.
        self.snapshot.phase = if self.update.is_some() {
            "available"
        } else {
            "error"
        }
        .into();
        self.snapshot.message("check-failed", error);
    }
}
pub fn snapshot(app: &AppHandle) -> Snapshot {
    let value = app
        .state::<Service>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .snapshot
        .clone();
    value.for_preference(state::current(app).include_beta_updates)
}
fn emit(app: &AppHandle) {
    let value = snapshot(app);
    for label in ["main", "update", "about", "settings"] {
        let _ = app.emit_to(label, "update-state", &value);
    }
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub fn accepts(current: &Version, candidate: &Version, include_beta_updates: bool) -> bool {
    candidate.cmp_precedence(current).is_gt() && (include_beta_updates || candidate.pre.is_empty())
}
fn https_asset(url: &url::Url, config: &Configuration) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && url.query().is_none()
        && url.fragment().is_none()
        && url.path().starts_with(&format!(
            "/{}/{}/releases/download/",
            config.owner, config.repository
        ))
}
pub fn builder<R: Runtime>(
    app: &AppHandle<R>,
    endpoint: url::Url,
    key: String,
    include_beta_updates: bool,
) -> Result<Updater, String> {
    build_updater(app, endpoint, key, include_beta_updates, false)
}
fn build_updater<R: Runtime>(
    app: &AppHandle<R>,
    endpoint: url::Url,
    key: String,
    include_beta_updates: bool,
    inspect_selected_manifest: bool,
) -> Result<Updater, String> {
    app.updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|_| "Invalid HTTPS update endpoint.")?
        .pubkey(key)
        .timeout(Duration::from_secs(120))
        .version_comparator(move |current, remote| {
            // A selected release must expose its manifest even when that manifest
            // announces an old/wrong version. Validate identity before accepting it.
            inspect_selected_manifest || accepts(&current, &remote.version, include_beta_updates)
        })
        .configure_client(|client| {
            client
                .https_only(true)
                .redirect(reqwest::redirect::Policy::limited(5))
        })
        .build()
        .map_err(|_| "Could not configure signed updates.".into())
}
#[derive(Clone, Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    assets: Vec<Asset>,
}
#[derive(Clone, Deserialize)]
struct Asset {
    name: String,
    browser_download_url: url::Url,
}

#[derive(Deserialize)]
struct PublishedRelease {
    #[serde(flatten)]
    release: Release,
    prerelease: bool,
    published_at: Option<String>,
}
struct SelectedRelease {
    manifest: url::Url,
    release: Release,
    version: Version,
}
enum EndpointSelection {
    Found(SelectedRelease),
    NoEligibleRelease,
}
struct CheckFailure {
    code: &'static str,
    message: String,
}
impl CheckFailure {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
impl From<String> for CheckFailure {
    fn from(message: String) -> Self {
        Self::new("check-failed", message)
    }
}
fn network_failure(error: reqwest::Error) -> CheckFailure {
    if error.is_timeout() {
        CheckFailure::new("check-timeout", "The update request timed out. Try again.")
    } else {
        CheckFailure::new("check-failed", "Unable to reach GitHub. Try again later.")
    }
}
fn response_failure(
    response: &reqwest::Response,
    missing_code: &'static str,
) -> Option<CheckFailure> {
    let status = response.status();
    if status.is_success() {
        return None;
    }
    let limited = status.as_u16() == 429
        || (status.as_u16() == 403
            && (response
                .headers()
                .get("x-ratelimit-remaining")
                .is_some_and(|value| value == "0")
                || response.headers().contains_key("retry-after")));
    Some(if limited {
        CheckFailure::new(
            "rate-limited",
            "GitHub rate-limited the update request. Try again later.",
        )
    } else if status.as_u16() == 404 {
        CheckFailure::new(
            missing_code,
            "The selected update resource is unavailable on GitHub.",
        )
    } else {
        CheckFailure::new("check-failed", "GitHub update metadata is unavailable.")
    })
}
fn release_asset_matches(asset: &Asset, config: &Configuration, tag: &str) -> bool {
    if !https_asset(&asset.browser_download_url, config)
        || !asset
            .name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.+".contains(&b))
    {
        return false;
    }
    let expected = format!(
        "/{}/{}/releases/download/{}/{}",
        config.owner, config.repository, tag, asset.name
    );
    // SemVer build metadata may be URL-encoded by either GitHub or the manifest.
    asset
        .browser_download_url
        .path()
        .replace("%2B", "+")
        .replace("%2b", "+")
        == expected
}
fn published_asset<'a>(
    release: &'a Release,
    config: &Configuration,
    url: &url::Url,
) -> Option<&'a Asset> {
    release.assets.iter().find(|asset| {
        release_asset_matches(asset, config, &release.tag_name)
            && asset
                .browser_download_url
                .as_str()
                .replace("%2B", "+")
                .replace("%2b", "+")
                == url.as_str().replace("%2B", "+").replace("%2b", "+")
    })
}

fn manifest_name(prerelease: bool) -> &'static str {
    match prerelease {
        false => "latest.json",
        true => "latest-prerelease.json",
    }
}

fn select_release_manifest(release: Release, config: &Configuration) -> Option<url::Url> {
    // Manifest naming belongs to the selected release, never to the preference:
    // beta opt-in also accepts stable releases with their ordinary latest.json.
    if release.draft {
        return None;
    }
    let version = Version::parse(
        release
            .tag_name
            .strip_prefix('v')
            .unwrap_or(&release.tag_name),
    )
    .ok()?;
    let manifest = manifest_name(!version.pre.is_empty());
    release
        .assets
        .into_iter()
        .find(|a| a.name == manifest && release_asset_matches(a, config, &release.tag_name))
        .map(|a| a.browser_download_url)
}

fn select_release(
    published: Vec<PublishedRelease>,
    current: &Version,
    include_beta_updates: bool,
    config: &Configuration,
) -> Result<EndpointSelection, CheckFailure> {
    // One selection rule serves manual, startup, and scheduled checks. Normal
    // SemVer precedence wins, so 0.6.0-beta.1 outranks 0.5.1 when betas are enabled.
    let selected = published
        .into_iter()
        .filter(|r| !r.release.draft)
        .filter(|r| {
            r.published_at
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
        })
        .filter(|r| include_beta_updates || !r.prerelease)
        .filter_map(|r| {
            Version::parse(
                r.release
                    .tag_name
                    .strip_prefix('v')
                    .unwrap_or(&r.release.tag_name),
            )
            .ok()
            .map(|v| (v, r))
        })
        .filter(|(v, _)| accepts(current, v, include_beta_updates))
        .max_by(|a, b| {
            a.0.cmp_precedence(&b.0)
                .then_with(|| b.1.prerelease.cmp(&a.1.prerelease))
        });
    let Some((version, published)) = selected else {
        return Ok(EndpointSelection::NoEligibleRelease);
    };
    let release = published.release;
    // Fail closed for the newest eligible release. Do not silently downgrade the
    // selected target when its manifest or signed installer is incomplete.
    let manifest = select_release_manifest(release.clone(), config).ok_or_else(|| {
        CheckFailure::new(
            "manifest-missing",
            "The newest eligible release has no trusted update manifest.",
        )
    })?;
    Ok(EndpointSelection::Found(SelectedRelease {
        manifest,
        release,
        version,
    }))
}

async fn endpoint(
    config: &Configuration,
    include_beta_updates: bool,
) -> Result<EndpointSelection, CheckFailure> {
    config.repository_url()?;
    // Swiph3l: Release selection uses semver precedence rather than GitHub order,
    // so a later-published beta cannot displace a newer eligible stable version.
    let client = reqwest::Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(20))
        .user_agent("ChatPlus-Desktop-Updater")
        .build()
        .map_err(|_| CheckFailure::new("check-failed", "Could not create update connection."))?;
    let mut published = Vec::new();
    for page in 1..=10 {
        let response = client
            .get(format!(
                "https://api.github.com/repos/{}/{}/releases?per_page=100&page={page}",
                config.owner, config.repository
            ))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(network_failure)?;
        if let Some(error) = response_failure(&response, "release-unavailable") {
            return Err(error);
        }
        let more = response
            .headers()
            .get("link")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.contains("rel=\"next\""));
        let batch: Vec<PublishedRelease> = response.json().await.map_err(|error| {
            if error.is_timeout() {
                network_failure(error)
            } else {
                CheckFailure::new("metadata-invalid", "Invalid GitHub release metadata.")
            }
        })?;
        published.extend(batch);
        if !more {
            break;
        }
        if page == 10 {
            return Err(CheckFailure::new(
                "check-failed",
                "GitHub release history exceeds the safe update query limit.",
            ));
        }
    }
    let current = Version::parse(env!("CARGO_PKG_VERSION")).unwrap();
    select_release(published, &current, include_beta_updates, config)
}
fn validate_selected_update(
    update: &Update,
    selected: &SelectedRelease,
    config: &Configuration,
) -> Result<(), CheckFailure> {
    let raw_version = update
        .raw_json
        .get("version")
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            CheckFailure::new("metadata-invalid", "Update metadata failed validation.")
        })?;
    let version = Version::parse(raw_version.strip_prefix('v').unwrap_or(raw_version))
        .map_err(|_| CheckFailure::new("metadata-invalid", "Update metadata failed validation."))?;
    if version != selected.version || update.version != selected.version.to_string() {
        return Err(CheckFailure::new(
            "version-mismatch",
            "The update manifest version does not match the selected release tag.",
        ));
    }
    let platforms = update.raw_json.get("platforms").ok_or_else(|| {
        CheckFailure::new(
            "release-incomplete",
            "The selected release has no Windows x64 update package.",
        )
    })?;
    let windows = platforms
        .get("windows-x86_64-nsis")
        .or_else(|| platforms.get("windows-x86_64"))
        .ok_or_else(|| {
            CheckFailure::new(
                "release-incomplete",
                "The selected release has no Windows x64 update package.",
            )
        })?;
    let windows_url: url::Url = windows
        .get("url")
        .and_then(|value| value.as_str())
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| {
            CheckFailure::new("metadata-invalid", "Update metadata failed validation.")
        })?;
    let expected_file = format!(
        "windows-x86_64--ChatPlus-Desktop_{}_x64-setup.exe",
        selected.version
    );
    let windows_asset = published_asset(&selected.release, config, &windows_url)
        .filter(|asset| asset.name == expected_file)
        .ok_or_else(|| {
            CheckFailure::new(
                "release-incomplete",
                "The selected release has no trusted Windows x64 installer.",
            )
        })?;
    let signature = windows
        .get("signature")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CheckFailure::new(
                "release-incomplete",
                "The selected update package has no signature.",
            )
        })?;
    if !selected.release.assets.iter().any(|asset| {
        asset.name == format!("{}.sig", windows_asset.name)
            && release_asset_matches(asset, config, &selected.release.tag_name)
    }) {
        return Err(CheckFailure::new(
            "release-incomplete",
            "The selected update package has no published signature asset.",
        ));
    }
    let artifact =
        published_asset(&selected.release, config, &update.download_url).ok_or_else(|| {
            CheckFailure::new("metadata-invalid", "Update metadata failed validation.")
        })?;
    if update.signature.trim().is_empty()
        || !selected.release.assets.iter().any(|asset| {
            asset.name == format!("{}.sig", artifact.name)
                && release_asset_matches(asset, config, &selected.release.tag_name)
        })
    {
        return Err(CheckFailure::new(
            "release-incomplete",
            "The selected update package has no published signature asset.",
        ));
    }
    if cfg!(all(windows, target_arch = "x86_64"))
        && (artifact.name != expected_file || update.signature != signature)
    {
        return Err(CheckFailure::new(
            "metadata-invalid",
            "Update metadata failed validation.",
        ));
    }
    Ok(())
}
pub async fn check(app: &AppHandle, _manual: bool) -> Result<Snapshot, String> {
    let config = configuration();
    let include_beta_updates = state::current(app).include_beta_updates;
    let generation = {
        let state = app.state::<Service>();
        let mut inner = state.0.lock().unwrap_or_else(|e| e.into_inner());
        if operation_busy(&inner.snapshot.phase) {
            return Ok(inner.snapshot.clone().for_preference(include_beta_updates));
        }
        if inner.snapshot.include_beta_updates != include_beta_updates {
            inner.reset_preference(include_beta_updates);
        }
        if !config.ready() {
            inner.snapshot.message(
                "unconfigured",
                "Signed updates are not configured for this development build.",
            );
            inner.snapshot.phase = "unconfigured".into();
            drop(inner);
            emit(app);
            return Ok(snapshot(app));
        }
        inner.snapshot.include_beta_updates = include_beta_updates;
        inner
            .begin_check()
            .expect("operation checked while holding its lock")
    };
    emit(app);
    let result: Result<Option<(Update, String)>, CheckFailure> = async {
        let selected = match endpoint(&config, include_beta_updates).await? {
            EndpointSelection::Found(selected) => selected,
            EndpointSelection::NoEligibleRelease => return Ok(None),
        };
        let update = build_updater(
            app,
            selected.manifest.clone(),
            config.updater_public_key.clone(),
            include_beta_updates,
            true,
        )?
        .check()
        .await
        .map_err(|error| match error {
            tauri_plugin_updater::Error::Reqwest(error) => network_failure(error),
            tauri_plugin_updater::Error::ReleaseNotFound => CheckFailure::new(
                "manifest-missing",
                "The selected update manifest is unavailable.",
            ),
            tauri_plugin_updater::Error::TargetNotFound(_)
            | tauri_plugin_updater::Error::TargetsNotFound(_) => CheckFailure::new(
                "release-incomplete",
                "The selected release has no update package for this platform.",
            ),
            tauri_plugin_updater::Error::Serialization(_)
            | tauri_plugin_updater::Error::Semver(_) => {
                CheckFailure::new("metadata-invalid", "Update metadata failed validation.")
            }
            _ => CheckFailure::new(
                "check-failed",
                "Unable to check for updates. Check your connection and try again.",
            ),
        })?
        .ok_or_else(|| {
            CheckFailure::new(
                "manifest-missing",
                "The selected release returned no update manifest.",
            )
        })?;
        validate_selected_update(&update, &selected, &config)?;
        if !accepts(
            &Version::parse(env!("CARGO_PKG_VERSION")).unwrap(),
            &selected.version,
            include_beta_updates,
        ) {
            return Err(CheckFailure::new(
                "version-mismatch",
                "The selected update version is not eligible for this update preference.",
            ));
        }
        Ok(Some((update, selected.release.tag_name)))
    }
    .await;
    {
        let service = app.state::<Service>();
        let mut inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
        if inner.discard_stale(
            generation,
            include_beta_updates,
            state::current(app).include_beta_updates,
        ) {
            // Swiph3l: The preference can change away and back while HTTP is pending;
            // generation checks reject both cases instead of resurrecting stale results.
            drop(inner);
            emit(app);
            return Ok(snapshot(app));
        }
        match result {
            Ok(update) => {
                let (update, release_tag) = update
                    .map(|(update, tag)| (Some(update), Some(tag)))
                    .unwrap_or((None, None));
                if let Some(ref update) = update {
                    inner.snapshot.latest_version = Some(update.version.clone());
                    inner.snapshot.notes = update
                        .body
                        .as_deref()
                        .unwrap_or_default()
                        .chars()
                        .take(16000)
                        .collect();
                    inner.snapshot.phase = "available".into();
                    inner
                        .snapshot
                        .message("available", "An update is available.");
                } else {
                    inner.snapshot.latest_version = None;
                    inner.snapshot.notes.clear();
                    inner.snapshot.phase = "current".into();
                    inner.snapshot.message(
                        "no-eligible-release",
                        "No newer published release is available for the saved update preference.",
                    );
                }
                inner.update = update;
                inner.release_tag = release_tag;
                let checked_at = now();
                inner.snapshot.last_successful_check = Some(checked_at);
                let _ = state::persist_value(app, "lastUpdateCheck", checked_at.into());
            }
            Err(error) => {
                if matches!(
                    error.code,
                    "metadata-invalid"
                        | "version-mismatch"
                        | "manifest-missing"
                        | "release-incomplete"
                ) {
                    inner.update = None;
                    inner.release_tag = None;
                    inner.verified_bytes = None;
                    inner.snapshot.latest_version = None;
                    inner.snapshot.notes.clear();
                }
                inner.check_failed(error.message.clone());
                inner.snapshot.message(error.code, error.message);
            }
        }
    }
    emit(app);
    // Swiph3l: Automatic results stay in Settings and the footer; opening or
    // focusing a window here would interrupt startup and background conversations.
    Ok(snapshot(app))
}
pub async fn download(app: &AppHandle) -> Result<(), String> {
    let (update, cancel, generation, include_beta_updates) = {
        let service = app.state::<Service>();
        let mut inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
        if inner.snapshot.phase != "available" {
            return Err("Check for an update before downloading.".into());
        }
        let mut update = inner.update.clone().ok_or("No update available.")?;
        // Pinned updater 2.11 does not copy the builder timeout into Update.
        // Bound the actual installer transfer as well as the manifest request.
        update.timeout = Some(Duration::from_secs(120));
        let include_beta_updates = state::current(app).include_beta_updates;
        // Persisted settings change before preference_changed reaches this lock.
        // Keep a cached candidate bound to the preference that selected it.
        if inner.snapshot.include_beta_updates != include_beta_updates {
            return Err("Check again for the saved update preference.".into());
        }
        if !accepts(
            &Version::parse(env!("CARGO_PKG_VERSION")).unwrap(),
            &Version::parse(&update.version).map_err(|_| "Invalid version.")?,
            include_beta_updates,
        ) {
            return Err("Check again for the saved update preference.".into());
        }
        let cancel = Arc::new(Notify::new());
        inner.cancel = Some(cancel.clone());
        inner.cancel_requested = false;
        inner.verified_bytes = None;
        inner.snapshot.phase = "downloading".into();
        inner.snapshot.downloaded = 0;
        inner.snapshot.total = None;
        inner
            .snapshot
            .message("downloading", "Downloading update...");
        (
            update,
            cancel,
            inner.request_generation,
            include_beta_updates,
        )
    };
    emit(app);
    let mut last_event = std::time::Instant::now();
    let mut too_large = false;
    let future = update.download(
        |chunk, total| {
            let service = app.state::<Service>();
            let mut inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
            if inner.request_generation != generation
                || inner.snapshot.include_beta_updates != include_beta_updates
            {
                return;
            }
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
    let mut result =
        tokio::select! { biased; _ = cancel.notified() => None, result = future => Some(result) };
    let service = app.state::<Service>();
    let mut inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
    inner.cancel = None;
    // A cancel request can arrive while signature verification is finishing.
    // It still wins before the locked transition makes those bytes installable.
    if inner.cancel_requested {
        result = None;
    }
    inner.cancel_requested = false;
    if inner.discard_stale(
        generation,
        include_beta_updates,
        state::current(app).include_beta_updates,
    ) {
        // Swiph3l: Cancellation can race with signature verification finishing;
        // stale bytes must never become installable after a preference change.
        drop(inner);
        emit(app);
        return Ok(());
    }
    let mut failure = None;
    match result {
        Some(Ok(bytes))
            if !too_large && !bytes.is_empty() && bytes.len() as u64 <= MAX_DOWNLOAD =>
        {
            // Swiph3l: The updater download future verifies the existing public-key
            // signature before returning bytes; raw HTTP bytes must never enter ready.
            inner.verified_bytes = Some(bytes);
            inner.snapshot.phase = "ready".into();
            inner.snapshot.message(
                "ready",
                "Signature verified. Restart and update when you are ready.",
            );
        }
        None if !too_large => {
            inner.snapshot.phase = "available".into();
            inner.snapshot.message("cancelled", "Download cancelled.");
        }
        _ => {
            inner.snapshot.phase = "available".into();
            inner.snapshot.message(
                "download-failed",
                "Download or signature verification failed. Nothing was installed.",
            );
            failure = Some(
                "Download or signature verification failed. Nothing was installed.".to_string(),
            );
        }
    }
    drop(inner);
    emit(app);
    failure.map_or(Ok(()), Err)
}
pub fn cancel(app: &AppHandle) {
    let service = app.state::<Service>();
    let mut inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(cancel) = inner.cancel.clone() {
        inner.cancel_requested = true;
        cancel.notify_one();
    }
}
pub fn preference_changed(app: &AppHandle) {
    let include_beta_updates = state::current(app).include_beta_updates;
    let service = app.state::<Service>();
    let mut inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
    inner.change_preference(include_beta_updates);
    drop(inner);
    emit(app);
}
pub fn install(app: &AppHandle, confirmed: bool) -> Result<(), String> {
    install_checked(app, confirmed, None)
}
pub fn install_for(
    app: &AppHandle,
    confirmed: bool,
    expected_version: &str,
    expected_include_beta_updates: bool,
) -> Result<(), String> {
    install_checked(
        app,
        confirmed,
        Some((expected_version, expected_include_beta_updates)),
    )
}
fn install_checked(
    app: &AppHandle,
    confirmed: bool,
    expected: Option<(&str, bool)>,
) -> Result<(), String> {
    // Swiph3l: Download verification is independent from consent. Every install
    // entry point must supply explicit confirmation before consuming verified bytes.
    if !confirmed {
        return Err("Confirm restart before installing.".into());
    }
    let (update, bytes, generation, include_beta_updates) = {
        let service = app.state::<Service>();
        let mut inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
        if inner.snapshot.phase != "ready" {
            return Err("A verified download is required.".into());
        }
        let update = inner.update.clone().ok_or("No verified update.")?;
        let include_beta_updates = state::current(app).include_beta_updates;
        if inner.snapshot.include_beta_updates != include_beta_updates {
            return Err(
                "The update changed after confirmation. Review it and confirm again.".into(),
            );
        }
        if expected.is_some_and(|(version, expected_include_beta_updates)| {
            update.version != version || include_beta_updates != expected_include_beta_updates
        }) {
            return Err(
                "The update changed after confirmation. Review it and confirm again.".into(),
            );
        }
        if !accepts(
            &Version::parse(env!("CARGO_PKG_VERSION")).unwrap(),
            &Version::parse(&update.version).map_err(|_| "Invalid version.")?,
            include_beta_updates,
        ) {
            return Err("This version is not eligible for the saved update preference.".into());
        }
        let bytes = inner.verified_bytes.take().ok_or("No verified download.")?;
        inner.snapshot.phase = "installing".into();
        inner
            .snapshot
            .message("installing", "Starting update installer...");
        (
            update,
            bytes,
            inner.request_generation,
            include_beta_updates,
        )
    };
    emit(app);
    if update.install(&bytes).is_err() {
        let service = app.state::<Service>();
        let mut inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
        if !inner.discard_stale(
            generation,
            include_beta_updates,
            state::current(app).include_beta_updates,
        ) {
            inner.verified_bytes = Some(bytes);
            inner.snapshot.phase = "ready".into();
            inner.snapshot.message(
                "install-failed",
                "Installation failed. Close other instances and try again.",
            );
        }
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
    let tag = {
        let service = app.state::<Service>();
        let inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
        inner.release_tag.clone()
    };
    let value = tag
        .map(|tag| format!("{base}/releases/tag/{tag}"))
        .unwrap_or(format!("{base}/releases"));
    app.opener()
        .open_url(value, None::<&str>)
        .map_err(|_| "Could not open release notes.".into())
}
pub fn start(app: &AppHandle) {
    if let Ok(value) = state::stored_value(app, "lastUpdateCheck") {
        let last = value.and_then(|v| v.as_u64());
        app.state::<Service>()
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .snapshot
            .last_successful_check = last;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let started = std::time::Instant::now();
        let mut schedule = AutomaticSchedule::default();
        // Swiph3l: Startup checks belong to a detached task after the shell paints;
        // the saved timestamp is display history and must not suppress this launch's check.
        tokio::time::sleep(Duration::from_secs(STARTUP_DELAY)).await;
        loop {
            let settings = state::current(&app);
            let due = {
                let service = app.state::<Service>();
                let inner = service.0.lock().unwrap_or_else(|e| e.into_inner());
                // Swiph3l: Updating ChatPlus is independent of service setup;
                // a user with no active server still needs application security updates.
                schedule.claim(
                    settings.automatic_updates && configuration().ready(),
                    operation_busy(&inner.snapshot.phase),
                    started.elapsed(),
                )
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

    fn github_release(tag: &str, draft: bool, prerelease: bool) -> PublishedRelease {
        let version = Version::parse(tag.strip_prefix('v').unwrap_or(tag)).ok();
        let manifest = manifest_name(version.is_some_and(|version| !version.pre.is_empty()));
        // Deserialize the same GitHub API shape used by the HTTP check instead
        // of reproducing a version-only approximation of the selector in tests.
        serde_json::from_value(serde_json::json!({
            "tag_name": tag,
            "draft": draft,
            "prerelease": prerelease,
            "published_at": if draft { serde_json::Value::Null } else { serde_json::json!("2026-10-14T08:00:00Z") },
            "assets": [{
                "name": manifest,
                "browser_download_url": format!("https://github.com/Swiph3l/synology-chatplus-desktop/releases/download/{tag}/{manifest}")
            }]
        })).unwrap()
    }

    #[test]
    fn published_release_selection_covers_stable_and_beta_upgrade_matrix() {
        for (case, current, include_beta_updates, releases, expected) in [
            (
                "A stable upgrade",
                "0.5.0",
                false,
                vec![("v0.5.1", false, false)],
                Some("0.5.1"),
            ),
            (
                "B beta excluded",
                "0.5.0",
                false,
                vec![("v0.6.0-beta.1", false, true)],
                None,
            ),
            (
                "C SemVer wins with beta opt-in",
                "0.5.0",
                true,
                vec![("v0.5.1", false, false), ("v0.6.0-beta.1", false, true)],
                Some("0.6.0-beta.1"),
            ),
            (
                "D beta installation never downgrades",
                "0.5.0-beta.5",
                false,
                vec![("v0.4.9", false, false), ("v0.5.0-beta.6", false, true)],
                None,
            ),
            (
                "E beta upgrades to its final stable",
                "0.5.0-beta.5",
                false,
                vec![("v0.5.0", false, false)],
                Some("0.5.0"),
            ),
            (
                "F numeric beta precedence",
                "0.5.0-beta.5",
                true,
                vec![
                    ("v0.5.0-beta.10", false, true),
                    ("v0.5.0-beta.6", false, true),
                ],
                Some("0.5.0-beta.10"),
            ),
            (
                "G drafts excluded with beta off",
                "0.5.0",
                false,
                vec![("v1.0.0", true, false), ("v2.0.0-beta.1", true, true)],
                None,
            ),
            (
                "G drafts excluded with beta on",
                "0.5.0",
                true,
                vec![("v1.0.0", true, false), ("v2.0.0-beta.1", true, true)],
                None,
            ),
            (
                "stable wins over older prerelease",
                "0.5.0",
                true,
                vec![("v0.6.0", false, false), ("v0.6.0-beta.10", false, true)],
                Some("0.6.0"),
            ),
            (
                "beta opt-in still accepts stable",
                "0.5.0",
                true,
                vec![("v0.5.1", false, false)],
                Some("0.5.1"),
            ),
            (
                "GitHub prerelease flag excludes final-looking tag",
                "0.5.0",
                false,
                vec![("v0.6.0", false, true)],
                None,
            ),
            (
                "GitHub prerelease flag accepts final-looking tag with opt-in",
                "0.5.0",
                true,
                vec![("v0.6.0", false, true)],
                Some("0.6.0"),
            ),
            (
                "SemVer prerelease excludes incorrect stable flag",
                "0.5.0",
                false,
                vec![("v0.6.0-beta.1", false, false)],
                None,
            ),
            (
                "SemVer prerelease accepts incorrect stable flag with opt-in",
                "0.5.0",
                true,
                vec![("v0.6.0-beta.1", false, false)],
                Some("0.6.0-beta.1"),
            ),
            (
                "equal precedence and build metadata are not upgrades",
                "0.5.0",
                true,
                vec![("v0.5.0", false, false), ("v0.5.0+build.2", false, false)],
                None,
            ),
            (
                "invalid tags ignored",
                "0.5.0",
                true,
                vec![("not-a-version", false, false), ("v0.5.1", false, false)],
                Some("0.5.1"),
            ),
        ] {
            let releases = releases
                .into_iter()
                .map(|(tag, draft, prerelease)| github_release(tag, draft, prerelease))
                .collect();
            let selected = select_release(
                releases,
                &Version::parse(current).unwrap(),
                include_beta_updates,
                &configuration(),
            )
            .unwrap_or_else(|error| panic!("{case}: {}", error.message));
            let version = match selected {
                EndpointSelection::Found(selected) => {
                    assert!(
                        selected
                            .manifest
                            .path()
                            .ends_with(manifest_name(!selected.version.pre.is_empty())),
                        "{case}"
                    );
                    Some(selected.version.to_string())
                }
                EndpointSelection::NoEligibleRelease => None,
            };
            assert_eq!(version.as_deref(), expected, "{case}");
        }
    }

    #[test]
    fn unpublished_release_metadata_is_never_a_candidate() {
        for published_at in [None, Some(""), Some("   ")] {
            let mut unpublished = github_release("v9.0.0", false, false);
            unpublished.published_at = published_at.map(str::to_owned);
            let selected = select_release(
                vec![unpublished],
                &Version::parse("0.5.0").unwrap(),
                true,
                &configuration(),
            );
            assert!(matches!(selected, Ok(EndpointSelection::NoEligibleRelease)));
        }
    }

    #[test]
    fn incomplete_newest_release_fails_closed_instead_of_falling_back() {
        let older = github_release("v0.5.1", false, false);
        let mut newest = github_release("v0.6.0-beta.1", false, true);
        newest.release.assets.clear();
        match select_release(
            vec![newest, older],
            &Version::parse("0.5.0").unwrap(),
            true,
            &configuration(),
        ) {
            Err(error) => assert_eq!(error.code, "manifest-missing"),
            Ok(_) => panic!("An incomplete newest release must not select an older target"),
        }
    }

    #[test]
    fn published_release_manifest_assets_remain_confined_to_the_selected_project_tag() {
        let mut newest = github_release("v0.6.0", false, false);
        newest.release.assets[0].browser_download_url =
            "https://github.com/another/project/releases/download/v0.6.0/latest.json"
                .parse()
                .unwrap();
        match select_release(
            vec![newest],
            &Version::parse("0.5.0").unwrap(),
            false,
            &configuration(),
        ) {
            Err(error) => assert_eq!(error.code, "manifest-missing"),
            Ok(_) => panic!("A foreign manifest asset must not become a target"),
        }
    }

    #[test]
    fn beta_opt_in_and_release_manifest_types() {
        assert_eq!(manifest_name(false), "latest.json");
        assert_eq!(manifest_name(true), "latest-prerelease.json");
        let current = Version::parse("0.5.0-beta.1").unwrap();
        let next = Version::parse("0.5.0-beta.2").unwrap();
        assert!(accepts(&current, &next, true));
        assert!(!accepts(&current, &next, false));
        assert!(!accepts(&next, &current, true));
        assert!(accepts(&current, &Version::parse("0.5.0").unwrap(), false));
        assert!(accepts(
            &Version::parse("0.5.0-beta.2").unwrap(),
            &Version::parse("0.5.0-rc.1").unwrap(),
            true
        ));
        assert!(accepts(
            &Version::parse("0.5.0-rc.1").unwrap(),
            &Version::parse("0.5.0").unwrap(),
            true
        ));
    }
    #[test]
    fn stable_release_uses_its_stable_manifest() {
        let config = configuration();
        let release = release("v0.5.0", vec![asset("latest.json",
            "https://github.com/Swiph3l/synology-chatplus-desktop/releases/download/v0.5.0/latest.json")]);
        assert!(select_release_manifest(release, &config)
            .unwrap()
            .path()
            .ends_with("latest.json"));
    }

    #[test]
    fn beta_preference_never_downgrades() {
        let current = Version::parse("0.1.0").unwrap();
        for version in ["0.0.9", "0.1.0", "0.1.0+build"] {
            assert!(!accepts(&current, &Version::parse(version).unwrap(), true));
        }
        assert!(!accepts(
            &current,
            &Version::parse("0.2.0-rc.1").unwrap(),
            false
        ));
        assert!(accepts(
            &current,
            &Version::parse("0.2.0-rc.1").unwrap(),
            true
        ));
        assert!(accepts(&current, &Version::parse("0.1.1").unwrap(), false));
    }
    #[test]
    fn startup_and_six_hour_schedule_use_a_fake_clock() {
        let mut schedule = AutomaticSchedule::default();
        let mut clock = Duration::ZERO;
        assert!(!schedule.claim(true, false, clock));
        clock += Duration::from_secs(STARTUP_DELAY - 1);
        assert!(!schedule.claim(true, false, clock));
        clock += Duration::from_secs(1);
        assert!(schedule.claim(true, false, clock));
        assert!(!schedule.claim(true, false, clock));
        clock += Duration::from_secs(INTERVAL - 1);
        assert!(!schedule.claim(true, false, clock));
        clock += Duration::from_secs(1);
        assert!(schedule.claim(true, false, clock));
    }
    #[test]
    fn disabled_or_busy_automatic_schedule_does_not_consume_the_due_check() {
        let mut schedule = AutomaticSchedule::default();
        let clock = Duration::from_secs(STARTUP_DELAY);
        assert!(!schedule.claim(false, false, clock));
        assert!(!schedule.claim(true, true, clock));
        assert!(schedule.claim(true, false, clock));
    }
    #[test]
    fn failures_do_not_trigger_rapid_automatic_retries() {
        let mut schedule = AutomaticSchedule::default();
        let clock = Duration::from_secs(STARTUP_DELAY);
        assert!(schedule.claim(true, false, clock));
        for minute in 1..360 {
            assert!(!schedule.claim(true, false, clock + Duration::from_secs(minute * 60)));
        }
        assert!(schedule.claim(true, false, clock + Duration::from_secs(INTERVAL)));
    }
    #[test]
    fn recent_persisted_check_is_history_not_a_startup_scheduling_gate() {
        let inner = Inner {
            snapshot: Snapshot {
                last_successful_check: Some(now()),
                ..Snapshot::default()
            },
            ..Inner::default()
        };
        let mut schedule = AutomaticSchedule::default();
        assert!(inner.snapshot.last_successful_check.is_some());
        assert!(schedule.claim(
            true,
            operation_busy(&inner.snapshot.phase),
            Duration::from_secs(STARTUP_DELAY)
        ));
    }
    #[test]
    fn overlapping_checks_share_one_operation_gate() {
        let service = Arc::new(Service::default());
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let service = service.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    service.0.lock().unwrap().begin_check().is_some()
                })
            })
            .collect();
        barrier.wait();
        let accepted = workers
            .into_iter()
            .map(|worker| usize::from(worker.join().unwrap()))
            .sum::<usize>();
        assert_eq!(accepted, 1);
        for phase in ["downloading", "ready", "installing"] {
            let mut inner = service.0.lock().unwrap();
            inner.snapshot.phase = phase.into();
            assert!(inner.begin_check().is_none());
        }
    }
    #[test]
    fn preference_changes_invalidate_in_flight_checks_even_after_switching_back() {
        let mut inner = Inner::default();
        let generation = inner.begin_check().unwrap();
        inner.change_preference(true);
        inner.change_preference(false);
        assert!(inner.begin_check().is_none());
        assert!(inner.discard_stale(generation, false, false));
        assert_eq!(inner.snapshot.phase, "idle");
        assert!(inner.begin_check().is_some());
    }
    #[test]
    fn preference_change_cannot_publish_a_stale_verified_download() {
        let mut inner = Inner::default();
        inner.snapshot.phase = "downloading".into();
        inner.cancel = Some(Arc::new(Notify::new()));
        let generation = inner.request_generation;
        inner.change_preference(true);
        inner.verified_bytes = Some(vec![1, 2, 3]);
        assert!(inner.discard_stale(generation, false, false));
        assert!(inner.verified_bytes.is_none());
        assert_eq!(inner.snapshot.phase, "idle");
    }

    #[test]
    fn preference_changes_immediately_clear_candidates_and_ready_bytes_in_every_phase() {
        for phase in [
            "available",
            "checking",
            "downloading",
            "ready",
            "installing",
        ] {
            let mut inner = Inner::default();
            inner.snapshot.include_beta_updates = true;
            inner.snapshot.phase = phase.into();
            inner.snapshot.latest_version = Some("0.6.0-beta.1".into());
            inner.snapshot.notes = "Cached beta notes".into();
            inner.snapshot.downloaded = 123;
            inner.snapshot.total = Some(456);
            inner.release_tag = Some("v0.6.0-beta.1".into());
            inner.verified_bytes = Some(vec![1, 2, 3]);
            let generation = inner.request_generation;
            inner.change_preference(false);
            assert!(!inner.snapshot.include_beta_updates, "{phase}");
            assert!(inner.snapshot.latest_version.is_none(), "{phase}");
            assert!(inner.snapshot.notes.is_empty(), "{phase}");
            assert_eq!(inner.snapshot.downloaded, 0, "{phase}");
            assert!(inner.snapshot.total.is_none(), "{phase}");
            assert!(inner.release_tag.is_none(), "{phase}");
            assert!(inner.verified_bytes.is_none(), "{phase}");
            assert_ne!(generation, inner.request_generation, "{phase}");
            if matches!(phase, "checking" | "downloading" | "installing") {
                assert_eq!(inner.snapshot.phase, phase);
                assert!(inner.begin_check().is_none(), "{phase}");
            } else {
                // Ready has no future to unwind after its bytes are discarded.
                assert_eq!(inner.snapshot.phase, "idle", "{phase}");
                assert!(inner.begin_check().is_some(), "{phase}");
            }
        }
    }

    #[test]
    fn snapshots_hide_old_candidates_before_preference_notification_acquires_the_lock() {
        for phase in ["available", "checking", "downloading", "ready"] {
            let mut snapshot = Snapshot::default();
            snapshot.include_beta_updates = true;
            snapshot.phase = phase.into();
            snapshot.latest_version = Some("0.6.0-beta.1".into());
            snapshot.notes = "Old beta notes".into();
            let updated = snapshot.for_preference(false);
            assert!(!updated.include_beta_updates);
            assert!(updated.latest_version.is_none(), "{phase}");
            assert!(updated.notes.is_empty(), "{phase}");
            assert_eq!(updated.message_code, "preference-changed", "{phase}");
            if phase == "ready" {
                assert_eq!(updated.phase, "idle");
            }
        }
        let payload = serde_json::to_value(Snapshot::default()).unwrap();
        assert_eq!(
            payload.get("includeBetaUpdates"),
            Some(&serde_json::json!(false))
        );
        assert!(payload.get("channel").is_none());
    }

    #[test]
    fn semver_prerelease_order_is_strictly_increasing() {
        let beta1 = Version::parse("0.5.0-beta.1").unwrap();
        let beta2 = Version::parse("0.5.0-beta.2").unwrap();
        let rc1 = Version::parse("0.5.0-rc.1").unwrap();
        let stable = Version::parse("0.5.0").unwrap();
        assert!(accepts(&beta1, &beta2, true));
        assert!(!accepts(&beta2, &beta1, true));
        assert!(accepts(&beta2, &rc1, true));
        assert!(accepts(&beta2, &stable, true));
        assert!(accepts(&rc1, &stable, true));
        let beta3 = Version::parse("0.5.0-beta.3").unwrap();
        let beta4 = Version::parse("0.5.0-beta.4").unwrap();
        let beta10 = Version::parse("0.5.0-beta.10").unwrap();
        assert!(accepts(&beta3, &beta4, true));
        assert!(accepts(&beta4, &beta10, true));
        assert!(!accepts(&beta10, &beta4, true));
        assert!(accepts(&beta10, &Version::parse("0.5.1").unwrap(), true));
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
        let selected = select_release_manifest(release, &config)
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
        assert!(select_release_manifest(release, &config).is_none());
    }

    #[test]
    fn prerelease_semver_uses_its_manifest_even_without_a_matching_github_flag() {
        let config = configuration();
        let release = release("v0.5.0-beta.6", vec![asset("latest-prerelease.json",
            "https://github.com/Swiph3l/synology-chatplus-desktop/releases/download/v0.5.0-beta.6/latest-prerelease.json")]);
        assert!(select_release_manifest(release, &config)
            .unwrap()
            .path()
            .ends_with("latest-prerelease.json"));
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
