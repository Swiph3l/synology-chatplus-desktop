# Desktop lifecycle and settings follow-up — 2026-10-04

Development remains **0.5.0-beta.3**. This work creates no release, tag or version
bump. Automated checks below are distinct from native Windows acceptance.

## Unread and notification lifecycle

The previous DOM adapter accepted disappearing provider indicators as a read
transition after a 250 ms delay. Selected WebViews can retain focus and clear
their own indicators while the host is minimized or backgrounded, so this could
erase unread without a user reading anything. The desktop cache accepted that
false observation without independent acknowledgement.

Unread now belongs to each service's provider state. Native main-window
visibility, focus and minimization determine which service can be acknowledged.
Service selection and WebView focus alone do not acknowledge unread. A trusted
user interaction in the foreground provider and a valid provider observation
with no unread markers are required to clear a cached unread state. Native
validation rejects acknowledgements from older presentation generations.
Missing/disconnected provider UI and background badge removal retain the cache.

Background WebView2 notifications update their service's unread state before
notification preferences, permissions, conversation cooldown or foreground
suppression are considered. Unread therefore does not depend on whether Windows
displays a toast. Enabled services' caches drive the rail, title, tray and taskbar
aggregate independently; acknowledging one does not clear another. Foreground
selected conversations rely on provider badges rather than synthesizing a stale
unread state for a message already being viewed.

Missing toasts had two avoidable causes: the post-navigation startup gate
suppressed real incoming events, and five-second content fingerprints treated
distinct messages with identical contents as duplicates. The native bridge now
uses retained canonical COM event identity, not message text, for duplicate
filtering. Its apartment-local history keeps the latest 256 objects alive to
prevent pointer recycling; bridge/event tokens identify native delivery attempts.
Duplicate callbacks cannot recreate unread or revoke newer acknowledgements.
Failed native submissions can retry through a separate delivery reservation. The
user's conversation cooldown remains a separate policy and can intentionally
limit repeated notifications. Notification text, account data and URLs are not
written to logs or persistent storage.

Windows activation dispatches to the existing application's main thread,
restores/shows/focuses its main window, selects the originating enabled service,
then focuses its child WebView. It preserves the provider's conversation state;
there is no safe conversation destination in the existing payload. Removed or
disabled destinations cannot recreate a service or another process. Activation
itself does not acknowledge unread.

Only Synology ChatPlus currently supplies the supported unread/native
notification adapter. Synology Chat, Slack, Discord and Mattermost retain their
experimental status and existing capability restrictions. Lazy service views
still need to have been activated once before they can receive live events.

## Settings and application frame

Settings contains **General, Notifications, Updates, Services, Changelog, About**.
The compact navigation and Save/Close controls stay visible while the selected
panel scrolls internally. Changing sections preserves unsaved settings and
service drafts. Removal still confirms and persists immediately without saving
unrelated drafts; existing persistence/concurrency guards remain in place.

Changelog content ships from the repository's `CHANGELOG.md`, using text nodes
rather than executable HTML. About retains the installed version, independent
community/non-affiliation notice, project links, diagnostics and license access.

The main application footer reserves **30 logical pixels** under the native
service views. It shows the installed version, lightweight update/network/error
status, and Console, Donate, Report issue and About actions. Console and Donate
are disabled and show the localized “Coming soon” tooltip. Report issue uses the
existing project Issues destination; About opens its Settings section. Status
changes retain a fixed layout, and rail refreshes preserve footer keyboard focus.

## Update scheduling and safety

Automatic checking runs asynchronously 10 seconds after startup and approximately
every six hours while enabled. Startup does not wait for the request, and a previous launch's
successful timestamp does not suppress the new startup check. Disabled automatic
checking performs no scheduled request. The scheduler and manual checks share
one operation guard; channel changes invalidate old asynchronous results.

Automatic checks publish non-blocking status to the footer and Updates panel.
No-update and network-error results do not open or focus a dialog. Manual checks
show progress/results in the Updates panel. Downloaded bytes must pass the
official Tauri signature check; installation/restart still requires explicit user
confirmation. HTTPS and repository asset restrictions remain in effect.

Stable accepts stable releases only. Pre-release accepts beta/RC versions and
newer stable releases. Eligibility and ordering use SemVer precedence, including
beta.3 < beta.4 < 0.5.0 < 0.5.1; build metadata does not create an upgrade.
Preferences and the last successful check remain persisted. The existing
prerelease release-list bound remains 100 published releases.

## Localization

English, Polish and neutral Spanish share one resource key set, with persisted
language preference. ChatPlus settings, service controls, confirmations,
notifications, update UI, About/license controls, footer, native menus and tray
use these resources. Product/provider names and third-party web applications
retain their own names/languages. Bundled changelog and license source documents
are displayed verbatim; they are not independently translated manual copies.
Legacy settings default to English and retain their existing service profiles.

## Files and regression coverage

- Localization: `src/i18n/{en.json,pl.json,es.json,index.ts,runtime.ts,updates.ts}`,
  `src-tauri/src/i18n.rs`, `src/app/settings.ts`, `src-tauri/src/state.rs`,
  `tsconfig.json`, `index.html`.
- Notifications: `src/theme/unread.ts`,
  `src-tauri/src/{unread.rs,desktop_notifications.rs,notification_bridge.rs,platform.rs,window.rs}`.
- Updates: `src/app/updates.ts`, `src/ui/update.ts`,
  `src-tauri/src/{updates.rs,updater_tests.rs}`.
- Settings/About/Changelog: `src/settings/{settings.ts,services.ts,changelog.ts,settings.css}`,
  `src/ui/{about.ts,license.ts,service-removal.ts}`, `src/main.ts`,
  `src-tauri/src/{shell.rs,menu.rs}`.
- Footer/native integration: `src/ui/{footer.ts,services.ts,shell.css}`,
  `src-tauri/src/{services.rs,commands.rs,main.rs,connection.rs,tray.rs}`.
- Tests added: `tests/{footer.test.mjs,localization.test.mjs,changelog.test.mjs,updates.test.mjs}`.
  Tests updated: `tests/{services.test.mjs,settings.test.mjs,unread.test.mjs}`;
  Rust regressions are alongside their owned modules and in `updater_tests.rs`.
- Documentation: this report, `docs/NOTIFICATIONS.md`,
  `docs/WINDOWS_ACCEPTANCE.md`, `docs/DEVELOPMENT_STATUS.md`.

Regressions cover minimized/selected unread retention, genuine/current
acknowledgement, stale gestures/generations, per-service/aggregate state,
foreground suppression, event deduplication and failed submission retries,
origin-service notification activation, footer geometry/focus/snapshot races,
fake-clock startup/six-hour/disabled scheduling, concurrent request and channel
changes, SemVer ordering, HTTPS/signatures/offline cache preservation, explicit
install consent/cancellation, settings draft/removal/language persistence races,
safe release-note rendering and localization key/placeholder parity.

## Validation and acceptance

Commands ran from the repository root with existing dependencies and the existing
local Windows Rust/MSVC toolchain. PowerShell uses `npm.cmd` because `npm.ps1` is
disabled by local execution policy. The Rust environment was loaded with:

```powershell
$taskEnv = Get-Content -LiteralPath '..\Tools\dev-env.ps1' -Raw
Invoke-Expression $taskEnv
$env:CARGO_TARGET_DIR = 'E:\chatplus_synology_client\Workspace\beta3-validation\cargo-target'
```

| Command                                                                                                        | Result                                                                                                         |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run format:check`                                                                                     | PASS                                                                                                           |
| `npm.cmd run typecheck`                                                                                        | PASS                                                                                                           |
| `npm.cmd test`                                                                                                 | PASS: 84 passed, 0 failed, 0 skipped                                                                           |
| `npm.cmd run build`                                                                                            | PASS: TypeScript, Vite production assets and theme bootstrap                                                   |
| `npm.cmd run check:release`                                                                                    | PASS: development fixture excluded from production assets                                                      |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`                                                    | PASS                                                                                                           |
| `cargo check --locked --manifest-path src-tauri/Cargo.toml`                                                    | PASS                                                                                                           |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml`                                                     | PASS: 84 passed, 0 failed, 1 ignored                                                                           |
| `cargo test --release --locked --manifest-path src-tauri/Cargo.toml`                                           | PASS: 84 passed, 0 failed, 1 ignored                                                                           |
| `npm.cmd audit --json`                                                                                         | PASS: zero vulnerabilities                                                                                     |
| `cargo audit --file src-tauri/Cargo.lock --db $taskAdvisoryDb --no-fetch --json`                               | PASS: zero vulnerabilities; six existing unmaintained warnings and one existing Linux glib unsoundness warning |
| `cargo deny --format json --manifest-path src-tauri/Cargo.toml --config deny.toml --locked check --show-stats` | PASS: all four policy checks; 20 duplicate-version and two unused license allowance/exception warnings         |
| `node scripts/audit-linux.mjs`                                                                                 | Existing policy classification: Linux REQUIRES REVIEW; glib advisory absent from Windows graph                 |
| `..\Tools\security\gitleaks\gitleaks.exe git --log-opts=8c197fc..HEAD --redact --no-banner .`                  | PASS: no secrets in new commits                                                                                |
| `git diff --cached \| ..\Tools\security\gitleaks\gitleaks.exe stdin --redact --no-banner`                      | PASS: no secrets in staged documentation                                                                       |
| `git diff --check`                                                                                             | PASS                                                                                                           |

The existing ignored Rust test, `production_artifact_signature_verifies`, requires
a separate production artifact and signature. Signed HTTPS updater fixtures ran,
including valid/bad signatures, channel changes, offline failures, cancellation
and cached bytes. No dependency, signature, HTTPS or provider-capability policy
was weakened.

RustSec was fetched from its official repository during this validation, at
`ef6173cbc5c50ec8166f9a5b28f07834144373ee` (2026-10-03). The `--no-fetch`
audit uses this fresh database, not an older offline cache:

```powershell
$env:PATH = 'E:\chatplus_synology_client\Tools\security\bin;' + $env:PATH
$env:GIT_CONFIG_COUNT = '2'
$env:GIT_CONFIG_KEY_0 = 'safe.directory'
$env:GIT_CONFIG_VALUE_0 = 'E:/chatplus_synology_client/Tools/cargo/advisory-dbs/advisory-db-3157b0e258782691'
$env:GIT_CONFIG_KEY_1 = 'http.sslBackend'
$env:GIT_CONFIG_VALUE_1 = 'openssl'
$taskAdvisoryDb = 'E:\chatplus_synology_client\Workspace\beta3-validation\advisory-db-20261004'
git -c http.sslBackend=openssl -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=15 clone --depth=1 https://github.com/RustSec/advisory-db.git $taskAdvisoryDb
```

The existing audit cache had a missing origin, and Git's Schannel backend failed
inside the local sandbox. A fresh workspace database and process-scoped OpenSSL
backend recovered live checking. Cargo-deny's existing cache also needed a
process-scoped Git ownership exception for its exact public advisory database.
No global Git settings or security policy were changed. The existing
[dependency-policy findings](DEPENDENCY_POLICY.md) remain: Linux distribution
requires review of `glib 0.18.5` / `RUSTSEC-2024-0429`; this finding is absent from
the Windows normal/build/dev graph. Audit logs remain outside the repository.
The existing local tools were cargo-audit 0.22.2 and cargo-deny 0.20.2.

Browser layout validation used the existing local headless Edge/Playwright
fixture: `npm.cmd run dev -- --configLoader runner`, then
`node ../Workspace/desktop-followup-ui-check.mjs`. It passed 72 panel layouts and
nine shell/footer layouts across EN/PL/ES, 1366×768, 1920×1080, 900×600 and the
720×600 settings window; onboarding was checked at 460×280. Tab keyboard routing,
footer focus/status/actions and DOM overflow checks passed. The fixture, logs and
screenshots remain outside the repository; it mocks native Tauri boundaries.

Implementation commits, in dependency order:

| Commit    | Subject                                                    |
| --------- | ---------------------------------------------------------- |
| `0bfbcc2` | feat: add shared desktop localization resources            |
| `dce33b6` | feat: schedule quiet updates with guarded channels         |
| `dc38f81` | fix: preserve unread through native window transitions     |
| `4eb05b4` | feat: organize localized settings with changelog and about |
| `fed9bde` | feat: add compact application status footer                |

The documentation commit contains this report and the updated notification,
development-status and acceptance documents.

See [the current acceptance checklist](WINDOWS_ACCEPTANCE.md#19-2026-10-04-lifecycle-settings-and-footer-acceptance)
for exact Windows steps. Automated DOM/clock/state/signature checks cannot prove
real provider read acknowledgement, native banners, notification clicks, Windows
DPI transitions, authenticated account retention or signed production
install/restart. These remain manual acceptance requirements. The previously
reported authenticated login/migration acceptance gate remains open; these changes
do not establish readiness for a stable release.
