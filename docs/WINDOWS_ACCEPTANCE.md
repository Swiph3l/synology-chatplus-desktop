# Windows acceptance — 2026-10-01 follow-up

Recommendation: **NOT READY FOR RC AUDIT**.

The requested rail/form refinements and experimental Discord implementation are
complete in separate local commits. This report records acceptance evidence and
remaining manual gates; it does not classify unobserved behavior as passing.
Development remains **0.5.0-beta.2**. Nothing was pushed, tagged, published or bumped
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
