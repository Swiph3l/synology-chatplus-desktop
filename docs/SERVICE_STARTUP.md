# Automatic service startup

## Queue behavior

ChatPlus opens the saved selected service immediately, then starts other enabled
configured services sequentially in saved rail order. Existing sessions are
reused. One background worker starts the next view after the previous document
finishes loading, with a minimum 750 ms between starts. An eight-second limit lets
the queue pass an offline server or an unfinished login page. Network activity
may continue afterward; the queue does not wait for network idle.

Each step reads the current configuration. Disabled and removed services are
skipped, manually opened views are reused, and a changed provider or URL gets a
new session identity. A failed attempt is not retried continuously by the same
queue; opening that service remains a way to retry.

## Presentation and identity contract

Background views start unfocused outside the client area and are hidden before
returning to normal bounds. Layout skips a reserved view until that initial hide
is complete. Background startup does not select a service, write preferences,
reorder the rail, acknowledge unread or manufacture notifications. Normal provider
notification and permission policies still apply.

Stable service IDs determine profile directories. Session identity additionally
includes provider and URL, and each creation has a generation ticket. Late load
callbacks and completions must validate that ticket before changing a current
view. A stale completion must not close a newer view that reused the same native
label.

Clicking a service during creation defers that explicit presentation request.
Completion checks the current identity and selected service; deferred focus is
allowed only while ChatPlus is still foreground. The queue never focuses a
service after the user switches away or leaves the application.

## Concurrency and shutdown

`src-tauri/src/services.rs` owns the lifecycle transition lock, queue state,
generation tickets and wakeup condition. Native creation reserves the stable
label, then releases lifecycle locks before waiting for UI work. Completion
revalidates identity before presentation. UI callbacks use nonblocking validation
when another transition may need the UI; native work must not be awaited while
holding a lock that the UI needs.

`window::open` starts the queue after initial window setup. Configuration
reconciliation wakes or restarts it as needed. Shutdown marks the queue stopped
and wakes the waiting worker without blocking on the lifecycle transition lock;
no subsequent queue step is scheduled. An in-flight native creation is revalidated
before it can be presented.

## Validation

Native model tests in `services::removal_tests` cover saved order, selected-service
preservation, disabled accounts, profile identities, load completion/timeout,
configuration changes, manual activation, stale callbacks, failed attempts,
shutdown wakeup and offscreen staging.

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml services::removal_tests
```

Actual Windows acceptance must also check focus, paint, login behavior and
background notifications. Follow [WINDOWS_ACCEPTANCE.md](WINDOWS_ACCEPTANCE.md);
model tests do not establish those visual or provider results.
