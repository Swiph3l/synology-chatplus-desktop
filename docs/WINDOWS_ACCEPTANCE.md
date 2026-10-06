> Current source checklist: [2026-10-07 reliability pass](#current-reliability-pass-2026-10-07).
> Earlier numbered sections retain historical observed/pending evidence for their stated revision.

# Windows acceptance — 2026-10-01 follow-up

This report preserves observations and development validation through the
**0.5.0-beta.3** prerelease preparation. Beta.2/beta.3 references identify those
earlier builds. The current target is [v0.5.0-beta.4](WINDOWS_BETA.md), with its
explicit pending provider matrix in [section 20](#20-2026-10-04-beta4-provider-reliability-acceptance).
Preparing this candidate does not complete any outstanding native acceptance gate.

Recommendation: **NOT READY FOR RC AUDIT**.

The requested rail/form refinements and experimental Discord implementation are
complete in separate local commits. This report records acceptance evidence and
remaining manual gates; it does not classify unobserved behavior as passing.
Development remained **0.5.0-beta.2** during that pass. Nothing was pushed, tagged, published or bumped
to final 0.5.0, and no remote issue was closed.

## 1. Native environment and preserved history

- Windows NT 10.0, build **26300.9550**, registry display version **26H2**.
  The registry ProductName is not used to infer the Windows marketing name.
- WebView2 **154.0.4258.37**; Tauri **2.11.5**; development/debug build.
- Supported launch: `npm.cmd run tauri -- dev --no-watch`, with isolated application
  identifiers for public visual fixtures. Vite stayed on the allowed local port 1420.
- Final native feature build: **5d1d926**. Subsequent **2c7d529** changes documentation
  only. Earlier setup/form captures precede Discord and are identified separately.
- Started this follow-up at **f76e42e23341746c6db3f868a890430cac33a12d** on `main`.
  All eight preceding development commits remain intact. Contrary to the supplied
  initial expectation, the existing `origin/main` reference already pointed at
  f76e42e; no fetch or push was performed.
- Computer Use's native helper pipe was unavailable. Native observations used the
  actual running WebView2 through its development debugging interface and a targeted
  Win32 window-state/resize harness. Screenshots are actual WebView content, without
  the Windows title/menu frame. These methods do not establish every interaction
  normally checked by a human or native UI automation.

Private application URLs, credentials, cookies, tokens, session contents and chat
messages are excluded from committed evidence. Authentication remains manual.

## 2. Issue acceptance matrix

| Issue                     | Recommendation | Evidence and remaining gate                                                                                                                                                                                                 |
| ------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #14 single instance       | **KEEP OPEN**  | Host-window lookup was corrected; the normal/minimized/tray/Settings/About/rapid-launch native matrix remains unverified.                                                                                                   |
| #15 native menu/theme     | **KEEP OPEN**  | Real main-window menus were enumerated, and light/dark appearance was observed. Repeated menu actions, System theme, auxiliary windows and restore transitions remain unverified.                                           |
| #16 dark reaction control | **KEEP OPEN**  | Scoped styling/regression tests pass. The actual controlled ChatPlus reaction states have not been visually verified.                                                                                                       |
| #17 unread stability      | **KEEP OPEN**  | Native bridge-to-rail synthetic unread and inactive caching were observed; real message/read/reload/reconnect/startup transitions remain unverified.                                                                        |
| #18 Settings Save         | **KEEP OPEN**  | Actual General Save kept the window open and persisted a preference; Save focus was fixed. All-tab persistence, explicit Close and the complete native failure matrix remain unverified.                                    |
| #19 extensible foundation | **KEEP OPEN**  | Registry, isolation, migration, three-service rail and native child activation have evidence. Complete native lifecycle and authenticated multi-account retention remain open. This does not require every future provider. |

## 3. ChatPlus regression results

Actual original-profile ChatPlus reached authenticated UI on two launches: four
sidebar tabs and no password fields were observed without reading chat contents.
No repeated credential entry was requested. Local setup was captured from the
running application. Remote content could not invoke the local `get_settings`
command, while the trusted desktop rail could.

Navigation, links, external browser behavior, tray lifecycle, reconnect, reaction
states and live notifications/unread still require controlled-channel acceptance.
The public fixture used for visual tests is not evidence of a real ChatPlus DOM
adapter or message/read transition.

## 4. Rail, Services form and Discord results

| Check                                 | Result                                                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outer desktop navigation identity     | **OBSERVED**: desktop mark, border/separators, compact provider buttons; service content retains its own navigation.                                                                                                                        |
| Provider icons                        | Distinct ChatPlus, Synology Chat and Slack assets verified in code/tests; Discord uses the official symbol. Two Discord configurations retain separate IDs/tooltips.                                                                        |
| Width and placement                   | **OBSERVED**: 56 logical pixels, Add near the bottom, Settings last; no wrapped loading text.                                                                                                                                               |
| Three configured services             | **OBSERVED**: ChatPlus plus Personal Discord and GameDev Discord in the current native build. Earlier public fixture also configured ChatPlus/Synology Chat/Slack.                                                                          |
| Active/inactive/hover/focus           | **OBSERVED**: persistent active bar, temporary hover fill, separate dashed keyboard focus; active state remained distinct while another button had focus.                                                                                   |
| Unread                                | **OBSERVED WITH SYNTHETIC INPUT**: small independent dot and accessible unread label; inactive ChatPlus retained its dot when Discord became active.                                                                                        |
| Minimum width                         | **OBSERVED**: real native client resized to **900 × 600**, three service buttons, no horizontal rail overflow.                                                                                                                              |
| Windows 100% DPI                      | **OBSERVED**: native DPI 96 and rendering scale 1.0.                                                                                                                                                                                        |
| 125% / 150%                           | **RENDER CHECK ONLY**: actual WebView2 rendering emulated at 1.25/1.5; 70/84 physical-pixel rail captures fit without overflow. Actual Windows monitor DPI changes remain untested.                                                         |
| Services form consistency             | **OBSERVED** in light theme: Provider, Display name and Service URL each **437 × 32**, 13-pixel font, 8-pixel horizontal padding and 4-pixel radius; shared backgrounds/borders. Scoped theme variables preserve dark/light/system support. |
| Experimental/destructive form styling | **OBSERVED/TESTED**: informational badge, separate subdued SSO helper, aligned Enabled checkbox, separated danger button and confirmation before staged removal.                                                                            |
| Provider-specific fields              | **TESTED**: stable/experimental rendering; Discord name-only form; no irrelevant URL field; changing provider preserves the service identity.                                                                                               |
| Disabled and long-name behavior       | **AUTOMATED ONLY**: disabled services retain existing filtering and custom names remain tooltips; full native add/edit/disable/remove/long-name matrix remains open.                                                                        |

Discord is **Experimental**. Its fixed entry is the public Discord web application;
top-level navigation is limited to HTTPS `discord.com` on port 443. Lookalike domains,
arbitrary subdomains, credentials and other origins are rejected; same-origin
popups reuse the existing view. Native unread/notifications and ChatPlus theme
injection stay disabled. There is no private API or credential automation.

The Personal Discord child created an actual dedicated `services/<id>` profile and
reached Discord's login prompt. GameDev Discord is configured separately but has
not been authenticated/activated for the full live account test. Two-account login,
switching, rename, two restarts and removal isolation require manual test-account
input. The login prompt is left for the user; credentials are never entered by the
test harness. See [provider scope](PROVIDERS.md#discord).

## 5. Legacy migration and session retention

**Reported acceptance issue:** "Authenticated session appeared stuck on login
screen after previous successful login."

Investigation found that adding child WebViews changes how Tauri exposes the host:
`get_webview_window("main")` can return no value, and commands injected with a
`WebviewWindow` fail with "current webview is not a WebviewWindow". This caused the
local rail to remain at Loading and broke operations requiring the main host.
The correction uses the host `Window` and the trusted local `Webview` as appropriate;
it does not introduce another service/session architecture or profile path.

The original application identifier/default profile was then reused across two
actual launches, with authenticated ChatPlus UI observed both times. The migrated
legacy service used the deterministic `chatplus` ID and schema 1. Code/tests retain
the original default profile exception and idempotent migration; other services
use stable per-ID directories, independent of provider and display name.

A deliberately separate acceptance identifier uses a fresh profile and showing
login there is expected. This distinction explains one source of misleading login
observations, but it does **not** prove that the user's stuck-login incident has
been reproduced and resolved in its entirety. No duplicate hidden authenticated
session was positively demonstrated. Installed upgrade retention and the complete
activation/restart/profile-selection scenario remain release gates. **Do not mark
ChatPlus login retention PASS.** No cookie or profile-content copying was performed.

## 6. Synology Chat experimental results

Provider registration, exact configured-origin rules, distinct presentation,
isolated profile selection and disabled desktop integration have automated evidence.
The public three-provider fixture rendered its form/badge. Actual controlled Synology
Chat login, authenticated navigation, SSO, restart retention and external links are
**NOT TESTED**. It remains Experimental; no native unread/notification claims.

## 7. Slack experimental results

HTTPS Slack origin restrictions, registration and disabled desktop integrations
remain tested. The public fixture configured Slack and an invalid workspace URL
produced native Settings validation feedback. Actual workspace authentication,
SSO/popup flow, navigation and persisted login are **NOT TESTED**. External identity
provider cookie handoff remains unavailable. No origin rules were relaxed.

## 8. Notification acceptance matrix

| Scenario                                           | Native result                                   |
| -------------------------------------------------- | ----------------------------------------------- |
| Test notification, permission allowed, toast/click | **NOT TESTED**                                  |
| Real message unfocused                             | **NOT TESTED** — second account action required |
| Real message minimized                             | **NOT TESTED** — second account action required |
| Real message in tray                               | **NOT TESTED** — second account action required |
| Focused suppression                                | **NOT TESTED** — second account action required |
| Full / sender / generic privacy                    | **NOT TESTED** live                             |
| Sound disabled                                     | **NOT TESTED** live                             |
| Permission denied / Do Not Disturb                 | **NOT TESTED** live                             |
| Inactive source-service click                      | **NOT TESTED** live                             |
| Two identical messages within five seconds         | **NOT TESTED** live                             |

Automated policy/bridge/source-routing checks pass. Host-window/focus and active
WebView permission lookup corrections are included. Fixtures disable desktop
notifications. Identical content can still suppress a legitimate separate message
within five seconds without a reliable provider event identity; this limitation
is documented, not claimed resolved. Only the dedicated private test channel may
be used for live testing, with the user's second account.

## 9. Unread acceptance matrix

| Scenario                                   | Result                                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Native observation → dot/title             | **OBSERVED SYNTHETIC**: validated bridge observation from a public fixture set the dot and desktop unread title. |
| Inactive service cache and switching       | **OBSERVED SYNTHETIC**: dot remained when another service became active.                                         |
| Zero/one/multiple real conversations       | **NOT TESTED**                                                                                                   |
| Open/read versus focus without reading     | **NOT TESTED** live                                                                                              |
| Reload / reconnect / restart with unread   | **NOT TESTED** live                                                                                              |
| Tray / inactive real service / switch back | **NOT TESTED** live                                                                                              |

Boolean unread remains the contract; no fake numeric totals or document-title
parsing were added. Adapter and cache tests cover missing DOM and focus/navigation
behavior, but they do not substitute for live message/read evidence.

## 10. Theme, menu and connection results

Real light Services controls and dark rail/setup were inspected. Native main menus
were enumerated as File/View/Window/Help/Developer. Host-window menu/reload/focus
lookups were corrected without changing window creation. Repeated System → Dark
→ Light transitions, menu dispatch, Windows system-theme changes, auxiliary-window
activation and minimized/loading transitions remain open.

Per-service connection/cache behavior has automated coverage. The current native
public fixture loaded and Discord reached login; actual server unreachable/recovery,
disabled-service and restart connection transitions remain unverified.

## 11. Settings Save/Close and updater results

Native General Save persisted a harmless theme change, left Settings open and
showed inline feedback. The focus regression was fixed and verified: a Save button
that had keyboard focus regained it after completion. Automated success and failure
tests cover this behavior. Invalid Slack configuration was observed with validation
feedback; a disk-write failure was not induced. Full native Save persistence for
Notifications, Updates and Services, duplicate-feedback/toast absence and explicit
Close require completion. A previous visual fixture changed during testing, so its
later observations were excluded from passing evidence.

Updater unit/integration tests cover beta.2 → beta.3, beta.2 → stable, Stable rejection
of beta, Pre-release acceptance of beta, and RC → stable. Signed HTTPS fixture checks
passed; production artifact signing was not performed. The UI source uses ordinary
Stable/Pre-release descriptions rather than manifest internals; a fresh native
Updates screenshot and complete native interaction check remain open.

## 12. Screenshots captured

All listed new images were captured from actual running WebView2 content and
visually reviewed for private information. Fixture names are synthetic; the Services
URL is the public documentation example, not a test NAS endpoint. No screenshot
text was edited. Rail-only captures exclude provider login/content.

| Path under `docs/screenshots/`     | Evidence                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `setup.png`                        | Fresh isolated setup; empty URL control/public placeholder; pre-Discord acceptance build.          |
| `services.png`                     | Fresh pre-Discord UI refinement in light theme; common full-width controls and experimental badge. |
| `service-rail.png`                 | Native current feature build, three services.                                                      |
| `service-rail-minimum.png`         | Real 900 × 600 client minimum.                                                                     |
| `service-rail-125-render.png`      | Emulated 125% rendering, not Windows monitor DPI.                                                  |
| `service-rail-150-render.png`      | Emulated 150% rendering, not Windows monitor DPI.                                                  |
| `service-rail-unread.png`          | Active service plus synthetic unread.                                                              |
| `service-rail-focus.png`           | Separate keyboard focus and active/unread state.                                                   |
| `service-rail-inactive-unread.png` | Discord active with cached inactive ChatPlus unread.                                               |

General, Notifications, Updates and About images remain historical and explicitly
stale. In particular, historical About's `0.5.0-dev` must not be represented as the
current version. Fresh metadata-derived About and the remaining tabs are still due.
See [capture provenance](screenshots/README.md).

## 13. Bugs discovered

1. Main host lookup/command argument assumed a single `WebviewWindow` after child
   views were attached. Actual IPC failed and left Loading visible; related focus,
   tray/restore, menu, unread and notification host operations needed the same correction.
2. Settings disabled the focused Save button and left keyboard focus on the body.
   Focus is now restored after success or failure when Save originally had focus.
3. User-reported authenticated session stuck at login: investigated as described
   above; **not yet fully reproduced/resolved**, and retained as an acceptance gate.

## 14. Focused local commits

| SHA     | Subject                                                              |
| ------- | -------------------------------------------------------------------- |
| 0791b56 | fix: address host windows after adding service webviews              |
| f5dc2ff | fix: restore settings save button keyboard focus                     |
| 8a4d048 | fix: refine desktop service rail and configuration form styling      |
| 5d1d926 | feat: add experimental Discord service instances                     |
| 2c7d529 | docs: describe experimental Discord and per-service account profiles |

The UI commit contains no Discord provider/session implementation. Discord and its
documentation follow in separate commits. Acceptance evidence is committed separately.
No preceding commit was amended, squashed or rewritten.

## 15. Automated checks after fixes

| Check                               | Result                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| npm format/typecheck                | **PASS**                                                                                           |
| npm tests                           | **PASS: 32**                                                                                       |
| npm build / release-asset isolation | **PASS**                                                                                           |
| cargo fmt / locked check            | **PASS**                                                                                           |
| cargo debug and release tests       | **PASS: 47 each, 1 ignored each**                                                                  |
| npm audit                           | **PASS: zero vulnerabilities**                                                                     |
| Windows cargo deny                  | **PASS**, duplicate/license warnings retained                                                      |
| cargo audit                         | Completed with seven existing allowed maintenance/Linux warnings and a cache/index-refresh warning |
| New-commit Gitleaks                 | **PASS**, redacted scan                                                                            |

The ignored test requires a separately built production artifact/signature. Signed
HTTPS updater fixture tests ran normally. No dependencies/lockfiles were changed.
Linux `glib` / RUSTSEC-2024-0429 remains outside the Windows dependency graph and
requires review before a Linux release; warnings were not hidden to obtain a pass.

## 16. Remaining blockers before RC

1. Reproduce/resolve the reported stuck authenticated login and complete installed
   migration/profile retention, with two restarts and no repeated credential requests.
2. Complete actual single-instance, menu/theme, tray/focus and all-tab Save/Close matrices.
3. Inspect real dark reaction states and test real controlled ChatPlus notifications,
   read/unread and reconnect transitions with the dedicated second test account.
4. Complete native lifecycle add/rename/disable/remove/rapid-switch and actual Windows
   125%/150% DPI checks; rendering emulation is supplemental evidence only.
5. Complete two authenticated Discord profiles and experimental Synology Chat/Slack
   authentication/SSO acceptance where test accounts are available. Keep experimental
   limitations explicit and desktop integration disabled.
6. Capture fresh General/Notifications/Updates/About evidence from the actual build,
   review privacy, and verify About's metadata-derived version.

Local AI notes outside Git were updated with the observed results and remaining
gates. No credentials or private runtime details belong in those notes.

## 17. Recommendation

**NOT READY FOR RC AUDIT**. Implementation and automated checks are complete for
the requested UI/Discord scope, but the outstanding native/manual acceptance gates
prevent an RC-ready classification. Do not perform an RC/final bump or release action.

## 18. Development finalization status

Finalization commits menu/removal, Mattermost and Synology icon work, with
Save/removal overlap protection and Windows profile-identity validation. Current
automated results are **56 frontend tests passed** and **62 Rust tests passed in
each debug/release run, with one production-artifact test ignored in each**.
Full results and dependency classifications are recorded in
[DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md#development-finalization-and-stable-gate).

No native app interaction or new screenshot was performed during finalization.
Native Computer Use APIs are unavailable in this environment; prior local attempts
also recorded an unavailable native pipe. Existing screenshots and observations
remain evidence for the earlier builds identified above. They do not validate the
new popup/removal behavior or final source state. No MANUAL PASS was provided;
no unobserved check is promoted to PASS.

| Required Windows acceptance         | Finalization status | Remaining evidence                                                    |
| ----------------------------------- | ------------------- | --------------------------------------------------------------------- |
| Single-instance behavior            | NOT TESTED          | Normal/minimized/tray/auxiliary/rapid-launch matrix                   |
| Repeated launch restore             | NOT TESTED          | Restore state and keyboard focus                                      |
| Tray restore                        | NOT TESTED          | Hide/restore and active child focus                                   |
| Settings/About duplicate prevention | NOT TESTED          | Repeated launch and menu opening                                      |
| Native menu after theme changes     | NOT TESTED          | Light/dark/System actions and restore lifecycle                       |
| Settings Save/Close                 | NOT TESTED          | All-tab persistence, Close and failure/focus matrix; DOM tests pass   |
| Service rail                        | NOT TESTED          | Current icons, input and native layout; earlier observations retained |
| Context menu                        | NOT TESTED          | Appearance, keyboard, dismissal, positioning and native actions       |
| Removal                             | NOT TESTED          | Both native paths, persistence/restart and retained account profile   |
| Service switching                   | NOT TESTED          | Rapid switching, hidden-view reuse and authenticated accounts         |
| Legacy migration                    | NOT TESTED          | Installed upgrade and cookie retention; model tests pass              |
| Login/session retention             | NOT TESTED          | Reproduce/resolve stuck login and restart twice                       |
| Synology ChatPlus                   | NOT TESTED          | Controlled live regression; earlier authenticated evidence is limited |
| Synology Chat Experimental          | NOT TESTED          | Live login, SSO and retention                                         |
| Slack Experimental                  | NOT TESTED          | Live login, SSO and retention                                         |
| Discord Experimental                | NOT TESTED          | Two authenticated accounts and independent restart/removal            |
| Mattermost Experimental             | NOT TESTED          | Custom-server login/SSO and two authenticated accounts                |
| Notifications                       | NOT TESTED          | Controlled messages, focus/privacy/permission/tray/click matrix       |
| Unread                              | NOT TESTED          | Real read/reload/reconnect/startup transitions                        |
| DPI/layout                          | NOT TESTED          | Actual Windows 100%/125%/150% and native popup bounds                 |

Services removal now persists immediately after confirmation and retains profiles;
it does not save unrelated Settings drafts. Earlier references to staged removal
describe the previous build. Tests establish the new model and mocked interactions,
including Save/removal overlap, rather than native acceptance.

Synology ChatPlus remains the primary supported provider with outstanding release
acceptance. Synology Chat, Slack, Discord and Mattermost remain Experimental;
desktop notifications/unread are disabled for all four. Live multi-account login,
SSO and retention are not claimed. Profile validation rejects case-colliding IDs
and Windows device names without renaming valid existing profiles.

The section 2 issue matrix remains authoritative: **#14 through #19 KEEP OPEN**.
The reported ChatPlus login incident, installed migration/profile retention and
native matrices still block stable preparation. Development stays **0.5.0-beta.2**;
no stable bump, release-preparation commit, tag, push or publication was performed.

Fresh privacy-reviewed setup, General, Notifications, Updates, Services, About and
service-rail captures from the final source need follow-up. No current screenshots
were fabricated or substituted for native evidence.

**NOT READY FOR v0.5.0**.

## 19. 2026-10-04 lifecycle, settings and footer acceptance

This checklist applies to the current **0.5.0-beta.3 development source**. Earlier
results above remain historical. All native rows in this section are **PENDING**;
unit tests and browser fixtures do not establish native Windows acceptance.
See [the implementation notes](MAINTAINER_FOLLOWUP.md).

### Notifications and acknowledgement

Use a dedicated private test conversation and a second authorized local test
account. Do not put message contents, server URLs or credentials in evidence.
Configure two supported ChatPlus service instances, activate both once, enable
global and per-service notifications, and set cooldown to **No cooldown** for
the duplicate-delivery cases. Start with no unread markers.

1. Keep ChatPlus foreground on service A. Send a message to service B. Verify
   only B gains an unread dot and one Windows notification appears.
2. Select A, minimize ChatPlus, then send a message to A. Verify A's dot remains
   after waiting and after switching to B; selection must not acknowledge it.
   Verify a Windows notification appears while minimized.
3. Minimize ChatPlus again, send to non-selected B, and verify B's dot remains
   alongside A's unread; verify one Windows notification for B.
4. Send several messages to A, including identical title/body content in quick
   succession. Verify separate legitimate events are delivered once each at
   cooldown zero and do not create a duplicate notification storm.
5. Send to both services. Verify independent dots and aggregate title/tray/taskbar
   unread. Read A using actual provider interaction; B must stay unread.
6. Restore/focus ChatPlus and select an unread service without interacting with
   its conversation. Verify unread persists. Then actually read/acknowledge the
   conversation and verify its dot and aggregate state update.
7. Click a notification from B with A selected. Repeat while ChatPlus is
   foreground, background, minimized and hidden by **Close to tray**.
8. Verify the existing main window is shown/unminimized/focused and B opens with
   keyboard input working. Verify no extra process/window and no unread clear
   caused solely by activation. Repeat after B is removed/disabled: it must not
   be recreated.
9. Repeat focused-conversation delivery, reload/reconnect, cooldown 30/60/90,
   notification mute, sound off, each privacy mode, Windows permission denial
   and Do Not Disturb. Focused active viewing should avoid redundant toasts;
   background selection must not suppress them. Submission success alone does
   not prove that Windows displayed a banner.

Record Windows/WebView2 versions, app revision, preferences and observed
transitions. Keep the reported login/profile-retention gates open until separate
authenticated acceptance resolves them.

### Updates

Use controlled, correctly signed release fixtures; do not install unverified
artifacts or publish a release merely to run this checklist.

1. Enable automatic checking and relaunch. Verify the main UI becomes usable
   before the asynchronous startup request finishes; confirm one startup check.
2. Relaunch after a recent successful check. Verify a new startup check still
   occurs. Disable automatic checking, relaunch and verify no scheduled request.
3. While a check is pending, request a manual check. Verify there is only one
   request and the Updates section shows its state. Use instrumented/fake-clock
   scheduler tests for the six-hour boundary; do not wait six hours in unit tests.
4. On Stable, expose a newer beta/RC and verify it is excluded. Expose a newer
   stable version and verify it is accepted.
5. On Pre-release, verify beta.3 → beta.4, beta.4 → 0.5.0 and 0.5.0 → 0.5.1
   ordering. Change channel during a pending request/download; verify an old
   result cannot overwrite the new channel or become installable.
6. Choose **Check for Updates** manually and verify progress, installed version,
   result and release notes in the Updates section.
7. Disconnect networking or return a temporary endpoint error. Verify startup
   stays responsive, no repeated/intrusive dialog opens, an appropriate status
   appears and a later retry succeeds.
8. Test no-update: show **Up to date** in Updates/footer with no automatic popup.
9. Test update-available: show a non-blocking footer indication; opening Updates
   does not start download/installation automatically.
10. Test download/cancel, bad signature rejection and confirmed install/restart
    with a controlled signed build. Cancel confirmation and verify no install;
    accept it and verify the expected newer running version after restart.

### Settings, localization and footer

Repeat at **1366×768** and **1920×1080**, then at the native **900×600 minimum**.
Also repeat with actual Windows monitor scaling **100%, 125%, 150%**; browser
emulation does not establish native child-WebView geometry or DPI acceptance.

1. Open every Settings section. Verify navigation and Save/Close stay visible,
   only the panel scrolls, and there is no clipping or horizontal page overflow.
2. Use Tab/Shift+Tab, arrow keys, Home/End and activation keys through section
   navigation and enabled actions. Verify visible focus and predictable order.
3. Edit General/Notifications/Updates/Services, change sections and save. Reopen
   and restart to verify persistence. Confirm/cancel service removal and verify
   unrelated drafts survive without being silently saved.
4. Select **English**, **Polski**, **Español** in turn. Verify settings, service
   management, dialogs/errors, update states, About, footer, native menus and
   tray are translated. The embedded providers, changelog source text and legal
   license text retain their own language.
5. Verify the footer is consistently 30 logical pixels high below service content
   and remains visible when resizing/switching services. Long status text must
   truncate without moving version/actions. Verify enabled hover/focus states.
6. Verify Console and Donate are muted, disabled and expose **Coming soon**
   tooltips; keyboard navigation skips them. Verify Report issue opens the
   existing GitHub Issues page and About opens the About Settings section.
7. Simulate checking/current/available/offline/notification-error states. Verify
   compact localized status and enabled update-status navigation where applicable.
8. Open Changelog offline: recent versions/categories remain available and safe
   text rendering cannot execute embedded markup. Verify About's independent
   community and Synology non-affiliation/trademark notices and local license.

## 20. 2026-10-04 beta.4 provider reliability acceptance

This is the current **0.5.0-beta.4 candidate** checklist. The user requested
completion of implementation, automated regressions and a locally launchable
development build, with real Windows acceptance left for their manual testing.
No authenticated provider session or working native automation session was
available in this pass. Earlier observations apply only to their recorded builds.

| Provider          | Foreground | Background | Minimized | Unread persists | Toast   | Toast click |
| ----------------- | ---------- | ---------- | --------- | --------------- | ------- | ----------- |
| Synology ChatPlus | PENDING    | PENDING    | PENDING   | PENDING         | PENDING | PENDING     |
| Synology Chat     | PENDING    | PENDING    | PENDING   | PENDING         | PENDING | PENDING     |
| Discord           | PENDING    | PENDING    | PENDING   | PENDING         | PENDING | PENDING     |

Automated DOM, native state and notification-policy tests **do not** establish
Windows banner delivery, genuine provider read transitions or toast activation.
Record application revision, Windows/WebView2 version and provider/server version
alongside results. Keep credentials, message contents and private URLs out of Git.

**Known candidate read-clear limitation:** Synology notification tags have no
audited exact mapping, so native-arrival unread can remain after genuine reading
until restart reobserves provider state. Incomplete/selected/muted/private/request
Discord navigation can similarly keep the dot. Record these outcomes explicitly;
automatic read-clear parity and stable release readiness are not claimed.

### Controlled provider matrix

Use dedicated test accounts and conversations. Activate each service once to
create its WebView. Explicitly enable global and per-service desktop notifications
and the provider's own browser notification preference/permission. Previously
saved per-service mute preferences remain unchanged. Select **No cooldown** when
testing duplicate and consecutive messages. Check Windows notifications and Do
Not Disturb separately; successful submission does not prove a visible banner.

Repeat every step for **each of the three providers**:

1. Foreground, selected: test a message in the actually viewed conversation and
   in a different conversation. Selection alone must not suppress the latter.
   A matching visibly read Discord message can suppress a redundant toast;
   Synology's unverified conversation tags use conservative delivery.
2. Foreground, different service selected: expect an unread dot on the originating
   service and one native toast, subject to saved preferences.
3. Background, selected and non-selected: expect the same unread/toast behavior.
4. Minimized, selected: leave the active conversation open, send a new message,
   and wait through provider marker removal/focus changes. Verify the unread dot
   persists and a native Windows toast is delivered even if the WebView remains
   logically focused. Repeat with a different service selected.
5. Restore/select without reading: verify unread persists. Interact with the actual
   latest conversation, then verify a genuine empty provider state clears it.
   Test historical scroll position, conversation/header/sidebar clicks, reload,
   reconnect, missing/virtualized sidebar and conversation replacement.
6. Make two different providers unread simultaneously. Read one; verify the
   other's dot and aggregate title/tray/taskbar state remain unread. Repeat with
   two separate instances of the same provider.
7. Mute one service and send to it and an unmuted service. The muted service may
   remain unread but must not toast; the other must retain its saved behavior.
8. Send distinct consecutive messages and identical-content messages with
   cooldown zero. Verify each real browser event is delivered once; repeated DOM
   mutations and duplicate native callbacks must not replay it.
9. Click the originating service's toast while another service is selected.
   Repeat foreground, background, minimized and close-to-tray. Verify the existing
   main window is shown, unminimized and focused **before** selecting the origin;
   verify keyboard input works and no second process/window appears. Activation
   itself must not acknowledge unread. Removed/disabled services must not return.
10. Repeat privacy modes, sound disabled, permission denial, provider-side mute,
    network reconnect and Windows Do Not Disturb. Test Discord DM-only/no-guild
    and virtualized guild layouts explicitly: unknown aggregate state currently
    retains cached unread rather than manufacturing a global zero.

### Local development build and Settings inspection

See [BETA4_RELIABILITY.md](BETA4_RELIABILITY.md) for the build path, exact commands
and automated results. Close other ChatPlus instances before launching the
candidate so single-instance activation cannot reopen an older build. The build
uses existing application profiles; no profile copying or migration is required.

Visually inspect all six Settings sections and the persistent 30-pixel footer at
1366×768, then 1920×1080 and native 100%/125%/150% scaling. Check EN/PL/ES,
keyboard navigation, Save/Close, notifications for all three target providers,
muted Console/Donate with Coming soon tooltips, Report issue and About. These
native visual checks are **PENDING**; prior browser fixture results are historical.

The updater implementation is unchanged in beta.4. Existing signed updater,
installed profile/login-retention and stable-release acceptance gates remain open.
No tag, publication, installer release or stable release is implied by this build.

## Current reliability pass (2026-10-07)

Status: **PENDING MANUAL WINDOWS ACCEPTANCE**. Unit tests, compiled COM hooks and
production assets do not establish these results. Record app commit/build, Windows
version, WebView2 version and provider/server version for each run. Use dedicated
private test conversations and consenting test accounts; keep accounts, messages,
URLs, profiles and screenshots containing private information outside Git/reports.

Enable global desktop notifications and the target service's saved notification
preference. Enable provider notifications and allow Windows notifications. Disable
Do Not Disturb for the initial banner test, then repeat with it enabled. The legacy
conversation cooldown is no longer an active delivery control. Check existing saved
mute preferences explicitly after upgrading. Previously activated provider sessions
may notify when hidden; activate each tested service once before testing it.

### Synology ChatPlus

1. Select ChatPlus and open a known private conversation at its newest messages.
2. Minimize the native ChatPlus Desktop window while that conversation stays loaded.
3. Send one message from the controlled second account.
4. Confirm exactly one eligible native Windows toast (and Notification Center entry).
5. Restore without interacting with the conversation; confirm its service rail dot.
6. Confirm tray unread remains and title/taskbar agree when their preferences are on.
7. Wait or select the same service only: unread must remain; restore alone is no read.
8. Click/scroll within the correct latest message pane, then repeat using the main
   composer to type and successfully send a reply. With provider unread zero,
   confirm the stale native latch clears after genuine engagement in both cases.
9. Confirm rail and aggregate/tray clear together when no other service is unread.

### Synology Chat

1. Select Synology Chat and open a known private conversation at its newest messages.
2. Minimize ChatPlus Desktop while that channel remains selected/loaded.
3. Send one ordinary message (not just a mention) from the controlled second account.
4. Confirm exactly one eligible Windows toast and Notification Center entry.
5. Restore only; confirm the Synology Chat rail dot persists.
6. Confirm tray/title/taskbar unread persists when presentation is enabled.
7. Select the service or focus its child view without conversation input: no clear.
8. Click/scroll the correct latest message pane, then repeat with its sibling main
   composer to type and successfully reply. With reliable provider zero, unread clears.
9. Confirm the service dot and final aggregate/tray clear together. Repeat with
   collapsed/starred groups and ordinary-unread rows whose mention count is zero.

### Discord

1. Select Discord and open a controlled DM/channel at its newest messages.
2. Minimize ChatPlus Desktop while Discord retains its selected conversation.
3. Send one message from the controlled second account.
4. Confirm one eligible native toast; provider DND/mute must permit browser emission.
5. Restore only and confirm Discord's rail dot remains.
6. Confirm tray/title/taskbar remain unread when presentation is enabled.
7. Select/focus Discord only: no acknowledgement.
8. Click/scroll its actual latest message pane, then repeat with the scoped channel
   composer to type and successfully reply. Confirm accepted reliable read/zero proof
   clears the stale latch; unrelated guild/DM unread must remain.
9. Confirm rail and final tray aggregate clear together. Repeat DM-only, muted DM,
   collapsed guild and request/spam layouts; incomplete zero remains unknown and must
   be reported distinctly, without claiming global read parity.

### Multi-provider and rejection cases

1. Activate two providers, minimize, then receive one message in each.
2. Confirm both rail dots and unread tray aggregate.
3. Restore/read one conversation with valid evidence: only its dot clears.
4. Confirm the other service stays unread and tray remains unread.
5. Read the second: rail, aggregate and tray clear immediately together.
6. Repeat with another service selected, native window backgrounded, hidden to tray
   and auxiliary Settings/About windows open. Child focus must not substitute for
   native main-window foreground.
7. Selection/restore/toast click alone, provider header/sidebar clicks and unrelated
   conversation interaction must not clear the target service.
8. In an isolated developer test session, dispatch synthetic input and replay stale
   foreground-generation packets: neither may clear. Do not fabricate real-provider
   acceptance from developer fixture events.
9. Cause provider unread badges to disappear while backgrounded: native unread remains.
10. Send two distinct consecutive messages, including identical previews: both remain
    eligible, with no content/cooldown deduplication loss. Replay the same exact event
    or duplicate DOM mutations: at most one native toast.
11. Start a native arrival while a read query is pending: older proof cannot clear it;
    completion may retry still-current trusted proof, without a timer-based clear.
12. Repeat global-off, service mute, provider mute, Windows denial, sound off and each
    Full/Sender/Generic privacy mode. Mute must not independently clear unread.

### Toast activation

1. Minimize or hide the existing ChatPlus process and receive a controlled message.
2. Click its Windows toast.
3. Confirm that same process/window becomes visible, unminimized, foreground and focused.
4. Confirm the originating enabled service activates, including an initially inactive
   service. No second process/window appears and no unverified conversation route is used.
5. Confirm unread persists after activation alone; genuine current conversation
   engagement clears afterward. Repeat with two services and a local test toast.

### PDF and attachment downloads

Use real provider download controls and both regular/same-origin-blob attachment
popups where available; use Discord's actual signed CDN attachment URL without copying
it into a report. Keep authentication in the provider profile.

1. Download PDF, ZIP, TXT, PNG/JPEG and supplied Office formats (DOCX/XLSX/PPTX).
2. Download a PDF named `Quarterly report.pdf`: verify native save/download UI,
   final extension/spaces and unchanged file bytes against a known test file.
3. Download URL-encoded and Unicode filenames (for example `Budget%20report.pdf`
   and a non-ASCII name) and a provider Content-Disposition filename; verify decoded,
   safe name and extension. Confirm filename handling in the actual browser pipeline.
4. Download the same attachment twice and from two service profiles simultaneously:
   existing bytes remain untouched; a unique `(n)` filename is used.
5. Download an attachment requiring the already-authenticated session; it must work
   without re-entering credentials or moving cookies into a desktop HTTP request.
6. Confirm default folder and Save As location follow native WebView2 policy. Cancel
   before/during transfer: cancellation is graceful and another download can start.
7. Test failed/expired links, network interruption and retry; native UI exposes the
   error, shell startup failure is generic and no private URL/filename is logged.
8. Verify inline PDF/image popup preview and use its native download button. The
   originating provider view stays loaded; popups receive no desktop IPC permission.
9. Confirm files are never opened/executed automatically, Windows security warnings
   remain available, and no automatic-download/security protection is bypassed.

The implementation uses DownloadStarting with native handling retained, not a custom
HTTP downloader. Native dialogs, authenticated transfer and actual Content-Disposition
resolution have not been manually verified for this revision.

### Updater and desktop layout

- Enable optional automatic checks: one startup check after ten seconds, then at most
  six-hour attempts; manual check remains usable, and offline automatic failure is quiet.
- Check Stable versus Pre-release eligibility and channel changes during check/download.
- Use an authorized signed installer for download/cancel/signature rejection and explicit
  install/restart acceptance; preserve profile/login data. This checklist does not
  authorize making a tag, publishing an artifact or changing signing keys.
- Verify tray open/hide/restore, close/minimize-to-tray preferences and app exit.
- Inspect EN/PL/ES Settings, update notes, rail and footer at 1366x768 and larger/minimum
  windows, light/dark/system appearance and actual 100%/125%/150% Windows monitor DPI.
- Verify native menus, keyboard focus/scrolling, long service names and accessible unread
  labels. Historical rendering emulation is not a monitor-DPI acceptance result.

| Area                                                                       | Current manual result |
| -------------------------------------------------------------------------- | --------------------- |
| Synology ChatPlus A-K, foreground/background/minimized and reply clearing  | PENDING               |
| Synology Chat A-K, ordinary unread, composer and reply clearing            | PENDING               |
| Discord A-K, guild/DM constraints, mute and reply clearing                 | PENDING               |
| Two-provider rail/tray aggregation and native toast activation             | PENDING               |
| Real authenticated files, names, cancel/expired/security/native Save As    | PENDING               |
| Signed updater installation/restart and upgrade session retention          | PENDING               |
| Native permissions, privacy/sound/DND, actual DPI/resolution/accessibility | PENDING               |

Attach only privacy-safe [diagnostics](NOTIFICATIONS.md#privacy-safe-diagnostics) and
safe reproduction steps to reports; keep observed, failed and pending results explicit.
