# Service providers

The Rust and TypeScript registries define each provider's entry URL, presentation
and capabilities. `ServiceConfig` stores its stable ID, provider, display name,
URL, enabled state, notification preference and notification color. This is a
closed registry, not a general browser or plugin framework.

## Capabilities

The table describes Windows integration. Experimental providers retain their own
Web UI and may have account, browser or server-version compatibility limits.

| Provider          | Status       | Unread evidence                          | Native browser notifications | ChatPlus theme |
| ----------------- | ------------ | ---------------------------------------- | ---------------------------- | -------------- |
| Synology ChatPlus | Primary      | Aggregate DOM                            | Yes                          | Yes            |
| Synology Chat     | Experimental | Aggregate DOM                            | Yes                          | No             |
| Discord           | Experimental | Aggregate DOM and exact message identity | Yes                          | No             |
| WhatsApp          | Experimental | Positive badges only; otherwise unknown  | Yes                          | No             |
| Messenger         | Experimental | Browser notification arrivals only       | Yes                          | No             |
| Slack             | Experimental | Unavailable                              | No                           | No             |
| Mattermost        | Experimental | Browser notification arrivals only       | Yes                          | No             |

Unread support does not imply read-action support. Current adapters report boolean
unread or unknown, not an account-wide message total. Read capabilities and native
delivery policy are documented in [Notifications and unread](NOTIFICATIONS.md).

## Identity and storage

Each service uses a `service-<id>` child WebView. The selected enabled service loads
first; other enabled services start in rail order and remain alive while hidden.
They can report unread and notifications without a first rail click. See
[Service startup](SERVICE_STARTUP.md).

The stable service ID also identifies its isolated WebView profile at
`services/<id>` under application local data. Provider type, display name and rail
order do not determine storage identity. Renaming or reordering preserves the
profile; removing a service closes its view and retains its profile on disk. The
migrated `chatplus` ID is the sole exception and retains the original default
profile. ChatPlus does not copy cookies, tokens or profile contents between services.

At most 12 services are allowed. IDs contain only ASCII letters, numbers and
hyphens, are limited to 64 characters and must be unique regardless of letter case.
Windows device names and path traversal are rejected without rewriting valid IDs.

Remote provider views have no Tauri command capabilities. Local commands validate
their caller's label and URL. The WebView2 observation bridge checks the configured
service, current source origin and document/session identity before accepting
bounded unread or notification input.

The native rail menu targets the clicked stable ID. Open, mute/unmute, Service
settings and Remove stay at the top level; More groups supported read actions,
browser permission repair and desktop notification settings. Rename is available
in Service settings. Unsupported read actions are omitted. These controls do not
change provider-side mute, membership or server administration.

## URL and navigation policy

Configured URLs reject credentials, query parameters and fragments. Provider
navigation can use normal routes and query parameters within its allowed origin.

| Provider                          | Allowed embedded origin                    |
| --------------------------------- | ------------------------------------------ |
| Synology ChatPlus / Synology Chat | Exact configured HTTP(S) origin            |
| Discord                           | `https://discord.com:443`                  |
| WhatsApp                          | `https://web.whatsapp.com:443`             |
| Messenger                         | `https://www.facebook.com:443`             |
| Slack                             | HTTPS `slack.com` or a subdomain, port 443 |
| Mattermost                        | Exact configured HTTP(S) origin            |

Sibling domains, suffix lookalikes, URL credentials and unsupported ports are not
authentication exceptions. Off-origin HTTP(S) links require the external-browser
preference and an explicit destination confirmation. External identity-provider
cookie handoff is not implemented, which limits some SSO flows.

Related popups share the originating profile and remain subject to navigation
guards. Downloads use that profile's authenticated WebView2 pipeline; ChatPlus
does not export cookies or auto-execute attachments. See
[Links and downloads](LINKS_AND_DOWNLOADS.md).

## Adapter contracts

Provider-specific selectors live in `src/theme/providers`. The shared lifecycle
in `provider-unread.ts` handles observation revisions, foreground generations,
trusted interactions and exact arrival proofs. The native unread store owns the
resulting per-service state. Adapters must preserve unknown when evidence is
missing, partial, virtualized or ambiguous; focus and selection are not read proof.
DOM badge changes never manufacture message notifications.

### Synology ChatPlus

ChatPlus alone receives the project theme; see [Theming](THEMING.md). Its adapter
uses sidebar tab indicators and requires a uniquely mapped visible conversation
scroller at the latest messages, or its mapped main composer, for read context.
Selected tabs and document-title badges are insufficient. Browser notification
tags have no reliable exact conversation mapping, so foreground notifications are
delivered conservatively.

### Synology Chat

The dedicated adapter uses channel highlights and complete group metadata.
Starred rows can duplicate channels and badges can count mentions, so their sum is
not a message total. Read context requires the matching `#channels/<id>` route,
visible message panel, FleXcroll content end/newest-message control and mapped main
composer. Thread, edit and search inputs cannot acknowledge the main conversation.

The adapter projects native foreground into public document visibility APIs so a
logically visible background child does not enable upstream read activity. It
uses no private provider state. Unrecognized server markup remains unknown, and
notification titles or sender names cannot establish exact viewing proof.

### Discord

The entry URL is `https://discord.com/app/`; login uses the normal provider UI and
WebView profile. No token handling, private stores, webpack APIs or security-check
bypasses are used.

Unread evidence combines guild/folder/Favorites and private-channel navigation.
Home promotions, hover/selection pills and mention totals cannot establish global
unread or zero. A global zero requires complete, consistent guild/folder metadata
and the ordinary private sidebar. Selected, hovered or muted DM rows, missing
positions, ambiguous media labels and request/spam scope can leave the aggregate
unknown. A mention-only DM group cannot establish that every conversation is read.

Native foreground floors public `document.hasFocus()` and drives public blur/focus
transitions. This prevents minimized or background WebViews from appearing active
to Discord. Generation-only updates do not repeatedly refocus the page.

Exact read/suppression proof requires the notification's message snowflake in the
matching route's visible, unobscured latest viewport. A channel ID, similar title,
offscreen message or unrelated content change is insufficient. History/error bars
block proof. Current-content identity follows the newest rendered message, so
loading older history does not appear to be a new incoming message. See
[Read acknowledgement](NOTIFICATIONS.md#read-acknowledgement) and
[Explicit service read actions](NOTIFICATIONS.md#explicit-service-read-actions).

### WhatsApp

The entry URL is `https://web.whatsapp.com/`. QR and phone-number pairing use
WhatsApp's official UI when offered. The normal Chromium/WebView2 identity is
retained; no user-agent spoof, pairing/session interception or custom credential
storage is implemented. Each instance has its own linked-device profile. ChatPlus
does not control the browser name shown by WhatsApp on a phone.

The dedicated adapter reads only existing `icon-unread-count` / `unread-count`
badge metadata inside visible chat-list rows. Arbitrary contact, preview, action
and photo labels are not inspected, even if their text resembles an unread badge.
Visible badge counts are not promoted to an account total. Missing badges or
filtered, archived, collapsed and virtualized lists remain unknown, never a global
zero.

There is no reliable privacy-safe current-chat/message mapping. Current/all read
actions and exact foreground suppression are unavailable. Native browser events
provide notification content; DOM observations do not scrape messages or fabricate
toasts. Activation selects the correct instance and may invoke the provider's own
retained click handler without guessing a conversation URL or acknowledging unread.
The integration remains Experimental. ChatPlus Desktop is independent of WhatsApp
and Meta.

### Messenger

The entry URL is `https://www.facebook.com/messages/`. Normal Facebook login and
same-origin security checkpoints stay within that exact origin. The normal
WebView2 identity and isolated service profile are retained.

The dedicated DOM adapter reports unknown. Browser notification arrivals supply
unread and native delivery; Facebook navigation badges, contact labels, title
counts and missing/filtered lists are not message evidence. Counts, conversation
correlation and current/all read actions are unavailable.

This is a whole-origin Facebook session: navigation and browser notifications can
include non-Messenger Facebook content. ChatPlus cannot reliably classify every
event as a Messenger message. Provider-side notification categories remain under
the user's control. No contacts, history, profile data or hidden API is scraped.
The integration remains Experimental. ChatPlus Desktop is independent of Messenger
and Meta.

### Mattermost

Mattermost requires an explicit server URL and uses its normal Web login in an
isolated profile. Standard browser `Notification` events pass through the shared
native bridge, validated against that instance's exact configured origin and live
session. Notification support does not install a Mattermost DOM adapter: no chat
content, sidebar labels or hidden store is inspected. Browser arrivals can latch
native unread; aggregate counts, provider-wide zero, exact conversation mapping
and current-conversation read actions remain unavailable. **Mark all as read
(local)** explicitly clears only that instance's ChatPlus state, without changing
Mattermost's server state. Later arrivals restore unread. ChatPlus theme CSS is
not injected.

Browser permission, ChatPlus global delivery, the instance's notification toggle
and Mattermost's own **Desktop and mobile notifications** preference must allow
delivery. Existing saved mute preferences remain unchanged. Use the rail menu's
**More > Allow provider notifications** for the exact instance, then reload if
Mattermost still shows a cached permission prompt. HTTPS is recommended; browser
security requirements can prevent notifications on insecure servers. Provider
policies and external SSO can also limit embedded login. See Mattermost's
[Web notification requirements](https://docs.mattermost.com/end-user-guide/preferences/manage-your-web-notifications)
and [troubleshooting guide](https://docs.mattermost.com/end-user-guide/preferences/troubleshoot-notifications).

### Slack

Slack accepts a workspace URL and uses normal Web login in an isolated profile.
It has no unread or native notification adapter and does not inherit ChatPlus
selectors or theme CSS. Provider policies and external SSO can limit embedded login.

## Migration

Legacy schema 0 plus `serverUrl` produces one deterministic `chatplus` service and
saves schema 1. Migration is idempotent and preserves preferences. `serverUrl`
remains a compatibility mirror; service configuration is authoritative.

An invalid active ID selects the first enabled service; no enabled service means
no active session. Invalid stored service configuration is retained on disk while
the legacy URL is used in memory. A failed migration write restores the old store
record, runs the migrated in-memory configuration and retries at next startup.

## Adding a provider

1. Establish its public UI, notification and read semantics independently.
2. Add matching Rust/TypeScript registry entries, accurate capability/status flags,
   a strict origin policy and a stable-ID profile. Do not grant remote Tauri IPC.
3. Implement a dedicated adapter's snapshot, observer and scoped read/view methods.
   Missing identity or incomplete layout must remain unknown. Keep shared lifecycle
   and native state policy outside provider selectors.
4. Expose read actions only with safe provider-specific evidence or a bounded,
   explicit public UI operation. Label local acknowledgements honestly. Do not
   mass-click conversations, scrape content or invoke private APIs.
5. Cover origins, multiple instances, partial/virtualized DOM, background arrivals,
   trusted versus synthetic input, stale generations, read races and cleanup.
6. Validate login/session persistence, native notifications, routing and supported
   read actions on Windows. Keep accounts, QR/session secrets and private content
   out of the repository, diagnostics and test artifacts.

## Bundled artwork

Provider icons in `public/providers` and `src-tauri/icons/providers` are bundled
locally; runtime UI does not hotlink them. Third-party marks identify their
providers and are not licensed as project code. Original asset sources, usage
terms and non-affiliation notices are retained in [NOTICE](../NOTICE).
