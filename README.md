# ChatPlus Desktop

<img src="public/chatplus.png" alt="ChatPlus Desktop Windows app icon" width="64" />

ChatPlus Desktop is an unofficial open-source Windows desktop client for Synology
ChatPlus and Synology Chat, with multi-service messaging support. It brings your
self-hosted chat on a Synology NAS and services such as Discord into one lightweight
Tauri application.

[![Latest release](https://img.shields.io/github/v/release/Swiph3l/synology-chatplus-desktop?include_prereleases)](https://github.com/Swiph3l/synology-chatplus-desktop/releases)
[![Windows x64](https://img.shields.io/badge/Windows-x64-0078D4)](https://github.com/Swiph3l/synology-chatplus-desktop/releases)
[![GPLv3](https://img.shields.io/badge/license-GPLv3-blue)](LICENSE)
[![CI](https://github.com/Swiph3l/synology-chatplus-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/Swiph3l/synology-chatplus-desktop/actions/workflows/ci.yml)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB)](https://v2.tauri.app/)

## Why ChatPlus Desktop?

- Keep Synology ChatPlus or Synology Chat close at hand with a convenient Windows app.
- Switch between multiple communication services and separate account profiles.
- See unread indicators and native notifications while working in other applications.
- Keep the app in the system tray and choose your theme, language and update channel.

## Supported services

| Service           | Status                                                                           |
| ----------------- | -------------------------------------------------------------------------------- |
| Synology ChatPlus | Supported / primary; dedicated theme, unread and notification integration        |
| Synology Chat     | Supported unread/notification integration; broader web-client acceptance pending |
| Discord           | Supported unread/notification integration; broader web-client acceptance pending |
| Mattermost        | Experimental web sessions; desktop unread/notifications disabled                 |
| Slack             | Experimental web sessions; desktop unread/notifications disabled                 |

Synology Chat and Discord still carry Experimental badges in the general service UI.
Their notification integration is supported functionality in this reliability pass;
authenticated Windows acceptance remains pending. Provider login/SSO, calls and other
features depend on each web app and its policies. [Provider details](docs/PROVIDERS.md)
explain the current boundaries; no Slack/Discord desktop-client parity is claimed.

## Features

- Multiple chat services in one app, with persistent per-service sessions.
- Native Windows notifications with Full, Sender/chat or Generic previews and sound.
- Per-service unread dots and shared tray, title and taskbar unread presentation.
- Service-specific desktop notification mute and tray restore/hide controls.
- Automatic update checks (optional), signed updates and Stable/Pre-release channels.
- PDF and ordinary attachment downloads through the provider's WebView2 session,
  with native save/download controls and safe duplicate filenames.
- Light, Dark and System themes; English, Polish and Spanish interface.
- Native menus, zoom/fullscreen, saved window geometry and optional start with Windows.

Current development is `0.5.0-beta.4`, focused on reliability. Native notifications,
authenticated attachments and installed updater behavior still need the
[Windows acceptance checks](docs/WINDOWS_ACCEPTANCE.md#current-reliability-pass-2026-10-07)
for this revision. Windows x64 is the supported target; Linux/macOS are experimental.

## Download

**[Download Windows builds from GitHub Releases](https://github.com/Swiph3l/synology-chatplus-desktop/releases).**

Choose a published Windows x64 setup installer. Stable releases are intended for
regular use; Pre-release builds include beta/RC changes for testing. The saved update
channel stays under your control, and installation/restart requires confirmation.
Development work described here may be newer than the latest published release.

Updater signatures verify updates separately from Windows Authenticode. Unsigned
Windows builds may display a SmartScreen prompt. See [update details](docs/UPDATER.md).

## Screenshots

![ChatPlus Desktop service sidebar with separate ChatPlus and Discord profiles](docs/screenshots/service-rail.png)

This Windows development capture shows the service rail from 2026-10-01 and excludes
private provider content. It is an earlier visual reference, not acceptance evidence
for this revision. [Screenshot provenance and more images](docs/screenshots/README.md).

## Installation

1. Download the Windows x64 setup from [Releases](https://github.com/Swiph3l/synology-chatplus-desktop/releases).
2. Run the installer; Microsoft WebView2 is required and can be installed by setup.
3. Enter your Synology ChatPlus/Synology Chat server URL, for example
   `https://example.com/chat/`, and sign in through the provider's own interface.
4. Use **Settings > Services** to add other services or separate accounts. Enable global
   Desktop notifications and the desired service preference, then Save.

Provider notification preferences and Windows permissions also apply. Settings Save
keeps the window open with inline confirmation; Close is separate. Sessions are
managed locally by WebView2. Finish drafts/calls before changing a service URL/provider.

## Privacy

ChatPlus Desktop adds no advertising and does not monetize conversation content.
Providers load from their own services; the shell does not collect sign-in passwords.
WebView2 handles local cookies/session profiles, with separate profiles for added
services. Removing a service retains its disk profile.

Optional update checks contact GitHub for release metadata/packages. Notification
previews use the provider's supplied content according to your preference. Diagnostics
omit message content, credentials, cookies/tokens and private URLs. Your provider's
own privacy policy still applies. See [security reporting](SECURITY.md).

## Contributing

Start with [developer documentation](docs/DEVELOPMENT.md) and
[CONTRIBUTING.md](CONTRIBUTING.md). Contributions to bug fixes, provider integration,
translations, accessibility, documentation and Windows testing are welcome.

See also [architecture](docs/ARCHITECTURE.md), [notifications](docs/NOTIFICATIONS.md),
[provider integration](docs/PROVIDERS.md) and [testing](docs/TESTING.md).

## Reporting bugs

[Open a GitHub issue](https://github.com/Swiph3l/synology-chatplus-desktop/issues/new/choose)
with app/Windows/WebView2 versions, provider version and safe reproduction steps.
For unread issues, describe foreground/background/minimized state, selected service,
restore versus actual conversation input/reply, and sidebar/tray/toast results.
About > **Copy diagnostics** supplies bounded privacy-safe transition information.
Do not include private messages, credentials/tokens, server/attachment URLs or profiles.

## License

GNU GPLv3 (GPL-3.0-only). See [LICENSE](LICENSE), [NOTICE](NOTICE) and
[licensing notes](docs/LICENSING.md). Dependencies retain their own licenses.

## Disclaimer

ChatPlus Desktop is an independent community project maintained by **Swiph3l**. It
is not affiliated with or endorsed by Synology or other supported providers. Product
names and trademarks identify compatibility and belong to their respective owners.
No proprietary Synology server application bundles are redistributed.
