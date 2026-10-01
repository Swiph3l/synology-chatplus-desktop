# ChatPlus Desktop

<img src="public/chatplus.png" alt="ChatPlus Desktop icon" width="64" />

ChatPlus Desktop is an unofficial Windows desktop client for Synology ChatPlus.
It connects to your Synology NAS ChatPlus installation through Microsoft WebView2,
adding native desktop controls around your server's own web application.
Synology ChatPlus remains the primary use case; a small provider model also supports
multiple configured communication services.

An independent community project maintained by **Swiph3l**, without affiliation
with or endorsement by Synology Inc. No Synology server software or proprietary
application bundles are redistributed.

## Windows features

- Compact native menus, a narrow service sidebar, zoom and fullscreen.
- System tray, minimize/close to tray, saved geometry and start with Windows.
- Light, Dark and System themes, including project-authored ChatPlus dark styling.
- Native Windows notifications with preview privacy, sound and conversation cooldown.
- Boolean unread indicators in the title, tray, taskbar and service sidebar.
- Settings that stay open after Save, with inline confirmation and separate Close.
- A signature-verified updater with explicit installation/restart confirmation.
- About and license windows; version and diagnostics derive from build metadata.

Development remains **0.5.0-beta.2**. Windows x64 is the supported development target.
Real-server and installed Windows validation remain release gates. Linux/macOS are
experimental and have not been validated for the new child-WebView layout.

## Providers

| Provider          | Status                   | Desktop integration                                                                                                 |
| ----------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Synology ChatPlus | Primary/default          | Theme, sidebar unread and WebView2 notification adapters                                                            |
| Synology Chat     | Experimental web session | Configuration, activation, persistent profile and exact-origin navigation; unread/native notifications disabled     |
| Slack             | Experimental web session | HTTPS Slack origins, web authentication, activation and persistent profile; unread/native notifications disabled    |
| Discord           | Experimental web session | Separate account profiles, fixed web-app entry and exact HTTPS Discord origin; unread/native notifications disabled |
| Mattermost        | Experimental web session | Custom HTTP(S) server, separate account profiles and exact configured origin; unread/native notifications disabled  |

Synology Chat has a browser interface, making the shared WebView model feasible;
its DOM is not assumed to match ChatPlus. Slack does not claim parity with Slack
Desktop. Discord also has no desktop-client parity claim. Embedded authentication
and cross-origin SSO remain unvalidated.
See [provider boundaries and limitations](docs/PROVIDERS.md).

## Setup and services

Enter your ChatPlus URL, such as `https://example.com/chat/`, and choose **Connect**.
Sign in through the provider's own interface. The shell does not collect passwords;
WebView2 manages cookies and sessions.

Open Settings from the menu, tray or sidebar. **Save** persists preferences, keeps
Settings open and confirms inline. **Close** is separate and discards unsaved edits.
Theme changes apply live. Changing a service URL/provider recreates its view;
finish drafts and calls first.

Settings > Services adds, renames, enables or removes configured services. Select
one from the narrow sidebar; there are no browser tabs or address bar. Sessions
are created on first activation, then remain in memory while another service is
shown. Additional services use separate profile directories. Removing a service
closes its view but retains its disk profile.

Multiple instances of the same provider have separate stable service IDs and
profiles. Use custom names such as Personal Discord and GameDev Discord; tooltips
identify each instance. Discord needs a display name rather than a custom server
URL. Authentication stays in Discord's own web interface and may require manual
MFA or CAPTCHA; the application never supplies credentials or reads private APIs.

Mattermost requires a custom server URL and supports separate instances such as
Mattermost — Company and Mattermost — Private. It reuses the persistent per-service
profiles and desktop menu. Native unread/notifications are disabled; authenticated
login, SSO and account retention remain pending live validation.

Existing single-server settings migrate automatically to a deterministic ChatPlus
service, retaining preferences and the original default WebView profile path.
Migration does not intentionally require a new login. Cookie retention across an
installed upgrade still requires Windows verification.

## Notifications and unread

Supported WebView2 runtimes intercept browser notifications, validate the configured
origin and suppress duplicate browser display before native delivery. The active
focused service is suppressed; other running services can notify while unfocused,
minimized or hidden. Clicking a toast activates its source service. There is no
background push after the application exits.

Preview modes are Full, Sender/chat and Generic. Save feedback never sends a Windows
notification. **Send test notification** is separate. Windows permission and Do Not
Disturb can suppress banners. Notification content and service URLs are not logged.

ChatPlus sidebar markers publish boolean unread state. Missing sidebar UI and
reconnects retain the last observation; focus alone cannot clear it. Flashing titles,
message text and rendered rows are not unread sources. Exact message counts and
totals across hidden/muted conversations are unavailable.
See [notification testing](docs/NOTIFICATIONS.md).

## Updates

**Stable** receives production releases only. **Pre-release** accepts beta/RC builds
and newer stable releases, selecting the highest eligible SemVer. The saved channel
is never changed automatically. Optional automatic checks run after startup, then
at most every six hours. The official Tauri updater verifies signatures before
installation, which requires confirmation.

Updater signatures are distinct from Windows Authenticode. Local installers may be
unsigned. See [signed updates](docs/UPDATER_SIGNING.md), [Windows beta validation](docs/WINDOWS_BETA.md)
and the [release checklist](docs/RELEASE_CHECKLIST.md).

## Build and test

Use Node.js, Rust, Windows C++ build tools and WebView2:

```sh
npm ci
npm run format:check
npm run typecheck
npm test
npm run build
npm run check:release
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo test --release --locked --manifest-path src-tauri/Cargo.toml
```

Use `npm.cmd` when PowerShell script execution is restricted. `npm run tauri dev`
starts development. Ordinary `npm run tauri build` produces local packages without
release signing credentials; release packaging is a separately authorized process.

Tests cover settings interactions, migration, provider validation, unread observations,
notification policy and signed HTTPS updater fixtures. They do not replace installed
Windows testing. See [development validation](docs/DEVELOPMENT_STATUS.md).

## Screenshots

The [existing images](docs/screenshots/README.md) are historical visual references,
not screenshots of this revision. The historical About image has an outdated version.
Capture fresh images from the actual build before release, including the service rail.

## Security, contributing and license

Remote provider views have no native Tauri IPC permissions. Local commands validate
their invoking view and origin. Navigation is restricted to provider origins; external
HTTP(S) links use the default browser when enabled. This is not a subresource firewall.
TLS and updater signature verification remain enabled.

See [SECURITY.md](SECURITY.md), [dependency policy](docs/DEPENDENCY_POLICY.md),
[CONTRIBUTING.md](CONTRIBUTING.md) and [licensing notes](docs/LICENSING.md).
[Report bugs on GitHub](https://github.com/Swiph3l/synology-chatplus-desktop/issues).
Diagnostics omit private URLs, credentials, cookies and chat content.

GNU GPLv3 (GPL-3.0-only); see [LICENSE](LICENSE) and [NOTICE](NOTICE). Dependencies
retain their own licenses. Synology, ChatPlus, DSM and Slack names identify
compatibility and remain trademarks of their respective owners.
