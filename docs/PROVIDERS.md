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
ChatPlus additionally offers per-service desktop notification mute/unmute and its
existing notification settings control. These are desktop preferences, not provider
server administration. Mark-read, provider-side mute, members/invitations and leaving
a remote server have no API here and are omitted. Embedded provider UI is untouched.

## ChatPlus

The service rail uses the blue [Synology ChatPlus provider icon](https://www.synology.com/img/dsm/chatplus/icon_banner_ChatPlus.png),
bundled locally as `public/providers/synology-chatplus.png`. The desktop app's own
branding asset remains separate.

Primary/default provider. HTTP(S) URLs reject credentials, queries and fragments.
Navigation/popups require the exact configured origin; external HTTP(S) links can
use the default browser. Theme/unread scripts are injected only for ChatPlus.
Sidebar markers produce boolean state without message/title scraping or private APIs.

## Synology Chat

The service rail uses the green [Synology Chat provider icon](https://nascompares.com/wp-content/uploads/2018/08/Synology-Chat-logo.png),
bundled locally as `public/providers/synology-chat.png`.

Distinct experimental provider with an isolated profile. Synology documents a
[browser client](https://www.synology.com/en-us/dsm/feature/chat) and a
[matching desktop interface](https://kb.synology.com/en-global/DSM/help/ChatClient/chatclient?version=6).
A WebView foundation is feasible by inference from those documents, not a live NAS
test. Its exact-origin navigation does not reuse ChatPlus DOM or theme selectors.
Unread and native notifications are disabled pending independent adapter validation.
Login, uploads, calls and external SSO are untested.

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

Experimental web sessions start at `https://discord.com/app/`. Top-level navigation
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

Unread, native notifications and ChatPlus theme injection are disabled. There is
no Discord DOM adapter. Tests cover strict origins, provider registration, two
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
