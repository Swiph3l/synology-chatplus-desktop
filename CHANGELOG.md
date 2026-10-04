# Changelog

All notable changes will be documented here. Versions follow Semantic Versioning.

## 0.5.0-beta.4

### Fixed

- Fixed update notes unnecessarily scrolling in larger windows. Thanks to
  Azathoth for reporting this.
- Retain each service's cached unread through minimize/background, selection and
  logically focused WebView transitions. Read acknowledgement now requires native
  foreground visibility, actual conversation input and current provider read proof.
- Require matching provider conversation evidence before native toast suppression;
  selected services and unknown/failed renderer queries permit conservative delivery.
- Separate native arrivals from visibility/read generations, exclude pending
  arrivals from early acknowledgements and require fresh, exact event-view proof
  before reading a native arrival. Content mutations cannot acknowledge it.
- Keep native notification completion on the owning WebView apartment; callback,
  timeout and synchronous failure cannot complete/deliver the same event twice.
  Preview/tag/deferral failures retain trusted arrivals using safe fallbacks.
- Preserve saved per-service mute preferences when enabling provider support or
  changing provider. Distinct legitimate browser events retain separate identities
  even with identical notification contents.

### Changed

- Add independent unread/native notification support for Synology Chat and Discord
  alongside Synology ChatPlus, without injecting ChatPlus styling into either.
- Audit provider-specific boolean unread evidence: ChatPlus tab indicators,
  Synology Chat ordinary-unread versus mention badges, and Discord guild/DM
  navigation. Partial, virtualized and mention-only zero surfaces remain unknown.
- Project native foreground into Discord's public focus API and Synology Chat's
  public visibility API to prevent minimized WebViews acting as visible readers.
- Add provider, content/arrival race, mute and native delivery regressions. Preserve
  the existing restore-before-origin-service toast activation path and updater.

This candidate's implementation and automated checks do not establish live
Windows acceptance. All three providers' notifications, minimized active
conversation behavior, unread persistence, native toasts and toast activation
remain **PENDING**, as does native Settings/footer visual inspection. Conservative
unknown read evidence can retain unread. Synology native-arrival unread can remain
after reading until restart reobserves provider state because no exact notification
tag mapping is audited. Incomplete Discord navigation can also retain the dot.
Automatic read-clear parity is not claimed.
See [the beta.4 report](docs/BETA4_RELIABILITY.md) and
[Windows acceptance matrix](docs/WINDOWS_ACCEPTANCE.md#20-2026-10-04-beta4-provider-reliability-acceptance).
No release tag or publication is implied.

## 0.5.0-beta.3

Changes since 0.5.0-beta.2:

### Added

- Multi-service/provider architecture with typed provider definitions and isolated,
  lazily created service WebViews.
- Compact vertical service rail with distinct provider icons and per-service unread
  presentation; previously activated services stay alive while hidden.
- Native service rail context menu with Open, Rename/Service settings, confirmed
  Remove service and ChatPlus notification controls.
- Provider-specific settings and connection state, including server/workspace URL
  controls and Discord's fixed web-app entry.
- Isolated service profiles for separate accounts; one-time legacy migration
  retains preferences and the original ChatPlus profile path.
- Experimental Synology Chat, Slack, Discord and Mattermost support. Desktop
  unread/native notifications remain disabled for these four providers.

### Fixed

- Service removal persists immediately after confirmation, retains account profiles
  and preserves unrelated Settings drafts; Save/removal overlap is serialized.
- Windows service profile IDs reject case collisions and reserved device names
  without renaming valid existing profiles.
- Pre-release updater selection includes newer stable releases using SemVer
  precedence while retaining channel and signature checks.
- Unread/notification lifecycle uses per-service state, focused-service suppression,
  source-service notification click routing and duplicate-event suppression
  independent of conversation cooldown. Unread remains boolean; title fallback
  and navigation-based resets were removed.
- Service transitions are serialized and desktop restore focuses the active view;
  host window actions use the correct window after child WebViews are added.
- Theme/reaction styling covers dark surfaces, hover, selected and keyboard-focus
  states; Settings has a separate Close action, inline Save feedback and restored
  Save-button keyboard focus. Rail and service-form styling were refined.

Synology ChatPlus remains **Primary / Supported**. Synology Chat, Slack, Discord
and Mattermost remain **Experimental**.

This is a prerelease preparation, not final stable 0.5.0. Native Windows/real-server
acceptance, installed migration/login retention, signed updater install/restart and
fresh screenshots remain outstanding as recorded in
[WINDOWS_ACCEPTANCE.md](docs/WINDOWS_ACCEPTANCE.md). Automated regression coverage
does not establish native acceptance.

## 0.5.0-beta.1 — prepared, not published

First public beta target: Windows x64 NSIS only. Linux and macOS are experimental.
Windows binaries are unsigned; SmartScreen warnings are possible. Camera,
microphone and Synology Meet runtime behavior remain unconfirmed.

The signed updater requires the owner's production key and a successful
beta.1-to-beta.2 install/restart test before production operation is claimed.

### Added

- Structured native menus, zoom/fullscreen actions and a separate About window.
- Automatic Git/build/toolchain metadata and safe clipboard diagnostics.
- Central project links and an optional support entry.
- Signed updater infrastructure with channels, progress and explicit installation;
  disabled until production signing and release configuration are supplied.
- Centered auxiliary windows, shared shell themes and main-only window persistence.
- A debug-only development fixture and release-isolation checks.
- Connection status in About and tray, with native WebView2 transport events.
- Initial 0.1.0 development scaffold using Tauri 2, Rust and vanilla TypeScript.
- Local setup/settings window with HTTP(S) server validation and persistent store.
- Remote ChatPlus webview with origin restrictions and external browser handling.
- Light, Dark and System preferences; bundled document-start EOS dark stylesheet.
- Desktop tray, native Settings menu, window geometry persistence and optional
  minimize/close-to-tray behavior.
- Official Tauri autostart integration and persistent system webview profile.
- Unread adapter interface without private Synology APIs.
- Windows NSIS packaging configuration and Windows/Linux/macOS validation CI.
- Project icon used across application windows, tray, installers, settings and README.
- GPLv3 license, contributor guidance and security policy.

### Changed

- Application version is 0.5.0-beta.1. No release tag is implied.

- Compact desktop preferences, a server-only first-run dialog and a concise
  About window with collapsed technical details and separate license viewing.
  Notification and update preferences have dedicated tabs.
- Consistent independent-project and trademark notices; no Synology application
  files are bundled.
- Project licensing is now GNU GPLv3 (GPL-3.0-only), with local
  license access in About and an acceptance page in the Windows installer.
- README clarifies source availability, independent branding and project support.
- Dependency and secret audits now run on pushes to `main` and on pull requests
  targeting `main`, avoiding expensive runs on every `beta/fixes` push while
  preserving pre-merge protection.

### Fixed

- Successful Save keeps setup/settings open so multiple preferences can be
  adjusted without reopening the window.
- Theme changes no longer reopen the main window and now apply live, improving
  Windows menu bar stability.
- Dark theme gives the ChatPlus header wordmark a readable foreground color.
