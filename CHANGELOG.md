# Changelog

All notable changes will be documented here. Versions follow Semantic Versioning.

## Unreleased — development remains 0.5.0-beta.2

- Typed providers, isolated service WebViews and a compact vertical service rail.
- One-time legacy server migration retaining preferences and the original profile path.
- Experimental Synology Chat and Slack sessions; native unread/notifications disabled.
- Per-service unread state and notification click routing; focused-service suppression.
- Removed unread title fallback and navigation resets; state remains boolean.
- Duplicate-event suppression independent of conversation cooldown.
- Separate Settings Close action and tests for inline Save feedback and failures.
- Dark reaction surfaces, hover, selected and keyboard-focus styling.
- Pre-release updates include newer stable releases using real SemVer precedence.
- Serialized service transitions and active-view focus on desktop restore.
- Migration, provider and lifecycle regression tests; updated development documentation.

Native Windows/real-server validation and replacement screenshots remain required.
No final version bump, tag, push or release is included in this development pass.

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
