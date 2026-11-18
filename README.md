# Chat+ Desktop

<img src="src-tauri/icons/64x64.png" alt="Chat+ Desktop app icon" width="64" />

Independent client for Synology Chat and ChatPlus.

Chat+ Desktop brings self-hosted chat on your Synology NAS and services such as
Discord into one open-source Tauri application.

[![Latest stable release](https://img.shields.io/github/v/release/Swiph3l/synology-chatplus-desktop)](https://github.com/Swiph3l/synology-chatplus-desktop/releases/latest)
[![Windows x64](https://img.shields.io/badge/Windows-x64-0078D4)](https://github.com/Swiph3l/synology-chatplus-desktop/releases)
[![GPLv3](https://img.shields.io/badge/license-GPLv3-blue)](LICENSE)
[![CI](https://github.com/Swiph3l/synology-chatplus-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/Swiph3l/synology-chatplus-desktop/actions/workflows/ci.yml)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB)](https://v2.tauri.app/)

**Current stable version: [v1.0.3](https://github.com/Swiph3l/synology-chatplus-desktop/releases/tag/v1.0.3).**

## Why Chat+ Desktop?

- Keep Synology ChatPlus or Synology Chat close at hand with a convenient desktop app.
- Switch between multiple communication services and separate account profiles.
- See unread indicators and native notifications while working in other applications.
- Keep the app in the system tray and choose your theme, language and update preferences.

## Supported services

| Service           | Status                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Synology ChatPlus | Supported / primary; dedicated theme, unread and notification integration                                                   |
| Synology Chat     | Supported, with dedicated unread and notification integration                                                               |
| Discord           | Dedicated unread/notification integration; Experimental service UI                                                          |
| WhatsApp          | Experimental Web integration; positive unread evidence/native notifications; no read actions or unread totals               |
| Messenger         | Experimental Facebook messages integration; browser-event unread/native notifications; no read actions or DOM unread totals |
| Mattermost        | Experimental browser notifications; unread from incoming notification events, explicit local acknowledgement only           |
| Slack             | Experimental web sessions; desktop unread/notifications disabled                                                            |

Discord has a dedicated notification adapter and remains experimental. Provider login/SSO, calls
and other features depend on each web app and its policies.
[Provider details](docs/PROVIDERS.md) explain capability boundaries; no Slack/Discord
desktop-client parity is claimed.

WhatsApp Web integration is experimental. It uses the official Web login and an
isolated profile for each account. Unread totals and mark-read actions remain
unavailable. Chat+ is independent of WhatsApp
and Meta; [WhatsApp integration](docs/PROVIDERS.md#whatsapp) describes the current
capabilities and limitations.

An optional **Retro (Windows 95/98)** theme adds classic desktop controls to the
shell and Synology ChatPlus. Its original chime can be previewed in Appearance
settings and accompanies Windows link confirmations when sounds are enabled.

Messenger uses the official Facebook messages page and its Facebook login flow.
Read actions and DOM unread totals are unavailable.
See [Messenger integration](docs/PROVIDERS.md#messenger); this is an independent
client with no Meta affiliation.

## Features

- Multiple chat services in one app, with persistent per-service sessions.
- Native notifications with Full, Sender/chat or Generic previews and sound.
- Per-service unread dots and shared tray/title unread presentation, plus Windows
  taskbar indicators.
- Service-specific desktop notification mute and tray restore/hide controls.
- Automatic update checks (optional), signed updates and an **Include beta updates** preference.
- On Windows, PDF and ordinary attachment downloads through the provider's WebView2 session,
  with an explicit Save As dialog, visible destination and safe duplicate filenames.
- External web links show their destination in a confirmation before opening the
  default browser.
- Light, Dark and System themes; English, Polish, Spanish, German, French,
  Japanese, Traditional Chinese, Brazilian Portuguese and Italian interface.
- Native menus, zoom/fullscreen, saved window geometry and optional start at login.

Windows x64 remains the established target. Native build and release preparation
covers macOS 14+ on Apple Silicon
and Intel, and Linux x64 with an Ubuntu 24.04 baseline. These new platforms require
native acceptance before their support is promoted. Linux uses a verified source
backport of the upstream glib iterator fix; its native debug/optimized regression
and every target's security gate must pass before distribution. See
[platform status and limitations](docs/PLATFORMS.md).

## Download

Choose a **v1.0.3** package for your system:

| System                        | Architecture          | Download                                                                                                                                                                                                                                                                            |
| ----------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows                       | x64                   | [Setup (.exe)](https://github.com/Swiph3l/synology-chatplus-desktop/releases/download/v1.0.3/windows-x86_64--ChatPlus-Desktop_1.0.3_x64-setup.exe)                                                                                                                                  |
| macOS 14+                     | Apple Silicon (arm64) | [Disk image (.dmg)](https://github.com/Swiph3l/synology-chatplus-desktop/releases/download/v1.0.3/darwin-aarch64--ChatPlus-Desktop_1.0.3_aarch64.dmg)                                                                                                                               |
| macOS 14+                     | Intel (x64)           | [Disk image (.dmg)](https://github.com/Swiph3l/synology-chatplus-desktop/releases/download/v1.0.3/darwin-x86_64--ChatPlus-Desktop_1.0.3_x64.dmg)                                                                                                                                    |
| Linux (Ubuntu 24.04 baseline) | x64                   | [AppImage](https://github.com/Swiph3l/synology-chatplus-desktop/releases/download/v1.0.3/linux-x86_64--ChatPlus-Desktop_1.0.3_amd64.AppImage) · [DEB](https://github.com/Swiph3l/synology-chatplus-desktop/releases/download/v1.0.3/linux-x86_64--ChatPlus-Desktop_1.0.3_amd64.deb) |

Windows x64 is the established target. macOS and Linux remain candidate platforms;
read the [platform requirements and limitations](docs/PLATFORMS.md) before installing.

Already installed? Open **Settings > Updates** to check for an update.
See the [v1.0.3 release notes](https://github.com/Swiph3l/synology-chatplus-desktop/releases/tag/v1.0.3),
[latest stable release](https://github.com/Swiph3l/synology-chatplus-desktop/releases/latest)
or [all releases](https://github.com/Swiph3l/synology-chatplus-desktop/releases).

Stable releases are intended for regular use; beta and pre-release builds include changes for testing. Enable
**Include beta updates** in Settings to consider both stable and beta releases;
leave it off for stable releases only. Installation/restart requires confirmation.
Development work described here may be newer than the latest published release.

Updater signatures verify updates separately from Windows Authenticode. Unsigned
Windows builds may display a SmartScreen prompt. See [update details](docs/UPDATER.md).

## Installation

1. Download the package for your system from the table above.
   See [platform installation](docs/PLATFORMS.md) for runtime requirements.
2. On Windows, run the setup; it can install the required Microsoft WebView2 runtime.
   On macOS, open the DMG and drag the app into Applications.
   On Linux, install the DEB or make the AppImage executable and launch it.
3. Enter your Synology ChatPlus/Synology Chat server URL, for example
   `https://nas.example.com`, and sign in through the provider's own interface.
   A bare NAS address uses Synology's Chat launcher. Existing `/chat/`, `/chatplus/`
   or custom reverse-proxy paths are preserved; a dedicated chat hostname can use `/`.
4. Use **Settings > Services** to add other services or separate accounts. Enable global
   Desktop notifications and the desired service preference, then Save.

Provider notification preferences and operating-system permissions also apply. Settings Save
keeps the window open with inline confirmation; Close is separate. Sessions are
managed locally by the platform WebView. Finish drafts/calls before changing a service URL/provider.

## Privacy

Chat+ Desktop adds no advertising and does not monetize conversation content.
Providers load from their own services; the shell does not collect sign-in passwords.
The platform WebView handles local cookies/session profiles, with separate stores
for added services. macOS isolation requires macOS 14 or later. Removing a service
retains its local session store.

Optional update checks contact GitHub for release metadata/packages. Notification
previews use the provider's supplied content according to your preference. Diagnostics
omit message content, credentials, cookies/tokens and private URLs. Your provider's
own privacy policy still applies. See [security reporting](SECURITY.md).

## Contributing

Start with [developer documentation](docs/README.md) and
[CONTRIBUTING.md](CONTRIBUTING.md). Contributions to bug fixes, provider integration,
translations, accessibility, documentation and native platform testing are welcome.

See [Contributors on GitHub](https://github.com/Swiph3l/synology-chatplus-desktop/graphs/contributors)
for project activity, and [community forks](https://github.com/Swiph3l/synology-chatplus-desktop/forks)
to explore related work.

See also [architecture](docs/ARCHITECTURE.md), [notifications](docs/NOTIFICATIONS.md),
[provider integration](docs/PROVIDERS.md) and [testing](docs/TESTING.md).

## Reporting bugs

[Open a GitHub issue](https://github.com/Swiph3l/synology-chatplus-desktop/issues/new/choose)
with app, operating-system and WebView versions, provider version and safe reproduction steps.
For unread issues, describe foreground/background/minimized state, selected service,
restore versus actual conversation input/reply, and sidebar/tray/toast results.
About > **Copy diagnostics** supplies bounded privacy-safe transition information.
Do not include private messages, credentials/tokens, server/attachment URLs or profiles.

## License

GNU GPLv3 (GPL-3.0-only). See [LICENSE](LICENSE), [NOTICE](NOTICE) and
[licensing notes](docs/LICENSING.md). See the [branding sources and icon exports](assets/branding/README.md). Dependencies retain their own licenses.

## Disclaimer

Chat+ Desktop is an independent community project maintained by **Swiph3l**. It
is not affiliated with or endorsed by Synology or other supported providers. Product
names and trademarks identify compatibility and belong to their respective owners.
No proprietary Synology server application bundles are redistributed.
