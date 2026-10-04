# Beta.4 notification reliability — 2026-10-04

This report covers the **0.5.0-beta.4 development candidate** following `283b9fb`.
Implementation and automated checks are separate from real Windows acceptance.
The user explicitly requested that live acceptance remain pending and that the
current build be ready for local Settings inspection. No tag or publication is
authorized or performed. The updater implementation is unchanged.

## Causes and resulting behavior

The desktop previously enabled unread/native notification capabilities only for
ChatPlus. Synology Chat and Discord had no independent DOM read adapter. The
selected foreground service also suppressed native notifications without proving
which conversation the user could actually see. Logical child-WebView focus can
survive top-level minimize/background, and provider badge removal is insufficient
to establish a genuine read transition.

Each configured service now owns its cached unread independently. The dedicated
adapter reports its own source; the native bridge rejects a different provider's
source. Positive evidence latches unread. Unknown, missing, virtualized or partial
UI retains the cache. A global zero clears cached unread only with trusted input
inside a proven conversation, at its latest messages, with current native
foreground visibility and a matching context/generation. Selection, window focus,
sidebar/header clicks and title changes do not acknowledge read. Scroll input can
acknowledge after the viewport reaches the latest message.

Native notification suppression additionally asks the originating provider whether
the exact event is visibly viewed. Query results are revalidated against native
visibility, active service and configuration. Missing, malformed, timed-out and
unknown evidence permits delivery. The two-second bound limits renderer IPC;
it is not an unread-clear debounce. COM notification/deferral objects remain on
their owning WebView UI apartment; callback/failure/timeout compete for one record.

New arrivals revoke old gestures. Native arrival order and visibility generations
are separate so overlapping valid viewing queries remain valid. Read proof cannot
acknowledge an arrival whose renderer query is still pending: a gesture in the
old conversation pane must not cancel an unseen message. Native unread events
additionally require exact per-event proofs, including completed/out-of-order
queries and missed projections. The renderer retains bounded notification tags
for later trusted read retries; background queries return false for suppression
while retaining that local evidence. Only numeric arrival tokens return through
unread IPC, not message text or conversation IDs. A later genuine read with
complete provider zero and exact message proof can acknowledge the observed
arrival without a duplicate callback resurrecting it.
Preview/tag getter failure and unavailable deferral use conservative delivery
fallbacks rather than discarding a trusted notification.

Read-only queries never mint lasting read proofs. Each trusted gesture recomputes
the exact visible-message subset, and native acceptance alone retires those
retained tags. Reading one event progresses while other messages remain unread;
unknown aggregate UI sends a proof-only packet that cannot change the boolean.
Native state keeps unlisted/pending arrivals unread and confirms only accepted
IDs. A rejected foreground snapshot cannot reuse stale proof in another conversation.

Canonical browser-event identity is retained in a bounded, service-specific
history, independently of cooldown. Multiple DOM mutations never create native
toasts. Distinct real events with identical content are eligible at cooldown zero;
configured cooldown remains intentional delivery policy. Global and per-service
mute/privacy/sound settings remain authoritative. Previously saved false service
preferences remain false, including provider changes: explicitly enable the newly
supported service when testing. Profile IDs, directories and migration are unchanged.

## Independent provider audit

| Provider          | Unread/badge evidence                                                                                                                                                    | Real read/view evidence                                                                                                                                                                              | Title/focus and limits                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synology ChatPlus | Existing authenticated-layout evidence and project theme selectors: `sidebar-tab-item-*` / `tab-item-indicator`; aggregate boolean, no total                             | One visible non-thread viewer, proven native scroll viewport at the latest message and trusted conversation input; pane/route/content replacement revokes proof                                      | Flashing title previews are excluded; focus/selection alone cannot clear. No verified tag-to-conversation mapping, so foreground toasts use conservative delivery. Current private web bundle remains unaudited.                                                      |
| Synology Chat     | Independent Chat 2.2 primary templates: outer channel-row `highlight` includes ordinary unread; numeric group/channel badges are mentions and Starred duplicates         | `#channels/...`, visible `.chat-msgview`, real `.msg-wrap[data-post-id]`, physically visible transformed scroll end and hidden newest-button; loading/partial groups are unknown                     | ActiveDetector uses `document.hidden` and visibility changes to gate upstream read activity. The dedicated public visibility projection follows native foreground state. Compiled server decisions for notification creation remain unverified.                       |
| Discord           | Scoped public guild/DM navigation, unread pills and renderer label suffixes; selected/hover pills and media badges excluded; global zero requires complete list metadata | Current route/channel and actual `chat-messages-CHANNEL-MESSAGE` rows, unobscured viewport at latest, current composer/viewport gesture. Notification tag is message ID and must match a visible row | Public renderer suppresses message notifications while logically focused. Dedicated public `document.hasFocus`/focus-event projection reflects native foreground, without private stores/APIs. No-guild/DM-only or incomplete virtualized layouts can remain unknown. |

Boolean state deliberately avoids invented counts from mentions, overlapping groups
or rendered rows. Both Synology adapters revoke proof if the same pane is detached
and reinserted; cosmetic focus class/style changes do not invalidate useful input.
Provider notification-like navigation DOM is used only as unread evidence, never
as a synthetic toast source. Observation bursts are coalesced with a microtask.
The adapters install at document creation and tolerate the body not yet existing.

Primary audit artifacts were read outside the repository; no vendor bundle,
credentials or profile content was committed:

- [Official Chat 2.2.0-1432 package](https://global.synologydownload.com/download/Package/spk/Chat/2.2.0-1432/Chat-x86_64-2.2.0-1432.spk),
  SHA-256 `72d406e88f09875c0fdf006d5828fb34f0101445eacff68e1fbd33155cb6f19e`.
  The independently inspected templates, ActiveDetector, LastViewAtUpdater,
  Notification utility and public socket activity flow establish the legacy rules.
  Chat 2.4.7/ChatPlus 1.0 packages could not be read as ordinary archives; no
  decryption or access-control bypass was attempted. Current server markup needs
  manual acceptance. The official desktop client package only loads remote UI.
- [Discord public web bundle](https://discord.com/assets/web.24a0dd4254453b09.js),
  SHA-256 `d141f126a87e0e4c49898f95c71b467641fe7e26022da5abcec663c104f3afcb`:
  public focus initialization/events, notification eligibility, selected-channel
  preferences, message-ID tags and navigation unread/mention/media presentation.
- [Discord public message viewport bundle](https://discord.com/assets/739c29133b0fdbcc.js),
  SHA-256 `e44441443c591cc4cb98e001c9f542c1e4ce27490e30b24b72999eea349c22cc`:
  actual row identifiers, jump-to-present/history/error surfaces and bottom tolerance.
  [Discord's notification preference guidance](https://discord.com/blog/how-to-manage-your-discord-desktop-notifications)
  documents provider settings that independently control eligibility.

Live marker behavior on focus/selection and real upstream read/notification
transitions remain pending for all three providers; primary code and sanitized
fixtures are not an authenticated Windows test.

## Windows toast activation

The existing native activation path is preserved: dispatch to the main UI thread,
show/unminimize/focus the existing main window, then activate the originating
configured service. Test toasts restore the current service. Removed/disabled
services are not recreated. Activation itself does not acknowledge unread. The
browser tag does not provide a verified safe navigation payload for all providers,
so no new conversation URL is invented and no new process/window is created.
Regression tests exercise activation order and policy; real Windows activation
and keyboard focus remain pending.

## Regression coverage and review

New/expanded coverage includes all three provider sources, minimized selected
services with logically focused views, different-service foreground policy,
independent simultaneous unread, clearing only the read service, saved mute and
profile preferences, stale visibility/gesture replies, unknown/partial DOM,
thread/historical/covered viewports, native-overflow versus wrapper geometry,
hidden ordinary Synology unread, pane detach/reinsert, document-creation startup,
public focus/visibility lifecycle, exact Discord message tags, duplicate events,
distinct identical messages, failed delivery retry, bounded query completion and
arrival/read ordering. Existing updater signature/channel/concurrency fixtures
remain in the unchanged full regression suites.

Independent native and provider reviews found and corrected metadata/deferral
fallbacks, partial Synology group zero, same-pane reconnection context and the
pre-render acknowledgement race, including avatar mutations and older-message
rendering that cannot establish a newer event's presence. Histories are bounded
at 256; saturation retains unread instead of silently dropping proof.

**Automated tests PASSED** and **code review PASSED** for this bounded conservative
policy. Native and provider reviewers found no remaining unsafe-clear race in the
final code. This review does not assert automatic read-clear parity or authenticate
the current provider servers. **Manual Windows acceptance PENDING**.

| Check                                                           | Result                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm.cmd test`                                                  | PASS: 152 passed, zero failed/skipped; rerun after version synchronization                       |
| Locked Rust debug tests                                         | PASS: 105 passed, zero failed, one expected ignored production artifact signature fixture        |
| Locked Rust release tests                                       | PASS: 105 passed, zero failed, the same expected ignored fixture                                 |
| `cargo fmt --check` and Git whitespace checks                   | PASS                                                                                             |
| Frontend formatting, TypeScript, Vite and both bootstrap builds | PASS                                                                                             |
| `npm.cmd run check:release`                                     | PASS                                                                                             |
| `npm.cmd run tauri -- build --debug --no-bundle`                | PASS: Windows x64 development executable with embedded UI; no installer or updater artifact      |
| Six-value repository identity                                   | PASS: expected `v0.5.0-beta.4`; no tag created                                                   |
| `npm.cmd audit --json`                                          | PASS: zero vulnerabilities                                                                       |
| Cargo audit with the refreshed 2026-10-04 RustSec database      | PASS: zero vulnerabilities; six existing unmaintained warnings and one Linux-only warning remain |
| Cargo deny advisories/bans/licenses/sources                     | PASS: zero policy errors; 20 existing duplicate warnings and two unused license entries          |
| Staged-diff Gitleaks scans                                      | PASS: no leaks                                                                                   |
| Native/provider lifecycle and integration review                | PASS for conservative exact-event ownership, visibility and partial-read policy                  |

The final Rust test logs are `Workspace/beta4-validation/cargo-test-debug.log` and
`cargo-test-release.log`; frontend results are in `frontend-tests.log`. These Rust
suites cover the completed implementation before the version-only beta.4 update.
`cargo check --locked` also passed after beta.4 version synchronization; its log
is `Workspace/beta4-validation/cargo-check.log`.
Dependency audit output remains in the reused `Workspace/beta3-validation`
directory, timestamped 2026-10-04; dependency versions have not changed. The Linux
review wrapper still reports **REQUIRES REVIEW** for `glib 0.18.5` /
`RUSTSEC-2024-0429`, absent from the Windows graph. The existing Linux release gate
has not been weakened.

## Validation commands and local build

Run commands from the repository root. PowerShell uses `npm.cmd` because local
execution policy disables `npm.ps1`. Load the existing Windows Rust/MSVC toolchain:

```powershell
$beta4Toolchain = Get-Content -LiteralPath '..\Tools\dev-env.ps1' -Raw
Invoke-Expression $beta4Toolchain
$env:CARGO_TARGET_DIR = 'E:\chatplus_synology_client\Workspace\beta3-validation\cargo-target'
```

The reused Cargo target is a build cache, not a beta.3 source/build assertion.
Validation logs and the runnable development binary belong in
`Workspace/beta4-validation` outside the repository. The build command is
`npm.cmd run tauri -- build --debug --no-bundle`; it embeds the current production
UI and both provider bootstrap assets, uses the locked Cargo graph and creates
no installer or signed updater artifacts. It requires no Vite server to launch.
About intentionally displays an untagged development version with commit suffix.

Launch `E:\chatplus_synology_client\Workspace\beta4-validation\dev-build\ChatPlus-beta4-dev.exe`.
The adjacent `BUILD_MANIFEST.json` records its exact source commit, display version,
SHA-256 and executable size. `LAUNCH.md` provides local instructions. The final
binary is built again from the clean documentation commit so About identifies that
revision. The unsigned debug executable is for local inspection; it was not
launched or visually accepted in this pass. Build output is in `dev-build.log`.

Close any existing ChatPlus process before launching the candidate; otherwise
the single-instance mechanism can activate that older process. Open Settings
using the native menu or footer About action. Follow the EN/PL/ES and 1366×768
visual checklist in [Windows acceptance section 20](WINDOWS_ACCEPTANCE.md#20-2026-10-04-beta4-provider-reliability-acceptance).
Actual native Settings geometry and Windows notification delivery remain pending.

## Files, commits and version identity

Code changes are limited to provider adapters/common unread coordination,
native notification/read guards, provider capability declaration, service mute
controls/translations and independent bootstrap generation. Tests are colocated
with Rust modules and in the frontend provider/unread/service suites. Generated
JavaScript, production assets, vendor sources and executables stay out of Git.

- Adapters/coordinator: `src/theme/providers/{types.ts,dom.ts,chatplus.ts,synology-chat.ts,discord.ts}`,
  `src/theme/{provider-unread.ts,unread.ts,bootstrap.ts}`.
- Native state/delivery/integration: `src-tauri/src/{unread.rs,notification_bridge.rs,desktop_notifications.rs,providers.rs,services.rs,menu.rs}`,
  `src-tauri/build.rs`.
- Service controls/resources: `src/app/providers.ts`, `src/settings/services.ts`,
  `src/i18n/{en.json,pl.json,es.json}`.
- Build/test plumbing: `.gitignore`, `scripts/build-theme.mjs`,
  `tests/{unread.test.mjs,synology-adapters.test.mjs,discord-unread.test.mjs,provider-bootstrap.test.mjs,service-settings.test.mjs}`.
- Documentation: `README.md`, `CHANGELOG.md`,
  `docs/{BETA4_RELIABILITY.md,PROVIDERS.md,NOTIFICATIONS.md,WINDOWS_ACCEPTANCE.md,WINDOWS_BETA.md,DEVELOPMENT_STATUS.md}`.
- The five source/version files listed below; only the app's own versions change.

After implementation validation, source identity is synchronized to beta.4 in
`package.json`, both root/package values in `package-lock.json`,
`src-tauri/Cargo.toml`, the app package entry in `src-tauri/Cargo.lock`, and
`src-tauri/tauri.conf.json`: six values in five files. Dependency versions are
unchanged. The release identity helper verifies `v0.5.0-beta.4` as an expected
identity; it does not create that tag.

| Commit    | Change                                                                      |
| --------- | --------------------------------------------------------------------------- |
| `80a5bab` | Dedicated Synology and Discord unread adapters and provider fixtures        |
| `4920eeb` | Reject incomplete provider read evidence                                    |
| `5fa236c` | Native notification reads, exact-event ownership and bounded completion     |
| `3d216d1` | Per-service lifecycle integration, mute controls, bootstrap and regressions |
| `1f85e28` | Synchronized beta.4 identity and accurate changelog                         |

The documentation commit contains this report, the provider audit and explicit
manual matrix. Full commit hashes are available with `git log 283b9fb..HEAD`.

## Remaining risks and manual status

**Manual Windows acceptance PENDING**: Synology ChatPlus, Synology Chat and Discord
notifications; minimized active-conversation behavior; unread dot persistence;
native Windows toast delivery; click restoring ChatPlus and activating its
originating service; and the new Settings/footer visual inspection. No live
notification behavior is marked verified. Use the explicit per-provider matrix
and controlled instructions in [WINDOWS_ACCEPTANCE.md](WINDOWS_ACCEPTANCE.md#20-2026-10-04-beta4-provider-reliability-acceptance).

Provider layout changes, missing/virtualized/no-guild navigation and incomplete
read proof retain cached unread conservatively. **Known candidate limitation:**
ChatPlus and Synology Chat have no audited exact notification tag mapping, so
native-arrival unread can remain after actually reading until app restart
reobserves provider state. Discord's incomplete/selected/muted/private/request
navigation can similarly prevent a global zero, despite a message being viewed.
Automatic read-clear parity is not claimed. Restart does not replay native toasts
or persist desktop counts. Provider/server mute, permissions, Windows policy or notification
preferences can prevent upstream browser events; there is no synthetic DOM-toast
fallback. Synology foreground toasts can be redundant without a verified tag map.
Installed login/profile retention, Windows DPI, signed production update/restart
and the existing Linux dependency-review gate remain open. These changes do not
establish stable release readiness.
