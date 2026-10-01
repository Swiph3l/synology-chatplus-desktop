# Service providers

`ProviderDefinition` declares presentation, URL/origin rules and capabilities.
`ServiceConfig` stores provider, stable ID, name, URL, enabled state and notification
preference. `ServiceSession` binds a configuration to a native child-WebView label.
The registry accepts only ChatPlus, Synology Chat and Slack; it is not a plugin
framework or general browser.

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

IDs reject traversal, duplicates and excessive length; at most 12 services are
allowed. Additional services use isolated profile directories under app local data.
The migrated `chatplus` ID retains the original default directory. Removing a
service leaves its disk profile. Installed upgrade cookie retention is untested.

## ChatPlus

Primary/default provider. HTTP(S) URLs reject credentials, queries and fragments.
Navigation/popups require the exact configured origin; external HTTP(S) links can
use the default browser. Theme/unread scripts are injected only for ChatPlus.
Sidebar markers produce boolean state without message/title scraping or private APIs.

## Synology Chat

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

## Migration

Schema 0 plus legacy `serverUrl` creates exactly one deterministic `chatplus`
service and saves schema 1. Repeated migration is idempotent and preferences survive.
`serverUrl` remains a compatibility mirror; service configuration is authoritative.
Invalid active IDs select the first enabled service; zero enabled services leave
no active session. Invalid service configuration retains the disk record and falls
back to the legacy URL in memory. A failed migration write restores the old store
record while the migrated in-memory configuration runs; next startup retries.
