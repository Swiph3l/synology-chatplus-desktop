# Notifications and unread

Notification delivery and unread are separate lifecycles. An incoming event can
remain unread when its toast is muted, suppressed or rejected by Windows. Discord's
dot is DM-only and uses scoped DOM evidence; unclassified browser events still
deliver toasts without owning that dot. Service selection, focus, toast clicks and
toast dismissal never acknowledge unread.

Provider coverage and origin rules are in [Service providers](PROVIDERS.md).

## Authoritative unread model

Rust owns one state per stable service ID: unread boolean, optional count,
certainty (`known-unread`, `known-read`, `unknown`), provider revision,
conversation evidence, arrival/read generations and the local-acknowledgement
baseline. Conversation identities are opaque runtime values, not names, URLs,
phone numbers or message content.

The rail, title, taskbar and tray derive from the same revisioned native snapshot:

```text
aggregateUnread = any(enabledService.hasUnread)
```

Local views reject older snapshots; native presentation reads current state when
its UI-thread callback executes. Hiding an indicator does not alter unread.
Counts remain unavailable when evidence represents mentions, duplicated rows or
partial navigation. Unknown input retains cached unread instead of inventing zero.

Unread is memory-only. Restart reobserves providers without replaying old toasts.
Reload retains cached state until fresh evidence is accepted. Removing, disabling
or replacing a service's provider/URL invalidates its observation and source
session without changing other instances.

## Arrival and native foreground

The Windows path is:

```text
browser Notification -> validated WebView2 event -> exact event deduplication
  -> native unread latch -> shared presentation -> native toast policy
```

Source validation binds the event to an enabled configured service, exact origin
and live bridge session. Distinct arrivals revoke earlier gestures and advance
arrival state before toast policy runs. DOM unread changes never create message
payloads or synthetic toasts.

Read and suppression context requires the main window to be visible, focused and
not minimized, with the originating service selected. Child focus or public
`document.hasFocus()` / `visibilityState` alone is insufficient. Provider-specific
adapters project native foreground through public focus/visibility APIs so hidden
or minimized children cannot appear active upstream. No private provider store is
used. See [Service startup](SERVICE_STARTUP.md) for background view lifetime.

## Read acknowledgement

Automatic acknowledgement requires all of:

- The current native foreground generation and correct selected enabled service.
- Genuine trusted interaction in the uniquely mapped conversation/main composer,
  or a bounded native Discord toast intent with exact target-message view proof.
- The same conversation/content identity and a visible latest message pane, or
  Mattermost's verified complete read state with a visible mapped pane.
- Fresh reliable provider-wide zero, an exact individually viewed message proof,
  or Discord's validated read evidence for one previously observed unread DM.

Clicks, keyboard/input and foreground scrolling can supply engagement. A mapped
main composer may be a sibling of the message pane; unrelated thread/edit/search
inputs cannot acknowledge that pane. Route/content changes, blur, visibility loss
and newer arrivals revoke stale gestures. Header/sidebar clicks and synthetic
input are insufficient. A Discord toast intent is scoped to its exact message tag
and native generation/arrival boundary. It can acknowledge only after that target
is actually visible, unobscured and latest in the mapped DM and the matching
conversation has read evidence. Merely clicking a toast supplies no read proof.
The intent expires after a bounded wait; its timer never acknowledges anything.

Reliable scoped provider zero with fresh engagement can retire completed arrivals
without an exact notification tag. In-flight arrivals cannot clear early; native
completion retries a still-current exact or zero proof. Observed navigation,
content replacement, scrolling away from latest, blur and new arrivals invalidate
the retry, including an observed departure followed by return to the same pane.

Native arrival tokens and retained positive provider evidence are separate. Exact
accepted reads can remove an arrival-only dot once all native work is complete,
while provider certainty remains unknown. A retained positive provider observation,
other unread arrivals, pending work or overflow still prevents that clear. Unknown
DOM alone never retires either kind of evidence. Proof history is bounded to 256
arrivals; saturation stays unread until reliable provider-zero evidence permits
recovery.

Focus, restore, selection, toast activation/dismissal, elapsed time and background
badge disappearance never substitute for this evidence. Loading older history or
changing unrelated content cannot prove a new arrival was read. An unobscured
visible message must match its exact identity; a covered or offscreen row does not.

## Explicit service read actions

The service rail's native context menu targets the clicked stable ID. Supported
all-read actions appear directly after Open; More groups current-conversation read,
provider permission repair and notification settings. Unsupported actions are
omitted. Local acknowledgement is labelled **local** and makes no server-side read
claim.

| Provider                          | Mark current                                             | Mark all                                |
| --------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| Synology ChatPlus / Synology Chat | Unavailable without exact message mapping                | Local acknowledgement for that instance |
| Discord                           | Local acknowledgement for a mapped, previously unread DM | Bounded public Inbox action             |
| WhatsApp / Messenger              | Unavailable                                              | Local acknowledgement for that instance |
| Mattermost                        | Unavailable                                              | Local acknowledgement for that instance |
| Slack                             | Unavailable                                              | Unavailable                             |

Discord current read requires the service to be active in the native foreground,
a stable visible latest DM pane and read evidence for the exact previously
observed unread conversation. An incomplete private list does not prevent that
scoped read. Other known unread DMs and unattributed positive evidence remain
latched; this does not assert account-wide zero. Guild/channel panes cannot
acknowledge the DM dot; other service instances remain independent.

Local all-read records a baseline so unchanged provider markup does not
immediately restore the same dot. It is available for Synology, WhatsApp, Messenger
and Mattermost without requiring a provider DOM read adapter. It changes only
ChatPlus state; provider messages remain unread on the server. New native arrivals
or changed provider evidence can restore unread. Configuration is revalidated
before applying the action.

Discord **Mark Inbox as read** opens its public Inbox, selects Unreads and clicks
only a uniquely identified scoped read-all control. It requests Discord's own read
operation without private APIs, stores or per-channel mass clicks. The Inbox covers
unmuted channels and direct/group direct messages; it does not promise every muted
channel. Provider confirmations remain for the user to accept.

The operation runs off the menu thread with a bounded wait and revalidates the
configured active service. A renamed/replaced/ambiguous control or visible error
fails closed. ChatPlus acknowledges the captured pre-action arrivals only after
the same control is disabled and fresh complete provider evidence confirms zero.
Newer arrivals and changed positive evidence survive. Unknown layouts, unchanged
controls and timeouts leave local unread intact and show provider instructions.

## Native toast policy

Incoming delivery requires the saved global Desktop notifications preference,
that service's saved preference, provider event emission, runtime capability and
Windows permission. Rail mute/unmute controls desktop delivery independently of
provider-side mute. Permission checks never rewrite saved preferences; existing
mute and preview choices survive upgrades.

Exact repeated browser-event identities are deduplicated. Different arrivals with
identical previews remain separate. Failed submissions release delivery
reservations for retry. The legacy cooldown preference is retained for profile
compatibility but does not silence consecutive messages.

Foreground suppression requires reliable proof that the originating message is
currently visible at latest. Native code revalidates context after the asynchronous
query. Unknown identity, failed queries, timeouts, background and minimized states
allow delivery. Provider silent notifications remain silent even when application
sound is enabled. Source-session checks reject callbacks from replaced views;
WebView2 completion occurs on its owning apartment, exactly once across callback,
timeout and error races.

Windows retains the browser's native `Notification` API. WebView2 intercepts the
event and suppresses its duplicate browser delivery while the coordinator handles
it. The Tauri notification plugin is registered only on other platforms: its
polyfill would require remote Tauri IPC and replace the provider's browser API.
No background notification service runs after the application exits.

### Permission sources

Windows native permission/runtime checks and the send result are authoritative
for desktop delivery. `Notification.permission` describes browser-origin permission
and can be stale; it must not silently disable the user's saved desktop preference.

Settings captures the selected service's identity and bridge generation before a
permission query or grant. Discard delayed results after service configuration,
session or selection changes. Diagnostic outcomes distinguish browser `granted`,
`default`, `denied` and `unavailable` without logging script output. The provider's
own desktop-notification and streamer-mode preferences still determine whether it
creates a browser notification; hearing a message sound alone does not prove that.

Explicit provider grants record fixed request/failure outcomes only while the
captured service and bridge still match. Complete each native grant once, including
synchronous setup failure, and surface failures in Settings. A success message
requires both native access and browser permission; native access alone does not
resolve a provider page's denied permission.

**More > Allow provider notifications** grants only the clicked instance's
validated live origin in its own profile. Global/per-service desktop preferences
and Windows policy still apply; granting browser permission does not unmute the
service. A provider may need reload to refresh its permission UI. Automatic denials
caused by temporary delivery settings are not persisted as browser-origin denials.
Other permission kinds retain normal WebView policy.

### Preview and presentation

Full is the default for new or unset preferences; saved Sender/chat and Generic
choices are retained. Full shows the provider's sender/chat title and an excerpt
of at most 240 Unicode characters. Sender/chat hides the body. Generic also hides
the sender and custom service name, retaining provider identity. Missing sender or
conversation context is not recovered by scraping content.

Toasts use bundled provider artwork on a transparent background with a small
top-right dot in the saved notification color, matching the service rail; Auto
follows the app accent. A thin dark outline separates the dot from its icon without
a pale halo. The versioned `notification-icons` cache
contains provider/color PNG artwork only, without names, URLs, credentials or
message text. Existing cache files remain available for notifications already in
Action Center. Notification content is bounded in memory for display and routing,
never logged or persisted.

### Discord categories

The rail, title, tray and taskbar dot/count represent private-message unread only.
Dedicated DM badges and the ordinary private-channel list supply that state;
guilds, folders and Favorites cannot light it. The exact current latest DM can
resolve its own selected-row ambiguity. Native state retains observed positive
DM identities separately from unattributed positive evidence. A valid
`conversation-read` proof can retire only its matching known DM even when the
remaining list is virtualized or unknown; other observed DMs and unattributed
owners survive. Ownership is bounded, with overflow retained as unattributed.
Clearing requires trusted conversation input, the explicit current-read action,
or a native toast intent whose exact target has subsequently met view/read proof.
Other muted, incomplete or request/spam scopes remain unknown. Discord observations must carry
`unreadScope: "direct-messages"`; native parsing rejects legacy/global snapshots.

Raw browser events contain message IDs without a reliable DM category. They retain
routing and gesture generations but do not create unread tokens or pending-read
barriers for Discord. A DM acknowledgement cannot suppress an unrelated guild
toast. Exact visible-message matching still controls foreground toast suppression.
The public Inbox operation separately requires a complete provider-wide zero;
DM zero alone cannot confirm that guild messages were read.

Use Discord's own desktop notification preferences, server **Only @mentions**
setting and channel/category overrides to choose DM/mention delivery. Highlights,
event alerts, DND and mute can independently affect emission. ChatPlus does not
change these settings or invent a strict DM/mention filter: message tags identify
messages, not a universal event category. Unknown events remain eligible rather
than discarding real DMs based on titles, sidebar badges or selected routes.

WhatsApp has no exact chat/message correlation for foreground suppression.
Messenger browser events come from the whole Facebook origin and may include
non-messaging notifications; provider-side categories remain authoritative. See
[Provider adapter contracts](PROVIDERS.md#adapter-contracts).

### Mattermost

Mattermost uses standard browser notifications through the same origin- and
profile-scoped native bridge. Its own **Desktop and mobile notifications** setting
controls which activity produces browser events. Browser permission and ChatPlus
global/per-service delivery settings are separate requirements; enabling support
does not change a saved mute preference. An existing **Permission required** prompt
can be repaired with **More > Allow provider notifications** for that instance,
followed by reload if the provider caches its permission state. See
[Mattermost Web notification settings](https://docs.mattermost.com/end-user-guide/preferences/manage-your-web-notifications).

Real arrivals latch unread. Older releases, including 11.7.2, put the notification
body in `Notification.tag`, so tags cannot identify a post. Exact foreground toast
suppression and current-conversation acknowledgement remain unavailable. The
adapter instead checks documented same-origin read metadata after trusted
engagement in the mapped main conversation/composer.

Automatic verification currently requires the audited server version 11.7.2 and
an unlicensed deployment. The public client config/license must confirm this both
before and after the query. In that version unlicensed stores read the primary;
licensed servers may use lagging replicas, so matching counters alone cannot prove
that a new arrival was included. Other versions, missing license evidence or a
changed server configuration remain unknown and retain local all-read. See
[Mattermost store selection](https://github.com/mattermost/mattermost/blob/70c68d0cf6357e2b5c6b66bcc6ffc03bd13d1910/server/channels/store/sqlstore/store.go).

The verifier reads complete membership pages, then channel totals, comparing
all-message/root-message and mention counters. Separate team unread requests
include collapsed threads and cover both ordinary teams and the blank DM/group
team. Muted channels are not excluded from the raw comparison. Incomplete pages,
differing channel/membership sets (including archived memberships absent from the
live channel response), malformed counters, missing thread groups, auth failures
and timeouts stay unknown. Requests use the existing WebView session and exact
configured server base, including its subpath. They extract no token/cookie, use
no authorization header/private store/post-body endpoint and perform no server
mark-read action. Channel metadata is reduced to IDs/counters in memory and never
logged or persisted. Responses and pagination are bounded.

Only a complete, fresh zero can acknowledge completed native arrivals. Positive
or unavailable metadata does not manufacture initial unread or counts. Native
foreground/generation/arrival and route/content changes invalidate queries. Fresh
trusted conversation engagement is required; focus, service/toast selection and
mere metadata availability cannot mark messages read. A bounded retry may wait for
Mattermost's own read updater; a timer itself never clears unread. A server receipt
supplies read evidence rather than a physical-bottom guess over virtualized
history; receipts expire and native acceptance stops repeated queries until a new
arrival.

**Mark all as read (local)** remains available when verification cannot establish
zero. It clears only the clicked instance's captured ChatPlus unread; later arrivals
restore the dot. Neither this action nor verification marks messages read on the server.
Toast clicks/dismissal remain unrelated to unread acknowledgement.

## Toast activation

A retained, validated toast click restores the existing main window and selects
the originating enabled service. It does not create another desktop instance or
acknowledge any unread arrival. Dismissal, timeout and window restore also leave
unread unchanged.

On the owning COM apartment, the retained native browser notification receives
`ReportClicked` before native focus, allowing the provider's own handler to route
its conversation before focus can close that browser notification.
ChatPlus never guesses a URL from notification tags or titles. Routing is not read
evidence. Activation history retains 256 contexts; missing, evicted, removed,
reconfigured or replaced-source contexts are ignored without opening a different
account. Closed-process activation depends on Windows registration and is separate
from this running-process path.

The browser's public `CloseRequested` event withdraws only the corresponding
native toast and retires its activation context. Discord can replace an older
notification from the same conversation; a closed browser object must not leave a
dead entry in Action Center. Closing before asynchronous submission prevents that
submission. Retained native handles and activation contexts are bounded and scoped
to the exact service, browser event and generation. Provider closure, Windows
dismissal and expiry do not acknowledge unread. See
[WebView2 notification lifecycle](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2notification).

## Diagnostics and verification

About > Copy diagnostics includes a bounded in-memory history of 128 transitions.
Typed events and fixed reasons describe arrival, unread/read proof, suppression,
submission and activation. Metadata is limited to service/provider IDs, native
foreground, selection, generations and timestamps. Message content, tags,
credentials, tokens, private URLs and conversation contents are excluded. History
is not a disk log and disappears at exit.

For local native investigations, the opt-in Cargo feature
`notification-diagnostics` writes this typed metadata to bounded JSONL files under
`notification-logs` beside the executable. Build and run that QA executable outside
the source checkout. Its main title includes **Notification QA**. Ordinary builds
do not enable disk capture. The capture includes delivery/block reasons, not
message content or contact names. A successful toast submission means Windows
accepted the API call; confirm actual banner visibility separately.
Discord trusted input also records fixed `read_context_checked` outcomes:
unmapped conversation, unavailable latest view, or ready conversation. Scoped
acceptance uses `conversation_read`; provider-driven toast closure uses
`provider_closed`. No conversation IDs or tags enter these diagnostics.
Immediately before Windows submission, `presentation_checked` records the generic
OS interruption state: accepting notifications, busy, full-screen, presentation,
away, quiet time, an immersive app or unavailable. This is observational metadata;
it does not change delivery policy, prove the per-app banner setting or certify
that a banner appeared. Compare it for fixed tests and real provider events.
The QA build retains the normal application/profile identity for sender testing,
but does not repair Windows autostart registration or allow start-at-login changes.

Settings > Notifications > Send test notification checks platform access and sends
fixed sample text with the active service's icon/color, without altering unread.
Enable notifications can request platform access and grant the supported active
origin; it cannot bypass Windows policy. Save the delivery preference separately.
Opening Windows notification settings and refocusing Settings refreshes access.

Debug builds use the registered Windows PowerShell notification sender because
there is no installer-created application shortcut/AUMID. Installed release builds
use ChatPlus Desktop's identifier. Permission checks and sending use the same
sender within each build mode. A successful submission can appear only in
Notification Center when Windows suppresses banners.

Regression coverage must include foreground/background/minimized/tray-hidden
arrivals, mute and permission failures, duplicate identity, two same-provider
instances, exact current reads, provider-zero races, explicit all-read boundaries,
and toast clicks/dismissal leaving unread unchanged. Use native Windows checks for
actual banners, restore/routing and provider UI behavior; DOM fixtures alone do not
establish those outcomes. See [Development](DEVELOPMENT.md) for validation commands.
