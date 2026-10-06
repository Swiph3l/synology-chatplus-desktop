# Service providers

`ProviderDefinition` declares presentation, URL/origin rules and capabilities.
`ServiceConfig` stores provider, stable ID, name, URL, enabled state and notification
preference. `ServiceSession` binds a configuration to a native child-WebView label.
The registry accepts only ChatPlus, Synology Chat, Slack, Discord and Mattermost;
it is not a plugin framework or general browser.

## Desktop boundaries

The local `main` view renders a 56-pixel rail. Each service uses a `service-<id>`
child WebView, created lazily on activation. Previously activated views remain
alive while hidden. Never-activated services cannot report unread or notify.
Tauri's `unstable` feature enables child views; native layout/DPI testing remains
required before release.

Only named local views have event listen/unlisten capability. Native commands
also verify labels and local URLs. Remote provider views have no native IPC grants.
The WebView2 bridge accepts bounded observations from the configured origin;
it cannot execute desktop commands. Popups create no additional desktop windows.

IDs reject traversal, duplicates regardless of letter case, Windows device names
and excessive length; at most 12 services are allowed. Valid stored ID spelling
and profile paths stay unchanged. Additional services use isolated profile
directories under app local data.
The migrated `chatplus` ID retains the original default directory. Removing a
service leaves its disk profile. Installed upgrade cookie retention is untested.

The service ID is also its profile identity. It is independent of provider type
and display name: multiple Discord, Slack, Mattermost or ChatPlus configurations use distinct
`services/<id>` directories, and a rename keeps the same directory. No cookie,
credential, token or profile-content copying is implemented. Removing one service
does not delete any profile directory. The legacy `chatplus` ID is the only default
profile exception; migration and repeat-start behavior are unchanged.

Provider presentation declares whether a service needs a server URL, workspace
URL or fixed entry URL. Discord's Services form is name-only, and its General tab
does not show an irrelevant server field. Services use common controls and
informational Experimental badges. Removal is confirmed and persisted immediately;
it retains the stored profile and does not save unrelated form edits.

The external rail's context menu reuses the desktop's native Tauri menu system.
It offers Open, local Rename/Service settings, and confirmed Remove service.
ChatPlus, Synology Chat and Discord additionally offer per-service desktop notification
mute/unmute and the notification settings control. These are desktop preferences, not provider
server administration. Mark-read, provider-side mute, members/invitations and leaving
a remote server have no API here and are omitted. Provider administration and
provider-side notification preferences remain in the embedded application.

## Unread and notification capabilities

| Provider          | Unread adapter | Native browser-notification bridge | ChatPlus theme injection |
| ----------------- | -------------- | ---------------------------------- | ------------------------ |
| Synology ChatPlus | Enabled        | Enabled                            | Enabled                  |
| Synology Chat     | Enabled        | Enabled                            | Disabled                 |
| Discord           | Enabled        | Enabled                            | Disabled                 |
| Slack             | Disabled       | Disabled                           | Disabled                 |
| Mattermost        | Disabled       | Disabled                           | Disabled                 |

Enabled capabilities describe implemented Windows integration, not completed live
acceptance. Each service still needs its own saved notification preference and the
global Desktop notifications preference enabled. Earlier saved `notifications: false`
values are preserved; enabling a newly supported capability does not silently unmute
existing configurations. Provider-side settings and Windows permission/policy still
control whether a browser notification is emitted and displayed.

Adapters supply observations to the authoritative native per-service unread model;
rail dots and tray/title/taskbar aggregation derive from its revisioned snapshot.
Counts remain unavailable: mention badges, duplicated rows and incomplete navigation
do not give a trustworthy total. Missing/ambiguous UI retains the native cache.

A trusted current-generation interaction in the actual latest conversation/composer,
with native foreground and service selection, can acknowledge reliable provider
aggregate zero. This retires completed native arrivals without requiring exact tags,
fixing the Synology sticky latch. It cannot retire an in-flight arrival; native completion can retry still-current
trusted proof. It cannot acknowledge
synthetic/header/sidebar input or reuse a gesture after route/content changes.
Positive/unknown aggregates preserve service unread while permitting exact individual
message proofs where available. See [read rules](NOTIFICATIONS.md#read-acknowledgement).

Native foreground alone cannot suppress a toast: the provider must identify the
originating message as currently visible at latest, and native policy rechecks that
context. Unknown tags/DOM or failed queries allow delivery. Every accepted native
arrival latches unread before toast policy is considered. Activation restores the
existing process/window and selects the originating service without guessing routes.

## ChatPlus

The service rail uses the blue [Synology ChatPlus provider icon](https://www.synology.com/img/dsm/chatplus/icon_banner_ChatPlus.png),
bundled locally as `public/providers/synology-chatplus.png`. The desktop app's own
branding asset remains separate.

**Primary / Supported** provider and the default for migrated single-server settings.
HTTP(S) URLs reject credentials, queries and fragments.
Navigation/popups require the exact configured origin; external HTTP(S) links can
use the default browser. ChatPlus alone receives the project-authored theme.
Its separate unread adapter observes tab indicators from existing authenticated-layout evidence
(`sidebar-tab-item-*` / `tab-item-indicator`). A real visible conversation scroller
at bottom and trusted interaction in that pane or its uniquely mapped main composer
provide read evidence; a selected tab or flashing document title does not. Sidebar markers produce boolean state without message/title
scraping or private APIs. The audited notification event has no reliable conversation
tag mapping, so ChatPlus conservatively delivers actual incoming browser notifications
even when the selected service is foreground.
The current private ChatPlus web bundle has not been independently audited; live
marker, upstream focus/read and notification behavior remain manual acceptance gates.

## Synology Chat

The service rail uses the green [Synology Chat provider icon](https://nascompares.com/wp-content/uploads/2018/08/Synology-Chat-logo.png),
bundled locally as `public/providers/synology-chat.png`.

Synology Chat has supported unread/native-notification integration and an isolated
profile. Its general provider UI still carries an Experimental badge while
authenticated Windows acceptance remains pending. Synology documents a
[browser client](https://www.synology.com/en-us/dsm/feature/chat) and a
[matching desktop interface](https://kb.synology.com/en-global/DSM/help/ChatClient/chatclient?version=6).
A dedicated adapter uses Synology Chat's independently audited server templates,
including channel-list highlights and group unread badges; it does not reuse
ChatPlus selectors or styling. Starred duplicates channel rows and channel badges
can count mentions, so the adapter publishes a boolean rather than a total.
Read evidence checks the actual `#channels/<id>` conversation, its visible message
pane and transformed FleXcroll content end/newest-message control. Its main composer
is a sibling of the message panel inside the audited center panel; thread/edit/search
inputs cannot acknowledge the main conversation. Partial or
unrecognized aggregate UI remains unknown.

The source audit inspected the official
[Chat 2.2.0-1432 server package](https://global.synologydownload.com/download/Package/spk/Chat/2.2.0-1432/Chat-x86_64-2.2.0-1432.spk),
SHA-256 `72d406e88f09875c0fdf006d5828fb34f0101445eacff68e1fbd33155cb6f19e`.
Its public ActiveDetector reads `document.hidden` and visibility changes to activate
the client/server session. LastViewAtUpdater uses that active state when marking a
bottom-positioned current conversation read. The dedicated adapter projects native
foreground into public `document.hidden`/`visibilityState` and emits visibility changes
when effective visibility changes, preventing a logically visible background WebView
from enabling upstream read activity. It does not access private provider state.

The compiled server's active-session-to-notification creation decision remains
unverified, so this source-backed read workaround establishes no native or live toast
success. Newer Chat 2.4.7/ChatPlus 1.0 packages could not be inspected as ordinary
archives; current server markup and behavior remain manual acceptance gates. No
vendor package or source bundle is redistributed.

Unread and the native browser-notification bridge are enabled. The audited browser
notifications have no reliable conversation tag; generic titles/sender names cannot
justify foreground suppression. Provider notification preferences remain authoritative.
Authenticated message/read, toast and click acceptance, login, uploads, calls and
external SSO remain pending controlled Windows testing.

## Slack

Distinct experimental provider. Top-level origins are limited to HTTPS `slack.com`
and subdomains on port 443; suffix lookalikes and credentials are rejected.
Normal web login uses WebView-managed persistence. There are no API secrets,
credential scraping or authentication bypasses. External identity providers open
in the default browser; cookie handoff is not implemented, so some SSO flows may
be unusable. Unread and native notifications are disabled.

See Slack's [browser requirements](https://slack.com/help/articles/115002037526-System-requirements-for-using-Slack)
and [sign-in documentation](https://slack.com/help/articles/212681477-Sign-in-to-Slack).
WebView2 compatibility and workspace policies are untested; no Slack Desktop parity
is claimed.

## Discord

Discord unread/native-notification integration is supported functionality. Its
general provider UI still carries an Experimental badge pending authenticated
Windows acceptance. Web sessions start at `https://discord.com/app/`. Top-level navigation
and same-origin popups permit only `https://discord.com` on port 443, with no URL
credentials. Configurations also reject query parameters and fragments. Off-origin
HTTP(S) links use the existing external-browser preference; no popup WebViews are
created. There are no authentication-origin exceptions: arbitrary subdomains,
`discordapp.com`, invitation domains and external identity providers are not
embedded. External identity-provider cookie handoff is unavailable.

Discord documents its [web login](https://support.discord.com/hc/en-us/articles/360057027354-How-to-Log-In-to-your-Discord-Account)
and [browser requirements](https://support.discord.com/hc/en-us/articles/213491697-What-are-the-OS-system-requirements-for-Discord).
WebView2 account policies, MFA, CAPTCHA, calls, uploads and embedded login success
require live validation. Authentication is manual; no credentials, tokens, CAPTCHA
bypasses or Discord private APIs are used. The bundled provider symbol comes from
the [official brand assets](https://discord.com/branding) and retains their terms.

Unread and native notifications are enabled through a dedicated Discord adapter;
ChatPlus theme injection remains disabled. The adapter observes Discord's own
guild/folder/Favorites and unread-DM navigation, using scoped semantic markers and
complete aggregate metadata. Home badges also include Nitro offers/activity and
are excluded. Guild hover/selection shares the unread pill appearance, so the pill
alone cannot establish unread or zero. Audited guild accessibility labels can be
compared with their actual `data-dnd-name` without assuming an English UI; media
status badges retain unknown when the label is ambiguous.

Complete guild groups and expanded-folder children must expose consistent set-size
and position metadata before asserting global zero. The ordinary private sidebar
must also be visible and expose complete row metadata, without selected/hovered/muted
DM rows or a message-request/spam row. The unread-DM group and private-row pills are
mention-based: ordinary muted DM unread can be absent from both. Ordinary private
rows also exclude requests/spam. An empty DM aggregate while viewing another guild
therefore cannot clear cached unread. Current public sidebar special rows can omit
position metadata; these layouts remain unknown rather than filling those gaps.
Selected/hovered collapsed folders, ambiguous media labels and accounts without any
guild aggregate metadata also remain unknown. Such states can retain a cached dot
after reading until stronger provider evidence is available. Mention numbers overlap aggregate markers,
so counts remain unavailable. Document titles are not a read/unread source.

Discord's public browser blur handler only reports unfocused if `document.hasFocus()`
is false; its focus handler always reports focused. A WebView can remain logically
focused while the Windows host is minimized. The adapter therefore floors the public
`document.hasFocus()` result by native foreground state and dispatches public window
blur/focus only on actual host transitions. Misleading background focus is intercepted;
generation-only updates do not repeatedly refocus Discord or trigger read acknowledgements.
No private store/webpack API is called. Provider-side disabled notifications, DND and
mute remain in force; the desktop does not synthesize toasts from unread DOM.

Discord notification tags are message snowflakes. Suppression requires that exact
message row in the actual route's visible latest viewport, with no history/error bar;
a channel ID, similar title or offscreen row is insufficient. Conversation content
context uses the newest actual rendered message identity independently of bottom
scroll position; inserting older virtualized rows does not invent incoming content.
Trusted conversation
scroll/editor interaction can provide read context; header/sidebar activation cannot.
Retained background event tags can be retried during a later trusted conversation
interaction. Each individual proof must still match its actual visible latest message
row and receive native confirmation. A positive or unknown provider aggregate can
permit this partial progress while preserving its unread boolean; unmatched events
and unknown aggregate state still prevent a global clear. The desktop cannot infer
a read from an unrelated content change.

The audit used Discord's publicly served production assets:

| Source                                                                        | Audited behavior                                                                                                                                                                                                                                                           | SHA-256                                                            |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [web.24a0dd4254453b09.js](https://discord.com/assets/web.24a0dd4254453b09.js) | Modules 346142/350723/531685 public focus state; 592329 browser notification eligibility/tag; 112943 guild navigation; 131677/573163 mention-only DM aggregate; 593065 private-list row metadata; 715069 muted/selected DM rendering; 645959/309199 request/spam exclusion | `d141f126a87e0e4c49898f95c71b467641fe7e26022da5abcec663c104f3afcb` |
| [739c29133b0fdbcc.js](https://discord.com/assets/739c29133b0fdbcc.js)         | `chat-messages-<channel>-<message>` identity, rendered message scroller, two-pixel bottom tolerance and `hasMoreAfter` history distinction                                                                                                                                 | `e44441443c591cc4cb98e001c9f542c1e4ce27490e30b24b72999eea349c22cc` |

These public implementation details can change. Structural mismatches remain unknown;
authenticated Windows behavior still needs manual acceptance. Discord's
[notification controls](https://discord.com/blog/how-to-manage-your-discord-desktop-notifications)
explain provider-side server/channel mute, desktop preferences and DND behavior.

Tests cover dedicated adapter evidence/unknown states, focus projection, latest-view
and message matching, strict origins, provider registration, two
Discord configurations, stable separate profile paths, rename/restart/removal,
name-only configuration and distinct rail activation/tooltips. A native development
instance reached Discord's login prompt using its separate profile; that observation
does not establish authenticated account persistence or multiple-account success.

Manual acceptance requires two test accounts: sign into each instance, switch away
and back, rename one, restart twice, disable/remove one, and confirm the other
account/session survives. Keep credentials and all session/profile contents out of
Git, logs, screenshots and diagnostic output.

## Mattermost

Mattermost (Experimental) uses the shared Services form: Provider, custom Display
name, required Server URL, Enabled, and the informational Experimental badge/block.
Examples include Mattermost — Company, Mattermost — Private and Mattermost — Client A.
Its rail symbol uses the official Mattermost SVG logomark, displayed in black on
light surfaces and white on dark surfaces. Source and usage terms:
[Mattermost brand guidelines](https://handbook.mattermost.com/operations/operations/company-processes/publishing/publishing-guidelines/brand-and-visual-design-guidelines).

Configure your own server, for example `https://chat.example.com` or
`https://mattermost.example.com`. The existing HTTP(S) policy accepts custom hosts,
ports and installation paths; it rejects empty/malformed URLs, unsafe schemes,
credentials, query parameters and fragments. Normalization canonicalizes the host,
default port and trailing slash. Navigation and popups require the exact configured
scheme, host and port; there is no mattermost.com allowlist. External HTTP(S) links
use the existing default-browser preference. Cross-origin SSO can open there, but
there is no browser-cookie transfer or embedded cross-origin authentication bypass.

| Capability                              | Current state                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| Web session / normal web login          | Implemented through the shared WebView; authenticated live acceptance pending         |
| Persistent profile / multiple instances | Stable `services/<service-id>` directories, including two accounts on the same server |
| Switching                               | Existing lazy creation and hidden-view reuse; no provider-specific reload             |
| External links                          | Shared safe HTTP(S) handling, controlled by desktop preference                        |
| Native unread / notifications           | Disabled; no Mattermost DOM scraping or notification adapter enabled                  |
| ChatPlus theme injection                | Disabled                                                                              |
| Outer service menu                      | Open, local Rename/Service settings and confirmed Remove service                      |
| Provider administration                 | No API; no members, leave-team or server-admin actions                                |

Renaming retains the ID/profile. Removing one configuration closes its view and
retains its disk profile, without deleting another account's profile or saving
unrelated Settings drafts. A server URL is always required; Discord's fixed-entry,
name-only form is not used.

Mattermost documents [browser-based access and authentication](https://docs.mattermost.com/end-user-guide/preferences/manage-your-security-preferences).
Server policies, WebView2 login/SSO compatibility, authenticated restart retention
and two-account isolation still need controlled live validation. Tests establish
configuration, origin rules, serialization, stable profile paths, rename/removal,
form rendering and menu routing; they do not establish successful authentication.

## Migration

Schema 0 plus legacy `serverUrl` creates exactly one deterministic `chatplus`
service and saves schema 1. Repeated migration is idempotent and preferences survive.
`serverUrl` remains a compatibility mirror; service configuration is authoritative.
Invalid active IDs select the first enabled service; zero enabled services leave
no active session. Invalid service configuration retains the disk record and falls
back to the legacy URL in memory. A failed migration write restores the old store
record while the migrated in-memory configuration runs; next startup retries.

## Adding a provider

1. Inspect its actual DOM and documented/public notification behavior independently.
2. Add a typed registry entry in Rust and TypeScript with accurate capability/status
   flags, entry URL and strict navigation/origin policy; preserve per-service profiles.
3. Implement the common semantic adapter contract in src/theme/providers:
   snapshot, observe, readContext, contentContext, interactionContext,
   providerUnreadZero and isViewingNotification. Keep selectors provider-specific and
   shared lifecycle/state policy in provider-unread.ts and native unread modules.
4. Map only the uniquely active conversation and composer. Unknown identity/layout
   must remain unknown. Do not scrape message text or private provider APIs.
5. Add independent minimized/read/composer/synthetic/generation fixtures and native
   origin/capability regressions. Include service mute and multiple instances.
6. Complete authenticated [Windows acceptance](WINDOWS_ACCEPTANCE.md#current-reliability-pass-2026-10-07)
   before claiming provider parity. Never commit test accounts, tokens or private URLs.

## Attachments

Windows attachment transfers use the originating WebView2 download pipeline and
profile, preserving authentication cookies without exporting them. Normal provider
Content-Disposition suggestions and URL-encoded names pass through filename safety
and duplicate reservation. Downloads never auto-execute. The native DownloadStarting observer leaves Handled=false so WebView2 retains its
save/download/cancel/retry/security UI. A narrow related popup may show same-origin
blob attachments or exact Discord CDN /attachments/ URLs without navigating away
from the originating view. Inline PDF/image previews use their native download
button. Other external-document handling remains governed by navigation policy.
Provider-specific live attachment acceptance remains pending. See the [download checklist](WINDOWS_ACCEPTANCE.md#current-reliability-pass-2026-10-07).
