# Platform support

The `1.0.0` candidate prepares native builds for Windows, macOS and Linux.
Windows x64 remains the established target. macOS and Linux support is candidate
work pending native acceptance; successful compilation and fixture tests do not
establish authenticated-provider or desktop behavior.

## Targets and installation

| Target              | Baseline                             | Web engine    | Prepared packages                                | Status                                                               |
| ------------------- | ------------------------------------ | ------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| Windows x64         | Windows with Microsoft Edge WebView2 | WebView2      | NSIS setup `.exe`                                | Established target; run the Windows acceptance checklist for changes |
| macOS Apple Silicon | macOS 14 or later, arm64             | WKWebView     | `.dmg`, `.app`; `.app.tar.gz` for signed updates | Candidate; native acceptance pending                                 |
| macOS Intel         | macOS 14 or later, x86_64            | WKWebView     | `.dmg`, `.app`; `.app.tar.gz` for signed updates | Candidate; native acceptance pending                                 |
| Linux x64           | Ubuntu 24.04 build/runtime baseline  | WebKitGTK 4.1 | `.AppImage`, `.deb`                              | Candidate; distribution blocked by upstream glib advisory            |

Use only packages actually published in [GitHub Releases](https://github.com/Swiph3l/synology-chatplus-desktop/releases).
The prepared target list is not a list of available downloads. macOS packages are
separate builds for Apple Silicon and Intel. macOS 14 is required for persistent
per-service WebKit data stores. Other Linux distributions, older Ubuntu releases,
Linux ARM and Windows ARM are outside the current candidate matrix.

Windows setup can install WebView2. A published macOS disk image installs by
dragging the app into Applications; updater signatures do not provide Apple
Developer ID signing or notarization. On Linux, WebKitGTK 4.1 and desktop runtime
libraries must be installed. AppImage execution also needs compatible FUSE support;
the Ubuntu 24.04 packaging environment uses `libfuse2t64`. Linux tray presentation
depends on the desktop's AppIndicator support and notifications need a notification
service. Candidate packages must pass the checks below before distribution.

## Capability boundaries

Provider status in [PROVIDERS.md](PROVIDERS.md) applies on every operating system.
The following table describes implemented platform paths; macOS and Linux entries
still require native verification.

| Capability                                                                      | Windows                        | macOS 14+                                     | Linux x64                                 |
| ------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------- | ----------------------------------------- |
| Provider sessions and separate accounts                                         | WebView2 profiles              | Per-service WKWebView stores                  | Per-service WebKitGTK data directories    |
| Provider unread observations                                                    | Native WebView2 message bridge | Bounded native polling of provider outbox     | Bounded native polling of provider outbox |
| Transport connection status                                                     | Native navigation completion   | Unknown after page load                       | Unknown after page load                   |
| Native notification delivery and preview settings                               | Windows toast integration      | Native notification plugin; candidate         | Native notification plugin; candidate     |
| Notification activation routed to originating service and individual withdrawal | Implemented                    | Unavailable                                   | Unavailable                               |
| Unread rail and window title                                                    | Implemented                    | Candidate                                     | Candidate                                 |
| System tray                                                                     | Implemented                    | Candidate                                     | Candidate; desktop support required       |
| Windows taskbar unread presentation                                             | Implemented                    | Unavailable                                   | Unavailable                               |
| Managed attachment downloads with native Save As and download status            | Implemented through WebView2   | Unavailable                                   | Unavailable                               |
| External-link confirmation                                                      | Implemented                    | Candidate                                     | Candidate                                 |
| Native menus, window restore and start at login                                 | Implemented                    | Candidate; Edit menu and Dock reopen handling | Candidate; desktop session dependent      |
| Signed update installation                                                      | Windows installer              | Application archive; candidate                | AppImage; candidate and release-blocked   |

Use the provider's web app in a browser for attachments when managed downloads are
unavailable. Provider login popups, authentication redirects, calls and browser
notification behavior depend on the platform engine and need acceptance for each
provider. The Linux `.deb` is an installation package; the prepared in-app update
artifact is the AppImage. A Linux installation launched outside AppImage disables
inline update installation and directs the user to GitHub Releases for a manual
package update.

On macOS, the engine's navigation callback can also report subframe loads. The
current strict provider-origin policy may block cross-origin embedded content;
the candidate does not include a custom WKNavigationDelegate exception for those
frames. Test embedded login and content flows explicitly before accepting a provider.

Added accounts use separate local stores. The legacy primary `chatplus` instance
keeps its original default store. Renaming an account keeps its store identity;
removing a service retains its local data. Use an isolated application identifier
and fresh stores for testing, as described in [DEVELOPMENT.md](DEVELOPMENT.md).

## Synology server addresses

Synology services accept a bare NAS address such as `https://nas.example.com` or
`https://nas.example.com:5001`. The initial load adds DSM's appropriate Chat or
ChatPlus launcher query while retaining the configured origin and saved address.
No Login Portal `/chat/` or `/chatplus/` alias is required when the package is
available through DSM's launcher.

Explicit paths are preserved. Configured URLs still use HTTP(S) without credentials,
query parameters or fragments. Existing aliases,
custom reverse-proxy paths and dedicated chat hostnames can therefore keep their
current addresses. The server still needs to expose the selected package, and
authentication remains in Synology's own interface.

## Native builds and CI

Install the shared Rust/Node requirements and the host dependencies in
[DEVELOPMENT.md](DEVELOPMENT.md), then build on the target operating system:

```sh
npm ci
npm run tauri -- build
```

Tauri merges `tauri.macos.conf.json` or `tauri.linux.conf.json` for the corresponding
host. Windows packaging defaults to NSIS in the main configuration; macOS selects app/DMG and Linux selects
AppImage/deb. Normal local builds do not produce updater signatures. Release
signing follows [UPDATER.md](UPDATER.md) and the
[release checklist](RELEASE_CHECKLIST.md).

Native CI runs `validate (windows-latest, dev)`,
`validate (ubuntu-24.04, dev)`, `validate (macos-15, dev)` and
`validate (macos-15-intel, dev)`. A separate frontend job exercises Node 24.
Linux headless Rust tests run under Xvfb. These jobs cover builds and automated
tests; they do not substitute for the checklist below.

## Linux security gate

The locked GTK3 dependency chain includes `glib 0.18.5`, affected by
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html).
The upstream fix requires glib 0.20 or later; the candidate's Tauri/GTK3 graph
requires the 0.18 line. Adding a second newer glib package does not repair that
chain. See [dependency policy](DEPENDENCY_POLICY.md#linux-advisory-boundary).

The strict Linux target audit blocks distribution. Its Windows-only reporting
exception is not Linux release approval. The signed draft release requires all
four target manifests and their security gates; a failed Linux gate blocks the
aggregate draft instead of silently dropping Linux. Do not add an advisory ignore
to make a candidate pass.

## Native acceptance checklist

Promotion of `1.0.0` to a stable release requires recorded native acceptance for
every advertised platform and architecture, authenticated provider/account
isolation checks, and a verified installed update on each target. Compilation,
synthetic fixtures and an incremented version do not satisfy these requirements.
Any unresolved platform capability limits must remain visible in release notes.

Run this checklist separately on Windows x64, macOS arm64, macOS Intel and the
Linux baseline. Record app/build identity, OS/architecture, engine version,
desktop session where applicable, provider version and actual results in the PR
or release review. Keep private logs, profiles and screenshots outside the checkout.
An unavailable feature in the capability table is a recorded limitation, not a
passing test. Windows changes also need [WINDOWS_ACCEPTANCE.md](WINDOWS_ACCEPTANCE.md).

1. Install a fresh package and upgrade an existing isolated test installation.
   Confirm the application identity, version, menus and readable scaling.
2. Configure both a bare NAS address and an explicit chat alias. Check DSM login,
   logout, redirects and an additional provider's popup/SSO flow.
3. Add two accounts of the same provider. Sign in separately, restart, switch and
   rename them. Verify that cookies and sessions remain isolated and persistent.
4. Exercise selected-first startup and background service loading. Confirm no
   focus theft, selection changes or unread acknowledgement during preload.
5. Receive messages in active, background, minimized and hidden states. Verify
   unread rail/title/tray agreement and that focus/restore alone never clears unread.
6. Check notification permission grant, denial and later system-setting changes.
   Test preview modes, mute, sound and identical incoming previews. On Windows,
   verify service-specific activation and withdrawal; on other platforms record
   the current activation/withdrawal limitation.
7. Exercise read actions only where the provider supports them. Check conversation
   scoping, concurrent arrivals and account isolation without reading private content
   into diagnostic output.
8. Verify copy/paste, text selection, zoom, fullscreen, keyboard navigation, settings
   save/close and language changes. On macOS verify Command shortcuts, Edit menu,
   Dock reopen after closing the window and background provider updates.
9. Verify close-to-tray, restore, quit, second-instance activation and optional
   start at login. On Linux record the desktop and tray/notification services used.
10. Check external-link destination confirmation and cancellation. On Windows,
    test authenticated PDF/attachment Save As, duplicates and cancellation. On
    macOS/Linux record the managed-download limitation and verify the browser path.
11. Test network loss/recovery, provider URL replacement and service removal with
    late callbacks. Confirm stale observations cannot restore a removed session
    or clear newer unread.
12. For a release candidate, install a correctly signed update on the same platform
    and architecture, reject altered signatures and verify confirmed restart and
    retained sessions. Linux needs its strict security gate resolved first. Keep
    updater verification distinct from OS code signing and notarization.
