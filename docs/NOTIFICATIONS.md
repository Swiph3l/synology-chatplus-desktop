# Notifications and unread

Synology ChatPlus, Synology Chat and Discord have supported Windows unread and
native browser-notification integration. Slack and Mattermost capabilities remain
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

Selection, restore, child focus, toast activation, header/sidebar clicks, synthetic
input, stale generations, unrelated conversation activity and background badge
disappearance do not acknowledge unread. A send action cannot clear another unread
conversation/service. Tests cover new arrivals racing proof queries and foreground
changes. [TESTING.md](TESTING.md#notification-transition-matrix) maps cases A-K.

## Provider adapters

| Provider          | Unread inputs                                                                                      | Read context                                                                                                       | Exact toast suppression                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Synology ChatPlus | Independently audited aggregate sidebar tab indicators                                             | Unique main latest native scroller and mapped message-create textarea                                              | No audited event-tag mapping; actual browser events conservatively deliver |
| Synology Chat     | Ordinary-unread channel highlights plus complete group metadata; mention-only zero is insufficient | #channels route, visible message panel, transformed FleXcroll content end/newest control and sibling main composer | No audited event-tag mapping; titles/senders are insufficient              |
| Discord           | Guild/folder/Favorites and DM semantics; complete aggregate metadata before zero                   | Matching route, unobscured latest viewport and mapped editor; history/error bars block proof                       | Exact visible message row matching notification snowflake                  |

Discord Home promotions and guild hover/selection pills are not reliable unread.
Mention-only DM groups, selected/muted rows, missing private-sidebar metadata and
message-request/spam scope can be unknown. Synology server versions may change markup.
Keep these constraints explicit. [PROVIDERS.md](PROVIDERS.md) retains audited source
references and capability differences. DOM unread mutations never synthesize toasts.

## Native toast policy

Enable global Desktop notifications and the service's saved Desktop notifications
preference. The rail mute/unmute controls this desktop preference independently from
provider-side mute. Existing false preferences remain false after upgrade. Provider
notification settings, Discord DND and Windows permissions can prevent delivery;
ChatPlus cannot intercept an event the provider never emits.

On supported WebView2 versions, NotificationReceived is intercepted, its source
validated and duplicate browser display suppressed before native submission. Selected
service alone cannot suppress a toast. Foreground suppression additionally requires
reliable originating-message viewing proof, revalidated after the asynchronous query.
Unknown identity, failed renderer queries/timeouts and background/minimize allow
delivery. Distinct messages with identical previews remain separate events. Only
exact repeated event identities are deduplicated; conversation cooldown no longer
silences legitimate consecutive messages. The legacy saved cooldown field remains
for profile compatibility but does not control delivery.

Preview modes are Full, Sender/chat (default) and Generic. Notification content is
used only for requested display and is not logged/persisted. Failed submissions
release delivery reservations for retry. Native WebView2 completion stays on its
owning apartment, and callback/timeout/error races cannot complete the same event
twice. No background push runs after the application exits.

## Toast activation

Activation uses the existing process and main window, shows it if hidden, unminimizes,
brings it foreground/focuses it and selects the originating enabled service. It never
creates another window/process or clears unread merely by activation. There is no
reliable destination mapping across all providers, so it does not guess conversation
routes from arbitrary tags/titles. Actual foreground read evidence clears afterward.

## Privacy-safe diagnostics

About's existing **Copy diagnostics** includes a bounded in-memory history of 128
notification transitions. Event types include notification_arrival, unread_latched,
read_candidate/read_accepted/read_rejected, unread_cleared, toast_submitted,
toast_suppressed and toast_activated. Metadata is allowlisted: service/provider,
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

Submission success does not prove a visible banner: Windows Do Not Disturb may keep
it in Notification Center. Follow the exact provider, multi-service, activation,
mute/privacy/permission and attachment cases in
[WINDOWS_ACCEPTANCE.md](WINDOWS_ACCEPTANCE.md#current-reliability-pass-2026-10-07).
All authenticated acceptance for this revision remains pending until actually run.

Historical investigations remain available: [beta.4 reliability](BETA4_RELIABILITY.md),
[minimized notification review](MINIMIZED_NOTIFICATION_REVIEW.md) and
[maintainer follow-up](MAINTAINER_FOLLOWUP.md). They describe their original revisions,
including former exact-tag limitations, rather than current intended behavior.
