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

The current prerelease target is **0.5.0-beta.4**, focused on unread and notification
reliability. Windows x64 is the supported development target.
Real-server and installed Windows validation remain release gates. Linux/macOS are
experimental and have not been validated for the new child-WebView layout.

## Providers

| Provider          | Status              | Desktop integration                                                                                                |
| ----------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Synology ChatPlus | Primary / Supported | Theme, sidebar unread and WebView2 notification adapters                                                           |
| Synology Chat     | Experimental        | Separate Synology Chat unread adapter, WebView2 notifications and persistent profile                               |
| Slack             | Experimental        | HTTPS Slack origins, web authentication, activation and persistent profile; unread/native notifications disabled   |
| Discord           | Experimental        | Dedicated Discord unread/focus adapter, WebView2 notifications and separate account profiles                       |
| Mattermost        | Experimental        | Custom HTTP(S) server, separate account profiles and exact configured origin; unread/native notifications disabled |

ChatPlus, Synology Chat and Discord have independently implemented unread adapters;
authenticated Windows notification/read acceptance remains pending for all three.
Slack and Mattermost desktop unread/notifications remain disabled. Slack and Discord
have no desktop-client parity claim. Embedded authentication and cross-origin SSO
remain unvalidated.
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
one from the narrow service rail; there are no browser tabs or address bar. Sessions
are created on first activation, then remain in memory while another service is
shown. Additional services use separate profile directories. The rail's context menu
offers Open, Rename/Service settings and confirmed Remove service. ChatPlus, Synology
Chat and Discord also offer desktop notification mute/unmute. Removal is persisted immediately, closes the
view and retains its disk profile without saving unrelated Settings edits.

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

Supported Windows WebView2 runtimes intercept browser notifications for ChatPlus,
Synology Chat and Discord, validate the source origin and suppress duplicate browser
display before native delivery. Enable global Desktop notifications and the desired
service's Desktop notifications preference. Previously saved disabled service
preferences stay disabled after upgrade; explicitly enable those services as needed.
The provider's own notification settings and Windows permissions also apply.

Selecting a service or logically focusing its WebView cannot suppress a toast or
clear unread while ChatPlus is backgrounded/minimized. Suppression requires actual
native foreground visibility plus reliable evidence that the originating conversation
is being viewed at latest; unknown conversation identity permits delivery. Clicking
a toast restores, unminimizes and focuses the existing main window before selecting
the originating service. The host does not derive conversation navigation from an
unverified notification tag or create another application process/window. There is
no background push after the application exits.

Preview modes are Full, Sender/chat and Generic. Save feedback never sends a Windows
notification. **Send test notification** is separate. Windows permission and Do Not
Disturb can suppress banners. Notification content and service URLs are not logged.

Each supported provider owns independent boolean unread state. Dedicated adapters
observe provider-specific sidebar/aggregate markers. Missing, incomplete or ambiguous
UI retains the cached state; focus, service switching and notification activation
alone cannot clear it. Clearing requires provider empty/read evidence and a real
conversation interaction in the current native foreground generation. Flashing
titles and message text are not unread sources; exact counts are unavailable.
Native arrivals also revoke earlier gestures. An empty pane cannot acknowledge an
unverified native arrival; exact originating-message view proof is required to
release that read barrier. ChatPlus and Synology Chat lack audited event-tag mapping,
so their native-arrival dot can remain after reading until restart reobserves provider
state. This candidate limitation has not passed live read-clear acceptance.
Exact individual reads can progress while the provider aggregate remains unread or
unknown. Only native-confirmed proofs retire event tags; the service dot still needs
known provider zero and no remaining unproven native arrival before clearing.
Discord cannot assert global
zero from an empty mention-only DM group: missing/incomplete private-sidebar metadata,
muted/selected/hovered DMs and message-request/spam scope remain unknown. These
limitations need controlled Windows acceptance; the desktop does not guess unread
state through private provider APIs.
Automated regressions cover these rules, while authenticated foreground, background,
minimized, toast and toast-click checks remain pending Windows acceptance.
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
