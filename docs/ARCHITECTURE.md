# Architecture

The application wraps each provider's own web app. The local TypeScript shell owns
presentation/forms; Rust owns configuration, service lifecycle and desktop policy.
There is no provider credential automation, copied server bundle or private API client.

## Native and frontend structure

The native main window hosts a local `main` WebView for the 56-pixel service rail and
30-pixel status footer. Provider child views are `service-<id>`, sized around those
local controls. Settings, About, license and update windows use bundled local pages.
Use `get_window("main")` for the host: a multi-WebView window is not necessarily a
`WebviewWindow`. Native foreground must be visible, focused and not minimized;
child focus can survive minimize/background.

Tauri's `unstable` child-view feature is intentional. Session transitions are
serialized by the native lifecycle lock. Enabled services are created on first
activation, then hidden/shown without destroying their provider state. A service
never activated in this run has no live session to emit notifications.

## Registry and persistence

`ProviderDefinition` declares capability, presentation and navigation rules.
`ServiceConfig` records a stable ID, provider, name, URL, enabled state and desktop
notification preference. `ServiceSession` connects that configuration to its view.
The registry accepts five provider types and at most 12 services.

ID validation rejects traversal, case-insensitive collisions and Windows reserved
names. A service ID is its account/profile identity; renaming does not change it.
Additional views use app-local-data `services/<id>` profiles. Migration preserves the
legacy `chatplus` ID's original default profile directory. Removal retains its disk
profile. Installed cookie/session retention still requires Windows acceptance.

Settings persist through the Tauri store. Connection status is a native per-session
observation. Authoritative unread and notification event tracking are memory-only;
restart observes provider DOM afresh without replaying historical toasts. There is
no persisted desktop unread count.

## State ownership

| State                                                                  | Owner                              | Consumers                                                     |
| ---------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------- |
| Service configuration and selected service                             | Rust settings/lifecycle            | Local forms, rail, native menus and provider session creation |
| Per-service unread, transition generation and read/arrival metadata    | Rust unread service                | Rail dots, title/taskbar/tray aggregate and diagnostics       |
| Provider DOM unread/read observations                                  | Provider adapter input             | Shared renderer bridge to validated native transitions        |
| Native foreground generation                                           | Rust host window                   | Renderer visibility projection and native read/toast guards   |
| Notification identities, pending completions and delivery reservations | Native notification bridge/service | Duplicate prevention and native submission                    |
| Update eligibility and verified download bytes                         | Rust updater service               | Local update panel; confirmation before install               |

Unread presentation uses a whole revisioned snapshot of services plus the derived
aggregate. The rail accepts current native snapshots rather than maintaining its
own unread truth. Title, taskbar and tray use the same enabled-service aggregate.
A delayed frontend snapshot cannot overwrite a newer revision. Presentation options
may hide a title/tray badge without changing the unread state.

`hasUnread` is boolean. Counts remain unavailable where providers only expose
mentions, ambiguous rows or incomplete navigation. Provider DOM observations are
inputs, and submitting a Windows toast never defines unread. See
[NOTIFICATIONS.md](NOTIFICATIONS.md) for the transition and proof rules.

## IPC and trust boundaries

Local commands verify the invoking view label and local origin. The capability
file grants event listen/unlisten to named bundled views; remote services have no
native Tauri capability grants. A Windows WebView2 message bridge validates the
configured service, exact source origin, packet shape, bounded values and current
foreground generation before accepting provider observations.

Provider documents receive project bootstrap code, not desktop command authority.
Navigation and popup rules are per provider. Same-origin popups reuse a service view;
allowed external HTTP(S) links use the user's browser according to settings. Origin
rules are not a subresource firewall. TLS and updater signatures stay enabled.

Authenticated attachment requests remain in the originating WebView2 session.
Download handling uses the platform pipeline, validates download destinations and
does not copy cookies into a custom HTTP client or execute completed files.
See [Windows download acceptance](WINDOWS_ACCEPTANCE.md#current-reliability-pass-2026-10-07).

## Build and release boundaries

Vite builds local pages. `build-theme.mjs` bundles the ChatPlus theme separately from
provider unread bootstrap; non-ChatPlus providers do not receive ChatPlus styling.
The Rust build script embeds version, actual Git state, build time and toolchain
metadata. Untagged builds use development identity. Debug fixtures are excluded from
production assets and release native commands.

Normal local builds strip signing credentials and disable updater artifacts while
retaining the public runtime verification key. Version tags alone enter the signed
Windows draft-release workflow; required checks must pass on that commit, and public
publication is a separate operation. [UPDATER.md](UPDATER.md) describes this boundary.
