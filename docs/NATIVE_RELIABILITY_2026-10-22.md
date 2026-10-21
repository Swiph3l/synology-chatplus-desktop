# Native unread and notification audit — 2026-10-22

This records the native behavior inspected before this milestone's changes.

- `unread::Service` owns a mutex-protected map keyed by stable service ID. The
  sidebar mirrors revisioned snapshots; tray/title/taskbar derive from the same
  map. A browser notification immediately latches unread and reserves a bounded
  arrival token before the asynchronous renderer viewing query completes.
- A service switch, window restore, focus change, or toast activation projects
  foreground/visibility generations into each renderer. None directly clears the
  native store. New arrivals revoke previous conversation gestures.
- The renderer observes provider DOM, accepts trusted foreground conversation
  interactions, and returns exact arrival proofs. Native receipt revalidates the
  active service and presentation generation. Stale, background, and pending
  arrival proofs cannot clear unread. Toast submission, duplicate suppression,
  activation, and dismissal are separate from unread ownership.
- A `provider-zero` proof currently allows a conversation gesture plus the
  adapter's claimed provider-wide empty snapshot to drain every completed
  arrival. The native boundary therefore depends on that global DOM claim being
  complete. Discord's global-zero proof needs scrutiny: virtualized or missing
  guild/channel evidence must not become global read.
- DOM counts are currently discarded in `notification_bridge::parse_unread`,
  and snapshots expose only a boolean plus source/timestamps/generation. They do
  not expose provider certainty, conversation evidence, or provider revision.
- Windows permission is already queried through WinRT
  `ToastNotificationManager::CreateToastNotifierWithId(...).Setting()` using the
  same AUMID as `tauri-winrt-notification`. Browser `Notification.permission` is
  diagnostic only. WebView2 handles browser notification receipt, suppresses the
  browser duplicate, and routes native delivery through the central coordinator.
- The Settings enable action currently replaces the preference checkbox with
  `result.granted`, and sets it false on request errors. Saving afterwards can
  unintentionally disable a previously saved preference despite the independent
  native/browser permission paths. Preference and runtime capability must remain
  separate.
- No explicit user-facing local mark-all acknowledgement exists at this point.
  Explicit local acknowledgement must be scoped to one stable service ID, record
  that remote read state is unconfirmed, and prevent delayed callbacks from
  resurrecting already acknowledged arrival tokens.

The invariants for the changes are `notification lifecycle != unread lifecycle`
and `service activation != mark all read`.

## Implemented native changes

- Native snapshots now preserve provider certainty, reliable optional totals,
  the last provider revision, current conversation evidence, and bounded
  conversation observations. Missing DOM publishes unknown evidence and retains
  cached unread. Conversation identifiers become per-runtime opaque hashes before
  entering native snapshots, and are scoped by stable service ID. Diagnostic
  history contains typed reasons, never message content or conversation IDs.
- An explicit local mark-all action acknowledges one service through its latest
  arrival token, including delayed queries and saturated history. It records
  unknown remote certainty and `locallyAcknowledged`, suppresses identical stale
  provider evidence, and permits new incoming events or changed unread evidence
  to latch again. Changing the selected conversation or observer revision alone
  does not restore an acknowledged badge. WhatsApp global read remains unsupported.
- Windows continues to use WinRT permission as authoritative. Native permission
  transitions and native-granted/browser-denied mismatches have typed diagnostics.
  Settings preserves saved intent through denial/request errors, and permission
  responses expose the authority and latest native send success/failure. An
  unavailable native permission query retains the existing attempt-send behavior;
  that state is reported as unavailable rather than a confirmed native grant.
- Both ordinary native sends and explicit test sends record their actual outcome.
  Toast lifecycle and foreground projection still never clear unread.

Focused Settings verification passed 49 tests, including the native/browser
permission mismatch and saved-preference preservation cases. Native regression
tests cover explicit all-local isolation, delayed callbacks, overflow recovery,
unknown/count evidence, opaque conversation identity, and exact provider/source
matching including WhatsApp. Full validation results are recorded in the final
milestone report.

## Follow-up: embedded provider permission recovery

The user's authenticated WhatsApp screenshot showed its notification permission
recovery prompt directing them to the browser's lock/address-bar controls, which
ChatPlus does not expose. This is a provider browser-origin permission failure,
independent of a saved notification preference or Windows native permission.

The existing WebView2 `PermissionRequested` handler denied requests while global
notifications, the service preference, or native access were unavailable. Those
decisions previously used the default persistent behavior. Microsoft documents
that event permission decisions are saved in the profile by default, so a
temporary application setting could leave a permanent browser-origin denial:
[WebView2 permission persistence](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2permissionrequestedeventargs3).
Automatic denials are now transient. The explicit native service-menu permission
action repairs an existing denial only for the clicked stable instance's isolated
profile and exact configured origin. It validates the configured provider, current
top-level source and native bridge generation before the grant and after its
completion. No profile files, global preferences, or mute settings are rewritten.
A scoped browser-permission query records granted/reload-required diagnostics;
reload may be required for a provider's cached permission UI.

The WebView2 notification event currently used by ChatPlus covers non-persistent
DOM `Notification()` events. Microsoft explicitly documents this boundary:
[WebView2 NotificationReceived](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_24).
It does not establish support for persistent service-worker notifications. The
permission fix removes the screenshot's denial blocker, but actual WhatsApp
delivery still needs an authorized message test after granting permission. No
message/contact scraping or guessed internal API is added as a fallback.
