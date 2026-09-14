# Notifications and unread testing

## Test notification

Open Settings > Notifications and choose **Send test notification**. No incoming
message, unread count or enabled background-notification preference is required.
The button checks permission and requests it when the platform supports a prompt.
Windows also checks whether notifications are enabled for this application.

The permission status distinguishes Windows access from `Notification.permission`
in the ChatPlus WebView. **Enable notifications** requests platform permission and,
on supported Windows WebView2 versions, explicitly enables notifications for the
configured server origin. Save the preference to enable incoming desktop toasts.
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

Enable Desktop notifications, choose a preview mode, and save. Enable message
notifications in ChatPlus itself as needed. Full preview shows the supplied title
and body; Sender/chat only omits the body; Generic uses fixed application text.
The default is Sender/chat only. Notification contents are not logged or persisted.

On supported Windows WebView2 runtimes the shell handles the browser's
NotificationReceived event. It validates the exact configured server origin and
suppresses the WebView's duplicate display before submitting one native notification.
Only notification permission requests for that origin can use the explicit saved
preference. Camera and microphone permissions retain their normal behavior.

The current policy suppresses incoming toasts while the main window is focused and
briefly during navigation/startup. Minimized, hidden or unfocused windows may receive
new events. Unread totals never generate toasts themselves. Background push while
the application is completely closed is not implemented. Unsupported runtimes do
not gain a second native delivery path.

The Windows unread adapter observes ChatPlus sidebar tab indicators
(`sidebar-tab-item-*` / `tab-item-indicator`) and publishes boolean state. It does
not count rendered rows or read message text. Counts are unavailable; the title
uses a dot and the tray/taskbar use cached unread icons. Missing sidebar UI keeps
the last observation rather than clearing it. This reflects the indicators exposed
by the current ChatPlus navigation, not a guaranteed total across hidden/muted
conversations. Other platforms currently have no native unread bridge.

ChatPlus's flashing document title contains notification previews and resets on
focus, so it is deliberately not an unread/read source. Focus alone never clears
the desktop state, and observing existing indicators does not generate toasts.
Real incoming-message/read transitions still require the end-to-end checks below.

## Safe end-to-end procedure

Use a dedicated private test channel and a second local Synology test user. Send
from that account while the desktop account is unfocused, minimized and hidden in
the tray. Alternatively, configure an incoming webhook using the server's supported
ChatPlus integration UI, restricted to the private test channel. Keep its secret URL
outside Git, screenshots and logs. Never automate messages to real users.

1. Send the local test notification; check both its banner and click-to-focus behavior.
2. Send one new private-channel message; expect at most one native notification.
3. Repeat with notifications disabled and each privacy mode; inspect visible content.
4. Verify unread changes for one/multiple messages and after ChatPlus marks them read.
   Merely focusing the app must not mark all conversations read.
5. Restart with unread messages: indicators should restore without replaying old toasts.
6. Verify system-denied permission, notification sound off and Do Not Disturb behavior.

Live unread/event tests and native visual checks are distinct from unit tests of
formatting, origin validation and notification policy.
