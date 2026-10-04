# Notifications and unread testing

## Test notification

Open Settings > Notifications and choose **Send test notification**. No incoming
message, unread count or enabled background-notification preference is required.
The button checks permission and requests it when the platform supports a prompt.
Windows also checks whether notifications are enabled for this application.

The permission status distinguishes Windows access from `Notification.permission`
in a provider WebView. **Enable notifications** requests platform permission and,
on supported Windows WebView2 versions, explicitly enables notifications for the
selected supported service's configured origin. Save the preference to enable incoming desktop toasts.
It does not change Windows policy. When Windows access is blocked or unavailable,
**Open Windows notification settings** opens `ms-settings:notifications`.
The status is checked again when Settings regains focus.

The test sends only:

> ChatPlus Desktop — Notifications are working.

The sound checkbox applies immediately to this test. Other preference changes use
Save. Clicking a toast restores/focuses the running application. Windows may retain
notifications in Notification Center without a banner when Do Not Disturb is active;
a successful submission does not prove that a banner appeared.

## Incoming messages

ChatPlus, Synology Chat and Discord have native unread/browser-notification
capabilities enabled. Slack and Mattermost do not. Enable global Desktop
notifications, enable Desktop notifications for the desired service in Services,
choose a preview mode, and save. Existing saved disabled service preferences stay
disabled after upgrade; explicitly enable previously disabled Synology Chat/Discord
services. The rail's per-service mute/unmute changes that desktop preference without
changing the provider's own mute settings or marking messages read.

Enable message/desktop notifications in the provider itself as needed. Provider-side
mute, Discord DND and notification preferences can prevent browser events from being
emitted; the host cannot intercept an event that never occurs. Full preview shows the supplied title
and body; Sender/chat only omits the body; Generic uses fixed application text.
The default is Sender/chat only. Notification contents are not logged or persisted.

On supported Windows WebView2 runtimes the shell handles the browser's
NotificationReceived event. It validates the configured service's origin and
suppresses the WebView's duplicate display before submitting one native notification.
Only notification permission requests for that origin can use the explicit saved
preference. Camera and microphone permissions retain their normal behavior.

Suppression requires the selected service, a visible/non-minimized main window that
is actually foreground, and reliable provider evidence that this notification's
conversation/message is currently being viewed at latest. WebView focus and native
foreground alone are insufficient. The native callback revalidates service/visibility
generation after querying the provider; missing identity, failed queries and timeouts
allow delivery. ChatPlus and Synology Chat currently have no verified notification-tag
mapping and conservatively deliver actual browser events in foreground. Discord can
match its message-snowflake tag to an actual visible current-channel message row.
Background events retain bounded tag/arrival identity for a later trusted foreground
read retry. Each gesture recomputes exact current-message proofs; native foreground
and generation validation confirms only the accepted subset before the renderer
retires its tags. Rejected queries or gestures cannot leave reusable read proof.

Other activated services can notify while the main window is foreground; the selected
service can notify while ChatPlus is minimized, hidden or backgrounded. A trusted live
browser notification is not dropped merely because it arrived shortly after navigation
or startup. Unread observations and document-title changes never generate toasts.
Background push while
the application is completely closed is not implemented. Unsupported runtimes do
not gain a second native delivery path.

## Provider-specific unread and read evidence

Each adapter publishes boolean unread independently for its service. Exact counts
are unavailable; the title uses a dot and tray/taskbar use cached unread icons.
Mention counters, duplicate navigation groups and virtualized rows do not establish
a total across hidden/muted conversations. Missing, incomplete and ambiguous UI
keeps the last observation. Other platforms currently have no native unread bridge.

| Provider          | Unread source                                                                                                                   | Read/latest evidence                                                                                                    | Notification matching                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Synology ChatPlus | Audited sidebar tab indicators (`sidebar-tab-item-*` / `tab-item-indicator`)                                                    | Actual visible conversation scroller at bottom plus trusted conversation input                                          | Unknown: no verified notification-tag/conversation mapping                                    |
| Synology Chat     | Independent channel highlights/mention highlights and group number classes from Chat templates                                  | Current `#channels/<id>` pane, visible transformed content end and explicitly hidden newest-message control             | Unknown: audited browser events have no conversation tag                                      |
| Discord           | Guild/folder/Favorites and DM markers; complete guild and private-sidebar metadata with unambiguous DM state before global zero | Matching route/message rows, visible unobscured scroller at latest, no history/error bar, trusted viewport/editor input | Exact message snowflake in a visible current-channel row; unknown tags/titles do not suppress |

Flashing titles can reset on focus without reading and are not unread/read evidence.
Provider selection, showing a WebView, header/sidebar clicks and toast activation
do not acknowledge cached unread. Empty provider evidence must match a real trusted
conversation interaction and the current native foreground generation. New incoming
messages invalidate earlier gestures; changed routes/content and scrolled-up/covered
panes cannot reuse an old read context. Duplicate mutations are coalesced and unchanged
observations are deduplicated; those lifecycle guards do not invent read state.

Native incoming sequences also record the current conversation-content context.
An empty pane cannot acknowledge an unverified native arrival, including after the
asynchronous native view query has completed. Only exact originating-message view
proof can release that native read barrier. Avatar changes, older-message insertion,
pane replacement and route changes cannot prove the unseen event read. ChatPlus and
Synology Chat event tags remain unverified, so cached native-arrival unread can stay
after reading until restart reobserves provider state. This candidate read-clear
limitation favors retaining a dot over silently erasing an unseen arrival; live
clearing behavior remains a manual acceptance gate.

Exact individual native-message reads can progress while another message remains
unread or the provider aggregate is unknown. Positive aggregates keep unread while
reporting the proven subset. An unknown aggregate uses a proof-only packet, which
cannot replace its unread boolean with zero. Clearing the service indicator still
requires known provider zero, current trusted conversation input, no unproven
observed native arrival and an unsaturated retained history. Missing projections,
unmatched events and failed native validation preserve unread.

Discord guild hover/selection shares its unread-pill appearance. Selected/hovered
collapsed folders, incomplete guild/private-sidebar metadata, ambiguous media labels
and a DM-only account without guild aggregate metadata therefore remain unknown.
An empty unread-DM group cannot prove zero: it and private-row pills use mention
counts, which can omit ordinary unread in muted DMs. Selected/hovered private rows
can hide their muted styling, and ordinary rows exclude message requests/spam.
Absent private sidebar while reading another guild, a request/spam row, or special
rows without complete position metadata also remain unknown. A cached dot can remain
after reading until stronger provider evidence is available. This conservative
limitation is covered by adapter tests and still requires live acceptance.

Discord's audited public blur handler requires `document.hasFocus()` to become false,
while its focus handler always marks focused. Windows can keep WebView logical focus
while the main host is minimized. Its adapter floors that public browser result by
native foreground and sends public blur/focus on host transitions, blocking misleading
background focus. Same-value native generation updates do not repeatedly refocus the
provider. No private Discord store/webpack APIs or DOM-generated toast fallback are used.

Synology Chat's audited ActiveDetector uses public document visibility to enable its
session/read updater, and LastViewAtUpdater uses that active state at the conversation
bottom. Its adapter projects native foreground into public `document.hidden` and
`visibilityState`, emitting visibility changes only when effective state changes.
This prevents logically visible background/minimized WebViews from enabling upstream
read activity. The compiled server's active-session notification-creation decision
remains unverified; this workaround is not proof of live/native toast delivery.

See [provider sources and constraints](PROVIDERS.md#unread-and-notification-capabilities).
Authenticated incoming-message/read transitions, native delivery and toast activation
still require the end-to-end checks below; automated fixtures do not establish live success.

## Safe end-to-end procedure

Use dedicated private test conversations and controlled second test accounts for
ChatPlus, Synology Chat and Discord. Send from those accounts while the desktop
account is foreground, backgrounded, minimized and hidden in the tray. Alternatively,
use a supported provider integration restricted to a private test conversation. Keep its secret URL
outside Git, screenshots and logs. Never automate messages to real users.

1. Send the local test notification; check both its banner and click-to-focus behavior.
2. Send one new private-channel message; expect at most one native notification.
3. Repeat with notifications disabled and each privacy mode; inspect visible content.
4. For each provider, repeat foreground/background/minimized with the receiving service
   selected and with another service selected. Focus/service selection alone must not
   acknowledge cached unread; interact with the relevant conversation at latest.
5. Keep two providers unread simultaneously, read one and confirm the other's dot remains.
6. Click an inactive provider's toast; verify restore/unminimize/focus of the same process
   and source-service selection, without guessing conversation navigation.
7. Test service mute, duplicate native event replay and consecutive distinct messages
   with identical previews; use No cooldown to isolate deduplication from delivery policy.
8. Restart with unread messages: indicators should restore without replaying old toasts.
9. Verify system-denied permission, notification sound off and Do Not Disturb behavior.

Live unread/event tests and native visual checks are distinct from unit tests of
formatting, origin validation and notification policy.

## Multi-service lifecycle

ChatPlus, Synology Chat and Discord enable separate native unread/notification adapters. Events validate their
own service's origin and current enabled/capability preferences. Previously activated
inactive views can notify; never-activated views cannot. Toast clicks select the
source service after restoring/showing/unminimizing/focusing the existing main window on its UI
thread. Activation targets the running process and window. The browser tag has no
verified safe conversation-navigation mapping for all supported providers, so the host
selects the originating service without deriving a conversation route. Test toasts
restore the active service. Activation itself never marks read.

Retained native event identities remain in memory independently of conversation cooldown
and include service identity. Deduplication happens before a repeated event can seed
unread again or revoke a genuine read acknowledgement. Distinct messages with identical content are eligible
for delivery. The configurable conversation cooldown remains intentional delivery
policy; use No cooldown to check legitimate repeated messages. Navigation retains
cached unread. Failed native submissions release their delivery reservations so a
retry is possible.

Title/tray/taskbar aggregate enabled services' cached boolean observations; rail dots
are per service. Clearing one service cannot clear another. Removing, disabling or
changing a service invalidates its observation. Reload keeps it until the sidebar
reports again. Startup restores state from the sidebar, not persisted desktop counts.

Repeat the checklist with multiple supported services, switching while Settings/About are
open. Include inactive delivery/click routing, cooldown zero, reconnect/startup,
privacy, denied permission, sound off and Do Not Disturb. These native scenarios
were not manually validated in the 2026-10-01 pass.

All authenticated beta.4 foreground, background, minimized, unread-persistence,
Windows-toast and toast-click checks remain **pending manual acceptance** for all
three target providers. See the current beta.4 matrix in [Windows acceptance](WINDOWS_ACCEPTANCE.md).
Historical observed/synthetic results in that report retain their original scope.
