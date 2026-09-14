# Changelog

All notable changes will be documented here. Versions follow Semantic Versioning.

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

### Fixed

- Successful Save and open ChatPlus closes setup/settings after opening the
  main window; failed saves keep the form available with an error.
- Dark theme gives the ChatPlus header wordmark a readable foreground color.

No public release has been published.
