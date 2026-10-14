# Changelog

All notable changes will be documented here. Versions follow Semantic Versioning.

## 0.5.0-beta.6 - development candidate

### Added

- Provider-neutral first-run setup using the shared Services editor, with an
  explicit provider choice, multiple-service setup and Skip for now. Existing
  profiles keep their workspace, and skipped setup opens an empty workspace.
- Compact Services Manager cards and separate add, edit and confirmed removal
  dialogs, with independent drafts for duplicate provider instances.
- Service ordering with drag handles, move controls and keyboard navigation;
  sidebar icons also support holding for two seconds and dragging up or down.
- Per-service notification colors, including RGB/HEX controls and random color
  selection, retained with each service's stable identity.
- A compact status-bar update button showing the updater's resolved target after
  a successful check, with a tooltip and keyboard access to Settings -> Updates.
- Complete German, French, Japanese and Traditional Chinese interfaces alongside
  English, Polish and Spanish, including Settings and native menus.

### Changed

- Replace the update-channel selector with **Include beta updates**, off by default.
  Existing Stable preferences migrate to off; Beta/Pre-release preferences migrate
  to on without resetting services or settings.
- All update checks select from published GitHub Releases using SemVer precedence.
  Beta opt-in considers stable and prerelease versions together; drafts and
  unpublished releases are excluded, and older versions are never offered.
- Refine Settings service controls, update metadata, release-note layout, draft
  feedback and keyboard focus.
- Compact the Settings tabs, controls and fixed footer, align Theme and Language,
  and group startup and window preferences with less vertical space.
- Update the native Windows notification backend to
  `tauri-winrt-notification 0.8.1` and the Settings store to
  `tauri-plugin-store 2.4.5`, retaining the existing direct Windows and WebView2
  bindings. Native acceptance remains pending.

### Fixed

- Keep services saved during first-run setup and reconcile a successful native
  save even when a later window operation reports an error.
- Preserve applied Settings drafts until Save, including removal, ordering, colors
  and explicit per-service notification edits during external settings changes.
- Persist settings through atomic replacement and retain the original profile if
  migration cannot be saved.
- Keep update manifests, Windows installer assets, signatures and installation
  confirmation bound to the selected release and saved beta preference.
- Invalidate cached updates and verified downloads when the beta preference changes;
  delayed events cannot restore a disallowed beta status-bar button.
- Treat repositories without a newer eligible stable release as a successful
  no-update check instead of a missing stable-feed error.
- Serialize Windows startup and queue repeated-launch activation outside WebView
  focus callbacks, retaining requests received before setup completes.

### Security

- Update `rustls` to `0.23.46` for `RUSTSEC-2026-0346`, `RUSTSEC-2026-0347`,
  `RUSTSEC-2026-0348` and `RUSTSEC-2026-0349`, without advisory suppression.
- Update the pinned CodeQL action to v4.38.3.
- Pin release jobs to the triggering commit, validate tag/source identity and
  artifact provenance, and require collected updater signatures to verify against
  the configured public key before upload.

This is an unpublished prerelease candidate, **not release-ready**. Windows
notification acceptance and the final production-build smoke test are incomplete.
GLib 0.18.5 remains under the reviewed Linux-only audit classification, and a signed
beta.6 installation/restart has not been validated. Beta.6 must be published as a
prerelease with valid signed assets before eligible users can receive it. The final
readiness decision and remaining native acceptance gates are recorded in
[Development status](docs/DEVELOPMENT_STATUS.md).

## 0.5.0-beta.4 - development candidate

### Fixed

- Unread stays visible when a selected conversation receives messages while ChatPlus
  is minimized or backgrounded. Restoring/selecting alone does not mark messages read.
- Genuine engagement in the correct latest conversation or main composer clears stale
  unread when the provider supplies reliable read evidence, including Synology services
  without exact notification tags. Other unread conversations/services remain.
- Sidebar, tray and taskbar/title indicators update from the same service state;
  delayed updates cannot restore an old unread dot.
- Distinct consecutive messages remain eligible for Windows notifications even with
  identical previews; repeated processing of one event still produces only one toast.
- Update notes use available space in larger windows. Thanks to Azathoth for reporting
  the update-dialog scrolling issue.

### Added

- Windows attachment download handling through the authenticated provider session,
  including safe names, duplicate filenames and native save/cancel/failure controls.
- Privacy-safe notification transition history in Copy diagnostics for bug reports.

### Changed

- Synology Chat and Discord unread/native notifications have dedicated supported
  integration alongside Synology ChatPlus, with independent provider read/composer rules.
- Compatible dependency/security patches and clearer developer/contributor documentation.

Authenticated provider notifications, native attachment UI, installed session retention,
signed update/restart and actual Windows DPI checks remain pending for this candidate.
See [Windows acceptance](docs/WINDOWS_ACCEPTANCE.md#current-reliability-pass-2026-10-07).
Historical engineering evidence remains in [the beta.4 report](docs/BETA4_RELIABILITY.md).
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
