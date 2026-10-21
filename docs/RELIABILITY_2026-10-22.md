# Reliability and providers milestone — 22 October 2026

No version, release, tag or remote push is part of this work. The working version
remains `0.5.0-beta.6`.

## Audit and implementation

The pre-change transitions were recorded before implementation in the
[native audit](NATIVE_RELIABILITY_2026-10-22.md),
[read lifecycle audit](READ_ACTIONS_2026-10-22.md),
[theme audit](THEME_RELIABILITY_2026-10-22.md), and
[WhatsApp audit](WHATSAPP_2026-10-22.md).

1. **White/light message highlight.** The user supplied a concrete screenshot of
   the pale incoming-message row. Provider static CSS defines a three-second
   `jump-highlight` animation using an EOS theme-light fill, whose unoverridden
   light value is `#ecf3fc`. The dark theme now supplies `#20344f` with matching
   hover/active/foreground tokens while preserving the provider's highlight/fade.
   Installed Edge checked the actual animation at 0/2250/2750/3000 ms and Light
   restoration in a synthetic fixture. Separate gaps included duplicate
   bootstrap lifecycles, transient loading/edit surfaces and the uncolored native
   child frame before a document exists. Authenticated frame-by-frame visual
   acceptance remains separate from this source diagnosis.
2. **Theme files.** `src/theme/bootstrap.ts`, `src/theme/dark.css`,
   `src-tauri/src/services.rs`, `src-tauri/src/window.rs`, and
   `tests/theme.test.mjs`. Styles remain persistent across provider mutations;
   Dark/Light/System and provider opt-in scoping are preserved.
3. **Windows permission.** WinRT permission for the actual toast sender is
   authoritative. Cached browser denial no longer changes saved user intent.
   Native authority, browser mismatch and send outcomes are diagnostic metadata.
   The later WhatsApp screenshot also exposed a browser-origin permission problem:
   embedded views have no address-bar lock button. An explicit per-service grant
   and transient automatic denial address that separate permission layer. Previous
   delivery-policy refusals used WebView2's persistent-default permission setting;
   temporarily muting the app could therefore leave an origin denied afterward.
4. **Notification architecture.** One native store remains authoritative per
   stable service ID; rail/tray/title consume its revisioned snapshots. Provider
   certainty, revision, optional reliable totals and opaque scoped evidence are
   retained. Arrival precedes toast policy. Toast submission, click, dismissal,
   service selection and focus do not acknowledge unread.
5. **Discord global-clear path.** Selected/hovered guild accessible-name equality
   could produce a false global zero, allowing a current-conversation gesture to
   drain unrelated arrivals. That branch now remains unknown. There was no direct
   `activate_service -> clear all` call. Reproducing the original symptom against
   an authenticated account is still pending.
6. **Discord current read.** Explicit local acknowledgement requires the selected
   foreground instance, a stable latest route/viewport and exact visible message
   arrival matches. It cannot expand into provider-zero scope or clear an
   unrelated channel/thread. Aggregate-only or unmapped arrivals remain unread.
7. **Discord all read.** A deliberate local action retires that instance's known
   arrivals, including pending/overflow history. It does not claim a remote read
   operation. The unchanged provider observation stays locally acknowledged;
   missing DOM preserves that baseline, and new arrivals restore unread.
8. **Service menus.** Native menus target the clicked stable ID and revalidate
   current capabilities. Current read is available for Discord's safe exact
   proofs; Synology current read remains disabled without audited mapping.
   Local all-read is available for Synology and Discord. WhatsApp/Messenger read
   operations stay disabled. The browser-notification permission action targets
   the chosen instance's configured origin independently of saved mute/global
   desktop preferences.
9. **WhatsApp provider.** Experimental `whatsapp` loads official
   `https://web.whatsapp.com/` in an isolated ordinary WebView2 session. Registry,
   bundled official artwork, ordering, custom names/colors, mute, settings and
   seven locales use the existing multi-instance architecture.
10. **Login/session evidence.** The Windows test build reached QR and phone-number
    pairing UI without UA spoofing. The user later supplied an authenticated
    WhatsApp screen and reported the permission prompt. No pairing credentials,
    QR payloads or account contents were collected by the implementation. Linked
    session persistence after authenticated reload/restart/logout remains pending.
11. **WhatsApp unread.** Dedicated positive badge/accessibility evidence yields a
    boolean. Partial/virtualized/filtered/archived/missing UI is unknown, never
    global read; visible row numbers are not invented aggregate message totals.
12. **WhatsApp notifications.** Browser events route through the native
    coordinator with exact-origin validation, duplicate suppression, saved preview
    policy and instance routing. The explicit permission repair is required when
    the browser profile previously cached denied. Actual post-repair incoming
    message/toast acceptance still requires the user's paired session. WebView2's
    current `NotificationReceived` event covers non-persistent DOM notifications;
    support for a provider's persistent/service-worker path is not established.
13. **WhatsApp read capabilities.** Current/all remain explicitly unsupported
    until safe official UI operations and current-chat correlation are verified.
    No mass-clicking, private APIs or false remote-read success is implemented.
14. **Multiple instances.** IDs scope profiles, unread, evidence hashes, delivery
    identity, activation and permission grants. The Windows process inspection
    confirmed distinct WebView2 user-data arguments for the two WhatsApp test
    IDs. Authenticated cross-restart session isolation is still a manual check.
15. **Automated validation.** Final command results are recorded below after the
    final provider/theme/permission changes. Existing updater-signature acceptance
    is intentionally ignored by the normal unit suite because it needs a signed
    production artifact; no test is weakened to conceal a failure.
16. **Windows QA.** An isolated debug build with production assets was built and
    launched under a distinct application ID. Official WhatsApp pairing UI and
    two profile arguments were observed. A local synthetic ChatPlus view also
    rendered with the native dark background. Native context-menu input was not
    fully verified: the helper reported unavailable geometry/input interruption.
    No authenticated notification, channel-read or no-flash pass is claimed.
17. **Limits.** Local acknowledgement is not server read state. Discord current
    read requires mapped retained notifications. Provider DOM may change. Native
    permission-query unavailability remains an attempt-send capability, not a
    confirmed grant. A working build does not prove Windows banner presentation
    or complete authenticated provider behavior.
18. **Experimental status.** WhatsApp and Messenger should remain Experimental
    until their authenticated Windows acceptance matrix is completed.

## Follow-up requests

- Rail reordering now arms after exactly 1 second of holding an icon, with updated
  hints in all seven locales. Regression coverage checks 999/1000 ms, click
  suppression, cancellation, drift and bounded scrolling. All 335 frontend tests,
  typecheck and formatting passed again. The updated local no-bundle build for
  this later change is `src-tauri/target/debug/chatplus-desktop.exe`, using the
  same isolated QA identifier/profile. Exit the running optimized instance before
  opening it so single-instance activation does not restore the older build.
- Messenger was requested during implementation. Its provider uses current
  official Meta web UI at `https://www.facebook.com/messages/`, separate stable
  profiles and the same conservative unread/notification boundaries. Its adapter
  remains unknown without an authenticated DOM audit; browser events can latch
  unread, while generic Facebook badges cannot. The exact Facebook origin also
  hosts non-Messenger features, so its browser notifications are not guaranteed to
  represent Messenger messages exclusively. No unofficial messaging API is added.
- WhatsApp's iPhone pre-link confirmation still shows Microsoft Edge. A follow-up
  [public-code and offline-parser investigation](WHATSAPP_BRANDING_2026-10-22.md)
  found a fixed browser-platform mapping; an intact Edge UA with a ChatPlus product
  suffix still yields Edge. No supported custom application-name channel was
  demonstrated. The normal runtime identity is preserved; this remains unresolved.
- For the permission prompt shown by the user: after running the updated build,
  open the affected service, right-click its icon, select **Allow provider
  notifications**, and reload that service if its UI still caches denied. The
  global desktop preference, per-service mute and Windows settings still control
  actual delivery. Granting browser permission never silently rewrites them.

## Final validation

| Check                                                                 | Result                                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `npm run format:check`                                                | Passed                                                           |
| `npm run typecheck`                                                   | Passed                                                           |
| `npm test`                                                            | 335 passed, 0 failed                                             |
| Repeated frontend notification/unread/provider/theme suites           | 150 passed, 0 failed                                             |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`           | Passed                                                           |
| `cargo check --manifest-path src-tauri/Cargo.toml --locked`           | Passed                                                           |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked`            | 172 passed, 0 failed, 1 existing signed-artifact fixture ignored |
| Repeated native unread / notification suites                          | 31 / 36 passed, 0 failed                                         |
| `git diff --check`                                                    | Passed                                                           |
| `npm run check:release`                                               | Passed; production assets exclude the debug fixture              |
| Local Windows application build, production assets, no bundle/signing | Passed                                                           |

The final local executable is `src-tauri/target/release/chatplus-desktop.exe`,
built with the isolated `io.github.swiph3l.chatplus-desktop.reliability-20261022`
identifier. This is a local optimized test build, not a published release or tag.
It uses the same isolated profile as the earlier debug acceptance build. Exit that
running test instance before opening the new executable, otherwise the
single-instance guard correctly restores the existing process. The installed
normal application has its own identifier/profile.

Builds retain two pre-existing unused-function warnings in `updates.rs`.
Validation logs and synthetic theme animation evidence are outside Git under
`E:\chatplus_synology_client\validation\milestone-2026-10-22`.

## Manual acceptance still required

For authenticated Synology ChatPlus, Discord, WhatsApp and Messenger, exercise
foreground/background/minimized/tray-hidden arrival, toast click/dismissal,
service switching, instance isolation and supported explicit read actions.
Discord service selection must retain other channels/threads. After explicit
browser permission allowance, verify real WhatsApp messages and native toasts.
For Dark mode, inspect several incoming highlights, conversation/thread changes,
history loading, composer focus, edit and reaction/menu opening; then check Light
and System. Verify paired-session reload/restart/logout separately.
