# Messenger compatibility in v1.0.4

Both Synology products have the Supported product designation. Discord, WhatsApp,
Messenger, Mattermost and Slack are Experimental. The tables cover the Windows
WebView2 implementation. An authenticated test run requires consented accounts,
a second sender and, for self-hosted services, a disposable server.

- **Fixture** means automated synthetic DOM or native policy regression coverage.
- **Provider UI** means Chat+ delegates to the provider's embedded page. Successful authenticated operation is unverified in this audit.
- **Shared** refers to the applicable shell or engine behavior in the third table. Testing a synthetic page exercises that behavior without certifying a live service.
- **Unavailable** means Chat+ has no integration for the specified function.

### Native fixture results

A Windows run used two configured services on one synthetic origin with separate
persistent profile cookies. Both v1.0.3 and v1.0.4 reopened the profiles on five
launches, preserved separate cookies and passed five minimize-to-tray and
second-instance restores each. Thirty clicks on the already selected service
wrote settings thirty times on v1.0.3 and zero times on v1.0.4. On Ubuntu,
an installed DEB upgrade from v1.0.3 to v1.0.4 preserved a synthetic cookie
and local storage. None of these scenarios required a production account.

In the native Windows failure fixture, WebView2 retried a 503 entry after
1,211 ms and loaded the succeeding 200 response. A continuously unavailable
entry received five GETs including the initial one, with intervals of 1,527,
2,436, 4,486 and 8,455 ms. A 404 entry received one GET. Removing an unavailable
service during its first backoff also left its server at one GET. Actual system
sleep, renderer termination and signed-in site reconnection remain unverified.

## Login, messages and accounts

| Service           | Entry and authentication                                                                                                                                                 | Persist and switch accounts                                                                                       | Send and receive messages                                      | Session expiry                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Synology ChatPlus | Configured NAS origin, DSM ChatPlus launcher or explicit alias. Provider UI.                                                                                             | Shared. Migrated primary ID uses its original default store.                                                      | ChatPlus web composer and conversation view. Provider UI.      | DSM sign-in or reauthentication page. Provider UI.                                        |
| Synology Chat     | Configured NAS origin, DSM Chat launcher or explicit alias. Provider UI.                                                                                                 | Shared, separate service profile.                                                                                 | Synology Chat web composer and conversation view. Provider UI. | DSM sign-in or reauthentication page. Provider UI.                                        |
| Discord           | Official `discord.com/app/` and same-origin login. Provider UI.                                                                                                          | Shared, separate service profile. Account selection in Discord belongs to Discord.                                | DM and guild conversations in Discord. Provider UI.            | Provider login and challenges. Provider UI.                                               |
| WhatsApp          | Official `web.whatsapp.com`. QR or phone pairing when offered. Provider UI.                                                                                              | Shared, one linked-device profile per configured service. Phone pairing and persistence across unlink unverified. | Chats use WhatsApp Web. Provider UI.                           | WhatsApp can request pairing again after logout or linked-device expiration. Provider UI. |
| Messenger         | Facebook Messages, Facebook login/checkpoints and exact Google Accounts verification navigation. Embedded verification and encrypted-history PIN restoration unverified. | Shared, separate Facebook origin profile for each service.                                                        | Facebook Messages web UI. Provider UI.                         | Provider login or checkpoint. Transport success alone cannot diagnose an expired session. |
| Mattermost        | Configured server and base path. Provider UI. Off-origin identity-provider handoff unavailable.                                                                          | Shared, separate service profile.                                                                                 | Mattermost web UI. Provider UI.                                | Server login/SSO policy. Provider UI.                                                     |
| Slack             | Slack workspace on allowed HTTPS Slack origins. Provider UI. Off-origin identity-provider handoff unavailable.                                                           | Shared, separate service profile.                                                                                 | Slack web client. Provider UI.                                 | Workspace sign-in/SSO policy. Provider UI.                                                |

Chat+ retains one native child WebView per initialized service. Each new stable
service ID has its own persistent profile. Switching selects the existing view.
Renaming or reordering keeps the profile. Removing a service closes the view and
keeps its profile files. Per-ID storage selection and saved-settings migration
have native Rust regressions. A cookie or local-storage marker in a test WebView
can demonstrate profile isolation. Only signing in, restarting and reopening a
real account verifies the provider's session lifetime.

## Notification, unread and read behavior

| Service           | Notification source in Windows                                                                                     | Rail unread evidence                                                                                                                                                                                                       | Mark current / Mark all                                                                                                                                                                                | Toast click, precise foreground suppression                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Synology ChatPlus | Provider browser notifications, native bridge.                                                                     | Fixture. Injected ChatPlus sidebar tab indicators and mapped latest pane.                                                                                                                                                  | Explicit current unavailable. All clears local state for this service. Fresh latest-pane engagement plus sufficient evidence can clear observed unread.                                                | Originating service and provider callback. Exact mapping unavailable. ChatPlus theme and public focus/visibility projection.                                                   |
| Synology Chat     | Provider browser notifications, native bridge.                                                                     | Fixture. Channel highlights and complete group metadata. Duplicate starred rows and mention counts preclude a message total.                                                                                               | Explicit current unavailable. All clears local state. Latest channel, visible pane and fresh interaction gate automatic read.                                                                          | Originating service and provider callback. Exact mapping unavailable. Public visibility projection.                                                                            |
| Discord           | Provider browser notifications independent of the DM indicator.                                                    | Fixture. Dedicated DMs, exact known DM owners and unmapped positives. Guild/server indicators and generic notifications cannot set the DM dot.                                                                             | Current acknowledges one mapped unread DM locally. Explicit Mark Inbox as read uses Discord's public control with bounded checks, retaining newer arrivals. Unverified with a current signed-in Inbox. | Originating service and retained browser click before host focus. Suppression requires exact message identity in the unobscured latest viewport. Fixture.                      |
| WhatsApp          | Provider browser notifications. Chat+ has no independent push subscription. Worker background delivery unverified. | Fixture. Canonical localized title counter with authenticated UI readiness. Its notification-attention scope can exclude muted, archived or locked chats.                                                                  | Explicit current unavailable. All clears only local state. A recognized scoped zero can also clear the local indicator.                                                                                | Originating service and provider callback. No proven current-chat tag mapping or exact foreground suppression.                                                                 |
| Messenger         | Real browser notification arrivals on the configured Facebook origin.                                              | Fixture. Event-owned dot. Dedicated DOM adapter stays unknown. No numeric total or Facebook navigation-badge inference.                                                                                                    | Explicit current unavailable. All clears local state.                                                                                                                                                  | Originating service and provider callback. The origin also hosts other Facebook activity. Exact conversation routing and suppression depend on Facebook and remain unverified. |
| Mattermost        | Browser arrivals on the configured server origin. Provider desktop settings also apply.                            | Fixture. Arrival-owned dot. Fresh zero can use documented read-only metadata after trusted engagement on the supported primary-store configuration (unlicensed 11.7.2). Other configurations retain local acknowledgement. | Explicit current unavailable. All clears local state.                                                                                                                                                  | Originating service and provider callback. Legacy text tags cannot establish an exact post match.                                                                              |
| Slack             | Chat+ native notification integration unavailable.                                                                 | Unavailable.                                                                                                                                                                                                               | Current and all unavailable.                                                                                                                                                                           | Chat+ toast activation and suppression unavailable.                                                                                                                            |

For each supported notification bridge, Chat+ claims the WebView2 event and applies
the exact originating service, native permission, user preferences and foreground
policy. Document observations do not create toasts. An eligible new event can
change unread even with desktop banners muted. Native activation requires the
retained browser object. A provider can omit a click callback, close an event or
choose a different destination. Tests cover clicked account, replacement, type
of unread evidence, out-of-order arrivals, late callbacks and newer manual
selection. Only an actual click on a real OS toast can verify an authenticated
conversation destination. [Notification policy and diagnostic controls](NOTIFICATIONS.md)

## Files, media, background and recovery

| Capability                             | ChatPlus                | Synology Chat                | Discord                 | WhatsApp                | Messenger              | Mattermost             | Slack                                              |
| -------------------------------------- | ----------------------- | ---------------------------- | ----------------------- | ----------------------- | ---------------------- | ---------------------- | -------------------------------------------------- |
| Attachment upload, drag and drop       | Provider UI             | Provider UI                  | Provider UI             | Provider UI             | Provider UI            | Provider UI            | Provider UI                                        |
| Attachment download                    | Shared                  | Shared                       | Shared                  | Shared                  | Shared                 | Shared                 | Shared                                             |
| Text paste, image paste, media preview | Provider UI             | Provider UI                  | Provider UI             | Provider UI             | Provider UI            | Provider UI            | Provider UI                                        |
| Voice messages                         | Provider UI if offered  | Provider UI if offered       | Provider UI if offered  | Provider UI if offered  | Provider UI if offered | Provider UI if offered | Provider UI if offered                             |
| Calls, microphone and camera           | Unverified              | Unverified                   | Unverified              | Unverified              | Unverified             | Unverified             | Unverified                                         |
| External links and related popups      | Shared                  | Shared                       | Shared                  | Shared                  | Shared                 | Shared                 | Shared                                             |
| Connection, DNS or service outage      | Shared                  | Shared                       | Shared                  | Shared                  | Shared                 | Shared                 | Shared                                             |
| Resume after actual OS sleep           | Unverified              | Unverified                   | Unverified              | Unverified              | Unverified             | Unverified             | Unverified                                         |
| Hidden/minimized behavior              | Shared, projected focus | Shared, projected visibility | Shared, projected focus | Shared, title attention | Shared, browser events | Shared, browser events | Shared, shell bridge for unread/toasts unavailable |

- **Files and clipboard.** The browser handles the provider's file input, clipboard gestures, media previews and HTML drag/drop. Chat+ disables Tauri's file-drop interception. Windows managed downloads use the source view's authenticated download and Save As flow. File picker, opaque blob, attachment server/CDN, clipboard, recording, two-party calling and media-permission behavior require live checks per service. Chat+ supplies no separate recorder or calling client.
- **Links.** Provider-owned navigation and allowed related popups keep the profile. External HTTP(S) destinations require the saved preference and a user confirmation. Provider-specific URL and permission policies have fixtures. [Links and downloads](LINKS_AND_DOWNLOADS.md)
- **Minimized and tray.** Initialization starts with the selected service. Enabled background services start sequentially and remain loaded. Native selection/focus controls read evidence. Minimize, restore and toast activation do not acknowledge by themselves. The native runtime and provider determine whether a background page or service worker emits a browser notification. Disabling eager initialization for enabled notification-bearing services would delay those first arrivals.
- **Recovery.** Windows uses top-level WebView2 completion and main renderer failure events. Only eligible failures of the configured entry get a new entry GET. A main renderer exit on an allowed provider document can also request that entry. The app retains the WebView profile. Embedded SPAs own WebSocket reconnection and wake handling. Browser-process loss requires restarting the app. Login, pairing and verification remain interactive. See the [session lifecycle and retry policy](SERVICE_STARTUP.md).
- **Other engines.** macOS uses WKWebView stores and Linux uses WebKitGTK profiles. Both use an injected browser-notification shim and a bounded, origin-checked WebKit outbox drain at 500 ms intervals. Their bridge does not implement individual OS toast activation/withdrawal or managed Windows-style downloads. Transport success cannot be determined from the generic page-finished event. Platform smoke tests and native authenticated checks have different scopes. [Platform limits](PLATFORMS.md)

## Repeatable provider acceptance

Record the service, shell version, engine version, provider/server version, profile count and outcome for each row. Use **pass**, **fail**, **unavailable** or **untested**, and note whether the evidence came from a real provider, a native fixture or a model.

1. With disposable accounts A and B, sign in through the provider UI. For WhatsApp, pair using the QR offered by the page. For Messenger, record whether a checkpoint or history PIN was required. Restart the shell, switch between the two configured profiles and verify each opens its own account.
2. Send synthetic text each way. With B selected, send A two controlled messages in different conversations. Repeat while unfocused, minimized and hidden to tray. Record the provider/browser event, banners and rail/tray result independently. Repeat with the service muted, browser notification permission denied and the OS allowing/blocking banners.
3. Click one notification and compare the selected account and conversation with the sender's intended destination. Test a closed/replaced toast and two rapid clicks. Restore the window without interacting and verify unrelated unread remains. Exercise only the explicitly chosen read command on disposable messages. For Discord include a DM and a guild channel, for WhatsApp include an excluded/muted chat.
4. Open an attachment picker, drag in a small generated file, paste text and paste a generated image. Verify the recipient can retrieve the attachment, the saved bytes match and previews work. Open an external link, cancel once and confirm once. Record denied and granted microphone/camera behavior. If offered, send one short voice clip and make a two-party call using test devices.
5. Disconnect and restore the network, reproduce a temporary test-server outage, then sleep and wake the host. Record the first new controlled arrival and compare before/after session and unread state. Use an isolated fixture to test entry failures, retry exhaustion and navigation cancellation. For expired-session checks, revoke only the disposable test session through the provider's public controls.
6. Repeat with the second account selected and after a full application restart. Document unsupported controls, unavailable worker events and any provider change separately. Use the [Windows acceptance checklist](WINDOWS_ACCEPTANCE.md) for native sender registration, foreground cases, multi-instance isolation and attachment Save As.

## Reproducing the adapter measurements

Run the following from the repository root with the locked dependencies installed.

```sh
node --test tests/whatsapp-attention.test.mjs tests/whatsapp-unread.test.mjs tests/provider-bootstrap.test.mjs
node scripts/benchmark-provider-adapters.mjs /path/to/v1.0.3-checkout
node scripts/benchmark-provider-adapters.mjs .
cargo test --locked --manifest-path src-tauri/Cargo.toml --bin chatplus-desktop platform::recovery::
cargo test --locked --manifest-path src-tauri/Cargo.toml --bin chatplus-desktop toast_route_keeps_the_originating_account
```

With 128 synthetic chat rows and 128 message wrappers and the first candidate
visible in each set, one WhatsApp readiness snapshot made 256 row/wrapper geometry
probes before the change and 2 afterward. Both snapshots returned known zero.
The 512-candidate safety bound and duplicate-pane rejection still apply. This
measures calls to the layout API, independent of browser process memory or CPU.

An initially loading, hidden WhatsApp fixture with the title `(4) WhatsApp`
published only unknown when readiness advanced without another DOM mutation.
The readiness listener now publishes 4 without focus or a rail click. Reinjecting
the provider bundle previously replaced its callbacks and attached a second set
of observers. It now retains one owner until a non-cached document exit.

The adapter benchmark built both the stable v1.0.3 tag (`a526463`) and candidate
sources with the same tooling. It instantiated all seven synthetic documents,
then delivered twenty unchanged background foreground-state projections per
document. Geometry counts include the first snapshot, with 128 mounted chat rows
and a positive WhatsApp attention title. Other adapters received minimal
provider-specific fixture markup. Selector counts are calls to `querySelector`
and `querySelectorAll` on the fixture document/elements.

| Provider          | Selector calls on both builds | Geometry calls v1.0.3 | Geometry calls v1.0.4 | Unread packets on both builds |
| ----------------- | ----------------------------: | --------------------: | --------------------: | ----------------------------: |
| Synology ChatPlus |                           147 |                     0 |                     0 |                             1 |
| Synology Chat     |                           210 |                     0 |                     0 |                             1 |
| Discord           |                            64 |                     0 |                     0 |                             1 |
| WhatsApp          |                            63 |                 2,730 |                    63 |                             1 |
| Messenger         |                             0 |                     0 |                     0 |                             1 |
| Mattermost        |                             0 |                     0 |                     0 |                             1 |
| Slack             |                             0 |                     0 |                     0 |                             0 |
| All seven         |                           484 |                 2,730 |                    63 |                             6 |

No provider websites or signed-in chats are loaded by this benchmark. The
Mattermost authenticated verification path requires active engagement and did
not run. The one Messenger packet reports unknown, and Slack has no adapter.
