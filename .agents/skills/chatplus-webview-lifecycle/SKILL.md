---
name: chatplus-webview-lifecycle
description: Change or profile ChatPlus Desktop native WebView sessions, service startup, background workers or resource cleanup. Use for this repository's Tauri lifecycle and performance work.
---

Read `docs/ARCHITECTURE.md` and `docs/SERVICE_STARTUP.md` from the repository root,
then inspect `src-tauri/src/services.rs`, `state.rs` and `window.rs` for the affected
transition. Use the current implementation rather than assuming Tauri's ordinary
single-WebviewWindow model.

The main native window hosts the local `main` rail and `service-<id>` child views.
Use `get_window("main")` for the host. Service ID is persistent profile identity;
provider plus URL additionally define the live session. Renaming or reordering
must preserve profiles. Removing a service closes the view and retains its disk
profile. The migrated `chatplus` service keeps its legacy default store.

Creation reserves identity and a generation ticket before UI dispatch. Revalidate
late load callbacks and completion against that ticket; an old callback must not
close a replacement using the same native label. Do not await child creation or
UI callbacks while holding the lifecycle transition lock. UI callbacks use
nonblocking validation where a worker can need the UI. Capture guarded state,
unlock, then perform deferred projection.

The selected service loads first; other enabled services load sequentially in
saved rail order. Hidden services intentionally stay alive for notifications and
unread observations. Background initialization must not change selection, focus,
settings or unread. Shutdown wakes and stops the startup worker. A memory change
that unloads hidden sessions needs evidence that these contracts still hold.

For Windows process measurements, distinguish the native host, browser,
renderer, GPU and utility processes. Task Manager's grouped rows do not establish
a unique-memory total. Compare the same build mode, WebView2 runtime, profiles,
services, warm-up and foreground state. Record private bytes and working set with
their limits; do not add nested group totals or call summed working set unique
memory. Keep raw measurements and machine/account details outside the checkout.
Preserve session isolation, TLS and GPU acceleration while investigating changes;
do not infer that profiles can share browser environments from process names.
Use `docs/PERFORMANCE.md` and `scripts/profile-process-tree.ps1` for reproducible
attach-only observations; keep unknown workload declarations unset.

Run focused native regressions with:

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml services::removal_tests
```

Use `docs/TESTING.md` for other affected suites. Validate actual focus, background
notifications, account isolation and session persistence through
`docs/WINDOWS_ACCEPTANCE.md`; model tests alone cannot establish those outcomes.
Report observed process/operation changes separately from unmeasured whole-app
performance claims.
