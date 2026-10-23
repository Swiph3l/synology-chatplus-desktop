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

Tauri's `unstable` child-view feature is intentional. The selected service opens
first. A background worker then creates the remaining enabled services one at a
time, in configured order. Hidden sessions retain their provider state and can
receive events without first being selected. Preloading does not change selection,
take focus or acknowledge unread. See [service startup](SERVICE_STARTUP.md) for the
queue and shutdown rules.

Configuration and session transitions use the native lifecycle lock. Creation
reserves a specific service identity and generation before dispatching WebView
work; stale load callbacks cannot complete a replacement session. Do not wait for
child creation or asynchronous UI callbacks while retaining that lock. UI callbacks
use `with_configured` to fail a concurrent transition rather than block a worker
that may itself need the UI. Keep guarded work to identity checks, state mutation
and capturing the originating view; perform deferred projection after unlocking.

### Autostart identity

Application storage isolation does not isolate a shared Windows autostart entry.
Both the autostart plugin and Windows command/status reconciliation must use
`state::autostart_entry_name`. The canonical identifier
`io.github.swiph3l.chatplus-desktop` retains the entry name `ChatPlus Desktop` so
existing preferences survive. Other identifiers use
`ChatPlus Desktop (<identifier>)`. This separates their Run and StartupApproved
entries and prevents an alternate build from adopting or repairing production's
autostart command. Changing only the profile directory is insufficient.

## Registry and persistence

`ProviderDefinition` declares capability, presentation and navigation rules.
`ServiceConfig` records a stable ID, provider, name, URL, enabled state and desktop
notification preference and color. `ServiceSession` connects that configuration
to its view. The closed Rust and TypeScript registries accept seven provider types:
Synology ChatPlus, Synology Chat, Discord, WhatsApp, Messenger, Slack and Mattermost.
At most 12 service instances are accepted. Capabilities and support status are
provider-specific; see [providers](PROVIDERS.md).

ID validation rejects traversal, case-insensitive collisions and Windows reserved
names. A service ID is its account/profile identity; renaming does not change it.
Additional views use app-local-data `services/<id>` profiles. Migration preserves the
legacy `chatplus` ID's original default profile directory. Removal retains its disk
profile. Replacing a service's provider or URL invalidates its live session and
cached observations. Provider authentication stays in the browser profile; the
desktop does not extract or persist credentials itself.

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

`hasUnread` is boolean, with separate known-read/known-unread/unknown certainty,
optional counts and conversation evidence. Counts remain unavailable where providers
only expose mentions, ambiguous rows or incomplete navigation. Provider DOM
observations are inputs, and submitting a Windows toast never defines unread.
Selection, focus, toast activation and toast dismissal cannot acknowledge unread.
Explicit read actions retain their own provider and instance boundaries. See
[NOTIFICATIONS.md](NOTIFICATIONS.md) for the transition and proof rules.

## IPC and trust boundaries

Local commands verify the invoking view label and local origin. The capability
file grants event listen/unlisten to named bundled views; remote services have no
native Tauri capability grants. A Windows WebView2 message bridge validates the
configured service, exact source origin, packet shape, bounded values and current
foreground generation before accepting provider observations.

Provider documents receive project bootstrap code, not desktop command authority.
Navigation and popup rules are per provider. Allowed popups use separate related
WebViews with the opener's profile; they do not replace the provider view. External
HTTP(S) links require the saved preference and a fresh native destination
confirmation before opening in the user's browser. Origin rules constrain document
navigation, not every subresource. TLS and updater signatures stay enabled.

Authenticated attachment requests remain in the originating WebView2 session.
Windows download handling defers the original transfer for a queued native Save As
picker, then displays the chosen full local destination. It does not copy cookies
into a custom HTTP client or execute completed files. The selected path is ephemeral
shell state. [Links and downloads](LINKS_AND_DOWNLOADS.md) defines routing,
confirmation and destination contracts.

## Build and release boundaries

Vite builds local pages. `build-theme.mjs` bundles the ChatPlus theme separately from
provider unread bootstrap; non-ChatPlus providers do not receive ChatPlus styling.
The theme has a document-start fallback, persistent stylesheet and scoped repair
lifecycle; see [theming](THEMING.md).
The Rust build script embeds version, actual Git state, build time and toolchain
metadata. Untagged builds expose development version/channel metadata; the
application identifier still comes from Tauri configuration. Debug fixtures are
excluded from production assets and release native commands.

Normal local builds strip signing credentials and disable updater artifacts while
retaining the public runtime verification key. Version tags alone enter the signed
Windows draft-release workflow; required checks must pass on that commit, and public
publication is a separate operation. [UPDATER.md](UPDATER.md) describes this boundary.

## Source map

| Contract                                  | Primary implementation                                                                                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host window and local shell               | [`main.rs`](../src-tauri/src/main.rs), [`window.rs`](../src-tauri/src/window.rs), [`src/app`](../src/app)                                                                                                                                |
| Provider registry, identity and lifecycle | [`providers.rs`](../src-tauri/src/providers.rs), [`services.rs`](../src-tauri/src/services.rs), [`state.rs`](../src-tauri/src/state.rs)                                                                                                  |
| Unread evidence and notification delivery | [`unread.rs`](../src-tauri/src/unread.rs), [`notification_bridge.rs`](../src-tauri/src/notification_bridge.rs), [`desktop_notifications.rs`](../src-tauri/src/desktop_notifications.rs), [`src/theme/providers`](../src/theme/providers) |
| Navigation, confirmation and transfers    | [`navigation.rs`](../src-tauri/src/navigation.rs), [`external_links.rs`](../src-tauri/src/external_links.rs), [`downloads.rs`](../src-tauri/src/downloads.rs)                                                                            |
| Local IPC permissions                     | [`commands.rs`](../src-tauri/src/commands.rs), [`capabilities/settings.json`](../src-tauri/capabilities/settings.json)                                                                                                                   |
| Theme/bootstrap bundles                   | [`bootstrap.ts`](../src/theme/bootstrap.ts), [`dark.css`](../src/theme/dark.css), [`build-theme.mjs`](../scripts/build-theme.mjs)                                                                                                        |
