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

## Session lifecycle and recovery

These states describe observable ownership and transitions. Selection, connection
and authentication are separate facts. A connected document can be a login page.

| State           | Entry, retained resources and exit                                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Not initialized | Configured service with no live child or creation reservation. Selecting it or reaching its background queue slot can start creation.                                                                                                                                                                        |
| Initializing    | Stable ID, provider, URL and a generation ticket are reserved. Native child creation and document navigation are separate operations. A load deadline advances the startup queue even if the provider is slow.                                                                                               |
| Active          | Selected child is shown. Native window foreground still gates read evidence. Reselecting the service reuses its child, and unchanged selection needs no settings write.                                                                                                                                      |
| Background      | The initialized child and its profile remain alive when another service is selected or the host is hidden. Normal switching does not reload it.                                                                                                                                                              |
| Recovering      | An eligible Windows failure has one pending retry. The timer retains metadata only and rechecks the current ticket and service on the UI thread. Navigation or successful completion invalidates pending work.                                                                                               |
| Failed          | Creation failure, exhausted retry budget or ineligible transport failure leaves the profile intact. The native connection state can indicate error/offline. A user can retry a navigation manually. Browser-process loss requires an app restart.                                                            |
| Disposed        | Removal, disablement or replacement closes the child, invalidates the ticket and purges unread and connection state. The per-ID profile stays on disk. Shutdown stops the startup worker. A committed document exit disposes adapter observers/listeners; a page saved in browser history retains its owner. |

Windows entry retries use a new GET to the configured URL, including the existing
Synology DSM launch query when applicable. Exact entry matching and top-level
navigation IDs protect a subsequent login, deep link or provider redirect.
Eligible failures are DNS, disconnect, timeout, refused/reset/unreachable transport
and HTTP 502–504. Authentication challenges, 4xx responses, canceled requests and
TLS failures require provider or user action. A main renderer exit can navigate
back to the configured entry for the current provider origin. The provider may
reopen a different conversation or lose an unsent draft after a crash. Subframe,
GPU and transient unresponsive reports do not trigger a full-page navigation.

The retry sequence waits 1, 2, 4 and 8 seconds with independently selected 0–500 ms
jitter on each attempt. Four automatic attempts exhaust a failure burst.
A successful document must remain connected for at least 60 seconds before
another failure can rearm the budget. Rapid successful loads followed by another
crash cannot sustain an automatic reload loop. No idle health-check requests,
cookie operations or provider sign-in submissions are involved. In-page reconnects
and live traffic after OS wake use the provider's existing connection logic.
The Windows failure kinds follow [Microsoft's WebView2 process event documentation](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-related-events).

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

### Reproduce a temporary entry outage on Windows

Use a disposable application profile and a loopback-only HTTP server. The
following example requires Node and counts requests to one path, so browser
favicon requests cannot advance the scenario.

```js
// Save outside the checkout as retry-fixture.cjs, then run node retry-fixture.cjs.
const http = require("node:http");
let attempts = 0;
http
  .createServer((req, res) => {
    if (req.url !== "/retry/" || req.method !== "GET") {
      res.writeHead(404).end();
      return;
    }
    attempts += 1;
    console.log(attempts, Date.now());
    const available = attempts >= 2;
    res.writeHead(available ? 200 : 503, {
      "Cache-Control": "no-store",
      "Content-Type": "text/html",
    });
    res.end(
      available ? "<title>Recovered fixture</title>Recovered" : "Unavailable",
    );
  })
  .listen(19407, "127.0.0.1");
```

1. Add a temporary Synology service with `http://127.0.0.1:19407/retry/` in the disposable profile. Open it once. The server should record the initial GET and one automatic GET after the retry delay. The child should show **Recovered**.
2. To measure exhaustion, set `available` to `false`, restart the fixture and launch a fresh test view. Keep it untouched for 25 seconds. The expected total is five entry requests including the initial GET.
3. Verify another enabled service can open while the first is recovering. Repeat after disabling or removing the failed service before the retry. A stale timer must not visit the former entry. For a 401/403/404 response or a failed provider deep link, expect zero automatic entry requests following the failure.
