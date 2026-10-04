# Minimized active-conversation notification review — 2026-10-04

Scope: User A's conversation stays open in the selected service while the entire
ChatPlus main window is minimized; User A sends a new message. The same checks
also cover a different selected service. No UI, updater, dependency or version
work is part of this repair. Source was already beta.4 at baseline `8e171aa`;
this review leaves that existing identity unchanged.

## 1. Is the exact scenario fixed: YES or NO?

**NO as an established end-to-end Windows fix.** Authenticated provider emission,
real Windows banner display and real toast activation have not been exercised.
Current ChatPlus upstream eligibility is unaudited, and Synology Chat's compiled
server notification gate remains unknown. A bridge cannot deliver an event the
provider never emits. This report does not replace these checks with unit tests.

**YES for the inspected native handling of a received, trusted browser event**,
when the configured service/global notification preferences and Windows permission
allow delivery. A selected, logically focused User A view cannot override native
minimize state: the event latches service unread, a background provider zero cannot
clear it, and it is eligible for native toast submission. Successful submission is
separate from Windows actually displaying a banner.

The pre-repair ChatPlus adapter also had a concrete public API gap. It received
native foreground for ChatPlus's own read guard but left the provider-facing
`document.hasFocus()`, `document.hidden` and `visibilityState` at raw child-WebView
values. This repair corrects those public values before provider scripts run and
on native transitions. Whether the current vendor uses them for all notification
decisions still requires an authenticated test.

## 2. Which code previously erased unread?

At `9416477`, `src/theme/unread.ts` used
`setTimeout(confirmCleared, 250)`. `confirmCleared()` published
`hasUnread=false` whenever the tab indicators were absent, without a native
visibility check or a genuine conversation gesture. `src-tauri/src/unread.rs`
`publish_for()` directly stored that false value. Provider auto-removal of a badge
could therefore remove desktop unread while minimized.

Commit `dc38f81` had already removed that behavior before this review. At the
current baseline `8e171aa`, native-arrival ownership and genuine read/current
generation guards were also present. The new repair addresses the remaining
ChatPlus provider-facing visibility gap; it does not pretend the old timer still
existed at baseline.

## 3. Which code previously suppressed notifications?

Earlier `desktop_notifications::deliver_for()` suppressed the selected foreground
service without identifying the relevant conversation. A navigation `active_after`
two-second gate and title/body/tag deduplication could additionally discard real
messages. Those policies were already replaced in earlier notification commits.
The old native predicate already checked minimize; inspection does not establish
that it itself suppressed an established minimized conversation.

At `283b9fb`, Synology Chat and Discord notification/unread capabilities were
disabled. ChatPlus cache guards alone did not correct stale public provider focus;
Discord's audited public focus path could suppress browser-event creation. The
existing dedicated Synology Chat visibility and Discord focus projections address
their audited public predicates. ChatPlus lacked such a projection at `8e171aa`.
No current live ChatPlus/server emission root cause is asserted without evidence.

## 4–5. Main-window state and distinct read evidence

- `src-tauri/src/window.rs`: `is_foreground()` reads the actual `main` Window's
  focus, visibility and minimized state. `foreground_state()` requires all three.
  `WindowEvent::Resized`, `Focused`, close-to-tray and restore paths call
  `unread::sync_presentation()`.
- `src-tauri/src/unread.rs`: `sync_presentation()` projects selected **and native
  foreground** to each service. `actively_viewed()` / `viewing_evidence_current()`
  recheck native state independently of the renderer's potentially stale answer.
  `publish_for()` / `read_acknowledged()` recheck it again before accepting read.
- `src/theme/provider-unread.ts`: `visible()` combines that projection with public
  document visibility/focus. `interact()` requires trusted conversation input;
  `report()` additionally requires matching conversation/content at latest.
- `src/theme/providers/chatplus.ts`: new `projectHostPresentation()` and
  `onHostForegroundChanged` correct public focus/visibility without inventing raw
  browser focus. Background focus/visibility events cannot reactivate the provider;
  teardown restores only owned overrides. Unsupported properties roll back safely.
- `src/theme/providers/synology-chat.ts`: existing native visibility projection.
  `src/theme/providers/discord.ts`: existing native public focus projection.

Relevant current logic, with surrounding checks omitted only for clarity:

```rust
// window::foreground_state
focused && visible && !minimized

// unread::actively_viewed
let foreground = settings.active_service.as_deref() == Some(id)
    && crate::window::is_foreground(app);

// unread::viewing_evidence_current
provider_viewed && foreground
    && tracking.foreground_service.as_deref() == Some(id)
    && generation == tracking.visibility_generation
```

```typescript
// provider-unread::visible / genuineRead
foreground && document.visibilityState === "visible" && document.hasFocus();

visible() &&
  interaction !== null &&
  adapter.readContext() === interaction &&
  content !== null &&
  interactionContent === content;

// ChatPlus public projection
const hidden = () => foreground !== true || !browserVisible();
const hasFocus = () => !hidden() && browserHasFocus();
```

Selected service is configuration; raw WebView focus is a child browser fact;
foreground ChatPlus is a native-window fact; genuinely read conversation is a
provider-specific, latest-content/trusted-input fact. None substitutes for another.

## 6–7. What can and cannot clear unread?

A genuine trusted pointer/click/key/scroll gesture inside the proven latest
conversation may produce read evidence while the main app is foreground. Native
acceptance additionally requires the current generation, originating provider,
exact completed arrival proofs and reliable aggregate provider zero. Pending or
unproven native arrivals retain unread. Exact partial reads can progress while
another conversation stays unread; unknown aggregate UI cannot become global zero.

Selection, raw WebView focus, showing/restoring the app, toast activation,
sidebar/header clicks, automatic badge disappearance, synthetic input, title
changes and delayed/stale acknowledgements cannot clear cached unread. Removing a
service removes its state as an explicit configuration action. App restart
reobserves provider state; it is not a read acknowledgement.

**Known read-clear limit:** Synology native tags still lack an audited exact map,
so native-arrival unread can remain after genuine reading until restart. Incomplete
Discord navigation can also retain unread. This is a conservative false positive,
not verified automatic read-clear parity.

## 8. Exact regression and provider matrix

`tests/minimized-notification.test.mjs` runs the complete production IIFE and the
actual provider adapters against independently authored fixtures. Each provider's
User A pane is proven at latest before minimizing, stays the same pane and raw
browser focus stays true. New message/unread, automatic badge removal, queued
trusted input, stale foreground projection, restore-only and fresh exact Discord
read are exercised. There are three cases per provider: selected/minimized,
another-selected/minimized, and another-selected/foreground.

| Provider          | Selected while minimized | Dot persists (native cache)        | Windows toast                                      | Another service selected      |
| ----------------- | ------------------------ | ---------------------------------- | -------------------------------------------------- | ----------------------------- |
| Synology ChatPlus | YES — regression PASS    | Policy PASS; live REQUIRED/PENDING | Submission eligibility PASS; live REQUIRED/PENDING | Regression PASS; live PENDING |
| Synology Chat     | YES — regression PASS    | Policy PASS; live REQUIRED/PENDING | Submission eligibility PASS; live REQUIRED/PENDING | Regression PASS; live PENDING |
| Discord           | YES — regression PASS    | Policy PASS; live REQUIRED/PENDING | Submission eligibility PASS; live REQUIRED/PENDING | Regression PASS; live PENDING |

Native regressions are named
`selected_user_a_or_other_service_minimized_latches_native_unread_for_all_three_providers`
and
`selected_user_a_or_other_service_minimized_native_event_is_toast_eligible_for_all_three_providers`.
They combine the actual native foreground predicate, stale renderer "viewed=true",
event ownership, read rejection and notification policy for both selections. The
activation destination regression also covers all three providers and both selections.

The new full-bootstrap regression fails **3 ChatPlus cases** with only the
pre-repair `8e171aa` ChatPlus adapter substituted; Synology Chat/Discord's six cases
pass. With the repair, all **9** pass. This establishes the public API gap and its
repair, not a live vendor notification predicate. Reproduction output is in
`Workspace/notification-minimized-review/pre-repair.log` outside Git.

**Automated tests PASSED:** 163 frontend tests, zero failed/skipped; locked Rust
debug and release each 107 passed, zero failed and one expected production artifact
signature fixture ignored. TypeScript checking passes. Native test output is in
`Workspace/beta4-validation/cargo-test-minimized-debug.log` and
`cargo-test-minimized-release.log`; frontend output is in
`Workspace/notification-minimized-review/frontend-tests.log`.

**Code review PASSED** for the bounded native policy and public projection repair.
**Manual Windows acceptance PENDING** remains separate from those checks.

## Toast click and required manual acceptance

`desktop_notifications::show()` dispatches WinRT activation onto the existing
application UI thread. `window::activate_notification()` calls `open()` / `focus()`
to unminimize, show and focus the existing main window, then activates the enabled
origin service. It does not create a second process/window or acknowledge unread.

Repeat the exact six-step User A scenario for each provider with notifications
enabled at service, provider and Windows levels. Confirm the provider actually
emits a browser event, Windows displays a native banner, the service cache/dot
persists through provider badge changes and the notification click restores the
existing window and originating service. Repeat with another service selected,
then foreground and genuinely read. Record any sticky unread separately. All
these real Windows results remain **PENDING**.
