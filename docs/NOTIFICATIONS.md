# Notifications and unread

Synology ChatPlus, Synology Chat and Discord have supported Windows unread and
native browser-notification integration. WhatsApp adds an Experimental dedicated
positive-evidence unread adapter and the shared native notification path; authenticated
Windows acceptance remains pending. Messenger adds Experimental browser-event
unread/native notifications on Facebook's messages page, while its dedicated DOM
adapter remains unknown pending authenticated audit. Slack and Mattermost capabilities remain
disabled. Automated fixture results and live Windows acceptance are separate.

## Authoritative unread model

Rust owns per-service hasUnread, optional count, transition generation, source,
lastArrival and lastReadEvidence. Provider DOM observations are validated inputs.
The local rail consumes a whole revisioned services/aggregate snapshot and rejects
older revisions. Native presentation applies the current snapshot on the UI thread
at execution time so interleaved callbacks cannot restore stale indicators. Title,
taskbar and tray use the same enabled-service aggregate:

```text
aggregateUnread = any(enabledService.hasUnread)
```

No separate sidebar/tray unread truth is stored. Native toast submission does not
define unread; the arrival is latched first even if delivery is muted or Windows
refuses a banner. Clearing one service immediately recomputes aggregate and leaves
other services untouched. Optional presentation preferences can hide a title/tray
indicator without changing unread state. Counts are unavailable when providers expose
only mentions, ambiguous or partial navigation.

Unread is memory-only. Restart reobserves providers and does not replay old toasts.
Service removal, disable or provider/URL replacement invalidates that service's
observation; reload keeps its cached state until fresh reliable evidence is accepted.

## Arrival and native foreground

An accepted browser notification goes through exact source-origin/service validation,
event identity deduplication, unread latch, shared presentation refresh and native
toast policy. Distinct arrivals invalidate earlier gestures and advance arrival state.
Loaded/selected conversations cannot acknowledge an arrival by themselves.

Native foreground means **visible && focused && !minimized** on the top-level main
window, plus selected service for read/suppression context. Child WebView focus,
document.hasFocus(), document.visibilityState and provider selection are insufficient.
A selected conversation can remain logically focused while the host is minimized:
its unread and aggregate stay true, and a native toast remains eligible.

The native visibility generation is projected into provider public browser APIs:
ChatPlus focus/visibility, Synology Chat visibility and Discord focus. This prevents
upstream read/focus handlers treating a background child as active. The projection
uses each provider's independently audited public behavior, respects browser-owned
nonconfigurable properties and later overrides, and uses no private store/API.

## Read acknowledgement

An acknowledgement requires all of these together:

- Current native foreground generation and the correct selected enabled service.
- A genuine trusted conversation or mapped active-composer interaction.
- The same uniquely identified active conversation and a visible latest message pane.
- Fresh reliable provider aggregate zero, or exact individually viewed message proof.

Trusted clicks, keyboard/input and foreground scrolling in the pane/composer can
supply read evidence. Typing/sending through the mapped main composer is engagement
with that conversation; it is not rejected merely because the composer is a sibling
of the message pane. Reliable provider aggregate zero plus that fresh engagement can
retire completed native arrivals **without exact notification-tag mapping**. This
removes the former permanent Synology read barrier. Pending arrivals cannot clear early; their native completion can retry the same
still-current trusted proof. Fresh content/route/pane changes revoke earlier
evidence; no timer hides unread.

A positive/unknown provider aggregate remains unread. Exact per-message proofs can
retire the proven subset (Discord message snowflakes) while other unread remains.
Only native-confirmed evidence is retired. Arrival proof history is bounded to 256;
a current proven provider zero can recover saturation without clearing a newer
pending arrival. Missing/ambiguous provider zero is never
guessed, so incomplete provider navigation can still retain a dot.

Selection, restore, child focus, toast activation/dismissal, header/sidebar clicks, synthetic
input, stale generations, unrelated conversation activity and background badge
disappearance do not acknowledge unread. A send action cannot clear another unread
conversation/service. Child-document blur/focus and visibility loss revoke old
conversation gestures even when the native window remains foreground. A covered
Discord notification row is not accepted as exact viewing evidence.
Tests cover new arrivals racing proof queries and foreground
changes. [TESTING.md](TESTING.md#notification-transition-matrix) maps cases A-K.

## Provider adapters

| Provider                 | Unread inputs                                                                                                                                 | Read context                                                                                                       | Exact toast suppression                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Synology ChatPlus        | Independently audited aggregate sidebar tab indicators                                                                                        | Unique main latest native scroller and mapped message-create textarea                                              | No audited event-tag mapping; actual browser events conservatively deliver  |
| Synology Chat            | Ordinary-unread channel highlights plus complete group metadata; mention-only zero is insufficient                                            | #channels route, visible message panel, transformed FleXcroll content end/newest control and sibling main composer | No audited event-tag mapping; titles/senders are insufficient               |
| Discord                  | Guild/folder/Favorites and DM semantics; complete aggregate metadata before zero                                                              | Matching route, unobscured latest viewport and mapped editor; history/error bars block proof                       | Exact visible message row matching notification snowflake                   |
| WhatsApp (Experimental)  | Explicit positive unread badges/accessibility labels in visible chat-list rows; missing/partial DOM stays unknown and counts stay unavailable | No authenticated privacy-safe chat/message mapping yet; current/all read actions disabled                          | No guessed tag/title matching; actual browser events conservatively deliver |
| Messenger (Experimental) | Native browser-notification arrivals only; unaudited DOM, Facebook navigation badges and title counts remain unknown                          | No current-chat mapping; current/all read actions disabled                                                         | No guessed tag/title matching; actual browser events conservatively deliver |

Discord Home promotions and guild hover/selection pills are not reliable unread.
Mention-only DM groups, selected/muted rows, missing private-sidebar metadata and
message-request/spam scope can be unknown. Synology server versions may change markup.
Keep these constraints explicit. [PROVIDERS.md](PROVIDERS.md) retains audited source
references and capability differences. DOM unread mutations never synthesize toasts.

### Discord DMs and mentions

Use Discord's own notification preferences to prioritize direct messages and mentions.
Keep **User Settings > Notifications > Enable Desktop Notifications** enabled, and
leave the desired DM conversations unmuted. For each server, open **Notification
Settings** and choose **Only @mentions**. Check channel/category overrides too:
an explicit **All Messages** override can still notify for every message. Set those
overrides to mentions or inherit the server preference as appropriate. Discord's
[desktop notification guide](https://discord.com/blog/how-to-manage-your-discord-desktop-notifications)
and [server/channel settings](https://support.discord.com/hc/en-us/articles/215253258-Notifications-Settings-101)
describe these controls. ChatPlus does not change them automatically.

If unwanted server activity remains, review **Suppress Highlights**, event alerts
and the optional role/@everyone/@here suppression controls. Highlights operate
independently of the server's message-notification level, so mentions-only does not
disable them. See [Discord's Highlights documentation](https://support.discord.com/hc/en-us/articles/5304469213079-Highlights-Notifications).
Keep ChatPlus's global and per-service notification preferences enabled and saved;
existing mute and privacy choices remain in force.

The native toast retains the sender/conversation title supplied by Discord. Its
public message-notification formatter includes channel/thread or group-DM context
where available; direct DMs use the sender. **Full** additionally shows the provider's
message excerpt, while **Sender/chat** hides the body and **Generic** hides the
sender/conversation. The service attribution identifies the configured Discord
instance. Missing names or locations are not recovered by scraping message content.
[PROVIDERS.md](PROVIDERS.md#discord) records the public-source audit.

ChatPlus does not add a strict DM/mention filter. Discord's browser notification
payload does not expose a reliable universal category: its message tag identifies
a message, not its channel or mention status. The DOM adapter can recognize an exact
message only when it is actually rendered in the current conversation. Classifying
every other event from titles, sidebar badges or the selected route could discard
real DMs, so unknown events remain eligible under the existing notification policy.

WhatsApp uses the official `web.whatsapp.com` session with a separate profile per
stable service ID. It never scrapes contacts/phone numbers or uses private APIs.
Unread badge absence never establishes account-wide zero, including filtered,
archived, collapsed and virtualized lists. A validated toast click selects the correct
instance without acknowledging unread or guessing a chat; authenticated originating
chat routing and remote read UI semantics remain unverified. See the
[WhatsApp audit](WHATSAPP_2026-10-22.md) for evidence and remaining QA.

Messenger uses the exact `www.facebook.com` origin for official login and messages,
with an isolated profile per stable service ID. It is a whole Facebook-origin
session, so same-origin navigation or browser events can include non-Messenger
Facebook content/notifications. The adapter never scans contact labels or treats
Facebook navigation badges as message unread. Configure Facebook's own notification
categories as needed. [Messenger audit](MESSENGER_2026-10-22.md) lists the current
browser-event-only support and pending authenticated acceptance.

## Native toast policy

Enable global Desktop notifications and the service's saved Desktop notifications
preference. The rail mute/unmute controls this desktop preference independently from
provider-side mute. Existing false preferences remain false after upgrade. Provider
notification settings, Discord DND and Windows permissions can prevent delivery;
ChatPlus cannot intercept an event the provider never emits.

The service context menu offers `More… > Allow provider notifications` for the exact
clicked service instance. It grants browser permission to that instance's validated
live origin/profile; reload the service if the provider retains old permission
guidance. Saved desktop notification and mute preferences still apply, along with
Windows permission. The action does not acknowledge unread. Automatic browser
permission handling must not persist a denial merely because desktop delivery is
disabled or muted; these are separate states.

On supported WebView2 versions, NotificationReceived is intercepted, its source
validated and duplicate browser display suppressed before native submission. Selected
service alone cannot suppress a toast. Foreground suppression additionally requires
reliable originating-message viewing proof, revalidated after the asynchronous query.
Unknown identity, failed renderer queries/timeouts and background/minimize allow
delivery. Distinct messages with identical previews remain separate events. Only
exact repeated event identities are deduplicated; conversation cooldown no longer
silences legitimate consecutive messages. The legacy saved cooldown field remains
for profile compatibility but does not control delivery.

Windows provider WebViews retain the browser's native `Notification` API, which
feeds the WebView2 bridge. The Tauri notification plugin is registered only on
other platforms: its JavaScript polyfill would replace the browser constructor,
report a separate permission state and send provider notifications through Tauri
IPC, which is unavailable to remote provider pages. Windows desktop permission
checks and toast delivery use the native sender directly.

Preview modes are Full (default for new or unset preferences), Sender/chat and Generic. Saved
Sender/chat and Generic choices are retained; choose Full in desktop notification
settings to show the sender and message excerpt on an existing profile. Notification content is
used only for requested display and is not logged/persisted. Failed submissions
release delivery reservations for retry. Native WebView2 completion stays on its
owning apartment, and callback/timeout/error races cannot complete the same event
twice. No background push runs after the application exits.
Provider `IsSilent` also disables sound; enabling application sound cannot override
a provider's silent notification. Bridge availability and source-session identity
are tracked per service, so a stale WebView callback cannot publish into its replacement.

Windows toasts show the provider icon framed in the service's saved RGB color.
Full preview keeps the provider's sender/chat title and a message excerpt of at
most 240 Unicode characters. Sender/chat hides the message body; Generic also
hides the sender and custom service name, showing only the provider identity.
Full and Sender/chat include the configured service name and provider below the
preview. Named colors and Auto remain supported; Auto follows the app accent.
The local `notification-icons` cache stores provider/color PNG artwork only, with
no message text, service names, URLs or credentials. The explicit test notification
uses the active service's icon/color and fixed sample text without changing unread.

## Explicit service read actions

Right-clicking a service icon opens its native context menu using the clicked
stable service ID, without activating it. Open, mute/unmute and service settings
stay at the top, with Remove separated below. `More…` groups supported read actions,
provider permission repair and desktop notification settings. Rename remains
available in service settings. Unsupported read actions are omitted.
`More… > Mark as read (local)` is available for
Discord only when the currently rendered conversation has fresh exact message
viewing evidence; it acknowledges only those proven arrivals in that service.
Synology current-conversation actions stay unavailable because no audited exact
message mapping is available. Synology's `Mark all as read (local)` acknowledges
known local state for that clicked instance without claiming a server-side read.
Its local baseline prevents unchanged provider markup from immediately restoring
the same dot; a new native arrival or changed provider evidence can restore unread.

Discord instead offers `Mark Inbox as read`. A background task opens the provider's
public Inbox, selects Unreads and clicks its uniquely identified **Mark Inbox As
Read** control. This requests Discord's real read operation through its own UI;
no token, private API or internal store is used. Discord documents this Inbox scope
as unread messages in unmuted channels plus direct/group direct messages; it does
not promise to include every muted channel. See the official
[Inbox FAQ](https://support.discord.com/hc/en-us/articles/360045027712-Inbox-FAQ).
ChatPlus acknowledges only its captured pre-action arrivals after the same scoped
control is disabled and fresh complete provider evidence confirms zero unread. It
preserves newer arrivals or changed positive provider
evidence. A provider confirmation stays visible for the user. Ambiguous controls,
an unchanged action, renderer timeout or a switched/reconfigured service produce
guidance without clearing that captured local state. The task has a bounded wait
and never waits on the native menu thread. Current live DOM acceptance remains
pending; tests cover conservative control selection and failure paths.

WhatsApp and Messenger current/all actions are hidden until a safe Web UI interaction is
verified. No provider mass-click loop or hidden internal API is used. Activating a
service, focusing the app, clicking a toast or dismissing a toast is never an
implicit `Mark all as read` action.

## Toast activation

Activation uses the existing process and main window, shows it if hidden, unminimizes,
brings it foreground/focuses it and selects the originating enabled service. It never
creates another window/process. Clicking a toast, dismissing it, letting it time out
or restoring a window never acknowledges unread. The clicked arrival and unrelated
messages remain unread until the normal provider/view proof or an explicit supported
read action is accepted. After restore,
the retained originating WebView notification receives `ReportClicked` on its COM
apartment, allowing the provider's own click handler to route the conversation.
No route is guessed from tags/titles. The bounded activation history retains 256
contexts; evicted or replaced-source contexts are ignored without opening another
account or changing unread. Calling the provider's click handler is routing, not
evidence that a message was read. Closed-process activation still
requires Windows acceptance; this change handles the running application.

## Privacy-safe diagnostics

About's existing **Copy diagnostics** includes a bounded in-memory history of 128
notification transitions. Event types include detected, normalized, duplicate_suppressed,
notification_arrival, unread_latched,
read_candidate/read_accepted/read_rejected, unread_cleared, toast_submitted,
toast_suppressed, toast_activated and provider_activated. Metadata is allowlisted: service/provider,
native foreground, selected state, generation, fixed reason code and timestamp. Copy diagnostics appends the safe
JSON event history; typed events/reasons prevent arbitrary content entering it.
Message bodies, credentials/tokens, private URLs, event tags and conversation content
are excluded. History is not a disk log and disappears at exit.

For bug reports, include copied diagnostics, app/Windows/WebView2 versions, provider
version, whether the app was foreground/background/minimized/hidden, selected service,
exact safe steps and which indicators disagreed. Do not include private conversation
content, credentials, profile directories or signed attachment URLs.

## Test notification and acceptance

Settings > Notifications > **Send test notification** checks platform permission and
sends fixed application text without altering unread. Save feedback does not send a
toast. **Enable notifications** can request platform permission and enable the selected
supported origin on capable WebView2 versions; save the preference for incoming toasts.
It cannot bypass Windows policy. **Open Windows notification settings** opens
ms-settings:notifications when access is blocked/unavailable. Settings rechecks access
when focused. The sound option applies immediately to the test.

Windows development/debug builds use the registered Windows PowerShell notification
sender because their executable has no installer-created shortcut/AUMID registration.
Windows displays a Windows PowerShell sender header with the ChatPlus Desktop title;
permission checks and delivery use this same development sender. Installed release
builds retain ChatPlus Desktop's own identifier and sender. This development fallback
does not change Windows notification settings or register another application.

Submission success does not prove a visible banner: Windows Do Not Disturb may keep
it in Notification Center. Follow the exact provider, multi-service, activation,
mute/privacy/permission and attachment cases in
[WINDOWS_ACCEPTANCE.md](WINDOWS_ACCEPTANCE.md#current-reliability-pass-2026-10-07).
All authenticated acceptance for this revision remains pending until actually run.

Historical investigations remain available: [beta.4 reliability](BETA4_RELIABILITY.md),
[minimized notification review](MINIMIZED_NOTIFICATION_REVIEW.md) and
[maintainer follow-up](MAINTAINER_FOLLOWUP.md). They describe their original revisions,
including former exact-tag limitations, rather than current intended behavior.
