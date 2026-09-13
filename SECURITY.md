# Security

ChatPlus Desktop is an unofficial community client maintained by Swiph3l.

Use HTTPS with a valid certificate. TLS validation is never disabled. HTTP is
available for local deployments but does not protect traffic in transit.

Only configure a server you trust. Authentication takes place in its web
interface. The app stores preferences, not account credentials. The system
webview manages its own persistent cookies and local storage in the OS app data
directory. Treat that profile as sensitive. Changing the URL does not clear it.

The remote ChatPlus window has no Tauri capability grants. Native settings
commands additionally check the calling window and its local origin. The local
settings page has a restrictive CSP. Only bundled theme code is injected into
ChatPlus. Cross-origin top-level navigation is blocked; HTTP(S) links may open
in the default browser when enabled. External authentication redirects and
custom protocol links are not supported in this MVP.

About is bundled local content. Its diagnostics command uses an explicit allowlist
of build/runtime fields and a server-configured boolean, never a settings dump.
Only About may copy diagnostics through the native clipboard command. Project
links are maintainer-configured HTTPS destinations; remote pages cannot choose
an arbitrary URL through these commands. The Star action only opens a page.

Developer actions and the fixture window are compiled out of release builds.
The production frontend also omits fixture content. The official signed updater is
disabled until production configuration is supplied. Enabled checks use GitHub over
HTTPS, enforce version/channel policy and require valid signatures before installation.
Only local application windows can invoke these operations. The future release
workflow is disabled; it has not uploaded installers or published releases.

Camera, microphone and web notifications use the webview/OS permission behavior;
the application does not automatically grant them. There is no native message
notification bridge. No analytics or reporting integration was found in the
desktop shell source. This is not a verified absence of all network reporting:
the configured site, OS and Microsoft WebView2 have independent behavior.

The local Settings, About, License and Update capability grants only event listen/unlisten.
Native store, autostart, opener, clipboard, tray and window operations run in
Rust through scoped application commands or native UI actions. No filesystem,
shell, notification, plugin or general window/WebView permission is granted to
JavaScript.

## Network boundaries

The main WebView loads the user-configured server and resources selected by that
server. Exact-origin top-level navigation is not a subresource firewall. External
HTTP(S) links, redirects and scripted popups may open the default browser when
external links are enabled; this behavior is not restricted to verified user
gestures. Query strings may contain sensitive information.

Project links open the public GitHub repository. Enabled updater checks use GitHub
release metadata and HTTPS artifact delivery; see [updater configuration](docs/UPDATER_SIGNING.md).
The installer may download Microsoft WebView2 when it is absent. DNS, certificate
validation, runtime maintenance and server resources have independent network behavior.

Loopback addresses in development configuration and updater tests are not production
server defaults. The server preference defaults to empty, the development-origin
exception is debug-only and updater HTTPS fixtures compile only for tests. Tauri's
local IPC host is an application transport, not a private server endpoint.

## Dependency and release checks

Run locked dependency audits for each release. The current lockfile has RustSec
advisories for glib (RUSTSEC-2024-0429, in the Linux dependency graph),
proc-macro-error (RUSTSEC-2024-0370) and the unic crates (RUSTSEC-2025-0075,
RUSTSEC-2025-0080, RUSTSEC-2025-0081, RUSTSEC-2025-0098, RUSTSEC-2025-0100).
Strict advisory checks intentionally remain failing until these are resolved or
reviewed with platform/reachability evidence. License checks do not establish
redistribution compliance or absence of security vulnerabilities.

Build distribution packages through `npm run tauri build`, which remaps compiler
paths and the Windows PDB locator. Inspect extracted installer contents as well as
standalone binaries; scanning a compressed installer alone is insufficient.
SBOMs describe dependencies, not complete native binary composition. Checksums and
attestations must refer to the final signed bytes. See the
[release checklist](docs/RELEASE_CHECKLIST.md) for installation, privacy, antivirus,
signature and provenance checks. Source publication readiness does not establish
that a binary is ready for distribution.

Please report vulnerabilities privately to the maintainer using GitHub private
vulnerability reporting if available. Do not include server addresses, account
information, authentication headers, browser profiles or unsanitized screenshots
in public issues. If private reporting is unavailable, open a minimal issue
requesting a private contact without vulnerability details.

Only the current development branch is maintained. No public release is available.
