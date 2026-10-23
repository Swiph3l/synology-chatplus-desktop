# Notifications and unread

Notification delivery and unread are separate lifecycles. An incoming event can
remain unread when its toast is muted, suppressed or rejected by Windows. Service
selection, focus, toast clicks and toast dismissal never acknowledge unread.

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
- Genuine trusted interaction in the uniquely mapped conversation or main composer.
- The same conversation/content identity and a visible latest message pane.
- Fresh reliable provider-wide zero or an exact individually viewed message proof.

Clicks, keyboard/input and foreground scrolling can supply engagement. A mapped
main composer may be a sibling of the message pane; unrelated thread/edit/search
inputs cannot acknowledge that pane. Route/content changes, blur, visibility loss
and newer arrivals revoke stale gestures. Header/sidebar clicks and synthetic
input are insufficient.

Reliable provider zero with fresh engagement can retire completed arrivals without
an exact notification tag. In-flight arrivals cannot clear early; native completion
may retry a still-current proof. Exact Discord message proofs can retire a subset
while unrelated or unknown unread remains. Only native-confirmed proofs retire
renderer tokens. Proof history is bounded to 256 arrivals; saturation stays unread
until reliable provider-zero evidence permits recovery.

Focus, restore, selection, toast activation/dismissal, elapsed time and background
badge disappearance never substitute for this evidence. Loading older history or
changing unrelated content cannot prove a new arrival was read. An unobscured
visible message must match its exact identity; a covered or offscreen row does not.

## Explicit service read actions

The service rail's native context menu targets the clicked stable ID. More groups
supported read actions, provider permission repair and notification settings.
Unsupported actions are omitted. Local acknowledgement is labelled **local** and
makes no server-side read claim.

| Provider                          | Mark current                                             | Mark all                                |
| --------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| Synology ChatPlus / Synology Chat | Unavailable without exact message mapping                | Local acknowledgement for that instance |
| Discord                           | Local acknowledgement of proven visible message arrivals | Bounded public Inbox action             |
| WhatsApp / Messenger              | Unavailable                                              | Unavailable                             |
| Mattermost                        | Unavailable                                              | Local acknowledgement for that instance |
| Slack                             | Unavailable                                              | Unavailable                             |

Discord current read additionally requires the service to be active in the native
foreground. It acknowledges only exact arrivals visible in that channel/thread;
other conversations and service instances remain unread.

Synology local all-read records a baseline so unchanged provider markup does not
immediately restore the same dot. New native arrivals or changed provider evidence
can restore unread. Configuration is revalidated before applying the action.

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

Toasts use bundled provider artwork framed in the saved notification color; Auto
follows the app accent. The `notification-icons` cache contains provider/color PNG
artwork only, without names, URLs, credentials or message text. Notification
content is bounded in memory for display and routing, never logged or persisted.

### Discord categories

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

Real arrivals can latch unread. There is no Mattermost DOM adapter or verified
conversation/read proof, so counts, aggregate zero, foreground conversation
suppression and current-conversation acknowledgement are unavailable. **Mark all
as read (local)** clears only the clicked instance's captured native unread;
later arrivals remain eligible and restore the dot. This does not mark Mattermost
messages read on the server. Toast clicks and dismissal remain unrelated to unread
acknowledgement.

## Toast activation

A retained, validated toast click restores the existing main window and selects
the originating enabled service. It does not create another desktop instance or
acknowledge any unread arrival. Dismissal, timeout and window restore also leave
unread unchanged.

On the owning COM apartment, the retained native browser notification receives
`ReportClicked`, allowing the provider's own handler to route its conversation.
ChatPlus never guesses a URL from notification tags or titles. Routing is not read
evidence. Activation history retains 256 contexts; missing, evicted, removed,
reconfigured or replaced-source contexts are ignored without opening a different
account. Closed-process activation depends on Windows registration and is separate
from this running-process path.

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
