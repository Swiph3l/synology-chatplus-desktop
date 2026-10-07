# Reliability and maintainability pass - 2026-10-07

Development remains **0.5.0-beta.4**. This report covers local changes after
`79cd4e4`. Automated tests/builds passed; authenticated provider and native Windows
acceptance remain pending. No release was prepared or published.

## 1. Sticky unread root causes

Both Synology adapters deliberately lack reliable notification-tag mapping, but
the shared lifecycle required exact arrival/tag proof to retire native unread.
An empty provider sidebar therefore could not clear retained browser arrivals.
The main Synology composers were also excluded from conversation interaction.
Bounded-history overflow had no recovery through reliable provider zero.

Review additionally reproduced the case where trusted typing beat the native
notification query: its acknowledgement could be rejected while the arrival was
pending and never retried. Completion now retries only the still-current gesture.

## 2. Sidebar/tray disagreement root causes

Provider DOM zero and native retained unread could disagree because of those
different proof requirements. Desktop presentation also read service/aggregate
state separately and accepted unordered snapshots. A delayed event could restore
an old rail dot; interleaved native updates could apply an older tray/title state.
The stale frontend event is reproduced in fixtures; the native interleaving was
identified by source review, not observed through a live Windows tray test.

## 3. Authoritative architecture

Rust owns one per-service unread record: hasUnread, optional reliable count,
transition generation, source, lastArrival, lastReadEvidence and lastUpdate.
Counts remain unavailable for the currently audited ambiguous provider evidence.
Provider DOM and browser events are inputs. Toast submission never defines unread.
Proof tracking stores arrival/acknowledgement evidence rather than another UI truth.

The shell receives `{ revision, services, aggregate }` and rejects older revisions.
`aggregate.hasUnread = any(enabled service hasUnread)`. Snapshot acquisition and
title/taskbar/rail-event/tray application run together on the native UI thread.
Tray-only refreshes also acquire current state on that thread. Preferences can
hide presentation without changing state. Unread is memory-only, not persisted.

## 4. Exact read acknowledgement rules

A read requires the selected enabled service, native **visible && focused &&
!minimized** state, current presentation generation, trusted conversation/composer
input and unchanged active conversation/content context at its visible latest pane.
Click, meaningful keyboard input, beforeinput/input and foreground wheel interaction
can qualify through provider-specific selectors.

Reliable provider-wide zero plus that engagement retires completed arrivals without
notification tags. A positive/unknown provider aggregate permits only exact
individually viewed arrival proofs, preserving other unread. Pending arrivals cannot
clear early. Completion retries valid pending gestures; navigation, content changes,
new arrivals, service/foreground changes and stale generations revoke them.
Current provider zero can safely recover saturated proof history.

Selection, restore, child/document focus, toast click, synthetic input, header/sidebar
clicks, unrelated conversation activity and background badge disappearance cannot
acknowledge unread. Typing/sending uses trusted composer engagement and reliable
read/zero proof; no unaudited successful-send callback is claimed. Incomplete or
changed provider markup can still conservatively retain unread.

## 5. Provider changes

| Provider          | Change and evidence limits                                                                                                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synology ChatPlus | Its unique main latest viewer and audited message-create textarea now share read context. Trusted typing/click/read plus complete zero can retire unmapped arrivals. Current authenticated server DOM still needs acceptance.                                                                         |
| Synology Chat     | Independent legacy Chat selectors retain ordinary-unread highlights and complete-group zero rules. The sibling main editable composer is now mapped; public Chat 2.2 source evidence supports this shape. Current server versions still need acceptance.                                              |
| Discord           | Existing guild/DM, route, editor, latest-view and exact message-snowflake proofs are preserved. Complete-zero reads and pending-proof retries join the shared lifecycle. Native notifications, service activation and mute are supported integration scope; general provider UI remains experimental. |

Slack and Mattermost web-session capabilities were not expanded. See
[provider integration](PROVIDERS.md) for source references and limitations.

## 6. Native Windows notification behavior

New native browser events latch unread immediately, before the asynchronous view
query, regardless of selection or loaded conversation. Background/minimized events
are eligible for toast submission subject to global/service mute and Windows
permission, plus exact event deduplication. Foreground suppression requires current
originating-message viewing proof. Distinct identical-preview messages remain
distinct events; conversation cooldown no longer suppresses them. Failed submission
can retry its own event without releasing a newer reservation.

Activation remains on the existing UI thread/process: show, unminimize, foreground,
focus and activate the originating enabled service. It does not clear unread or
invent an unaudited conversation destination. Removed services are not recreated.
Submission success is not proof Windows displayed a banner.

The existing Copy diagnostics action includes the last 128 memory-only typed events:
arrival/latch, read candidate/accepted/rejected/cleared and toast
submitted/suppressed/activated. Fields are service ID, provider, native foreground,
selected, generation, fixed reason and timestamp. Message bodies, notification tags,
credentials, cookies/tokens and private URLs are excluded. Toast events use arrival
generation for correlation; read candidates use presentation generation.

## 7. PDF and attachment implementation

Native WebView2 DownloadStarting/StateChanged handling preserves the engine's
authenticated transfer and default download UI. Tauri/Wry's generic callback was
not used because it sets Handled=true and hides that UI. The browser resolves
Content-Disposition/filename* and its default destination; no custom HTTP client
extracts cookies or credentials.

Suggested names decode escaped bytes once, preserve Unicode/spaces/extensions,
sanitize Windows/path/bidi/device-name hazards and bound UTF-16 length. Existing
files and case-insensitive in-flight reservations produce distinct numbered names
across profiles. Completed/cancelled/non-resumable failed operations release their
reservation; paused/resumable failures retain it. Native controls handle save,
cancel/retry and security warnings. Guard/setup failures use safe application errors.
No download is automatically executed or opened.

Restricted Discord attachment-CDN and same-origin blob popups use the opener's
WebView2 environment/profile and have no native IPC capabilities. The shell/provider
stay loaded. Actual authenticated transfer, PDF UI, Save As, cancellation and
expired-link behavior are explicitly untested here; see acceptance below.

## 8. Dependency upgrades applied

| Dependency                | Resolved before to after                                            |
| ------------------------- | ------------------------------------------------------------------- |
| Rust Tauri                | 2.11.5 to 2.11.6 security backport; normal/dev requirements ~2.11.6 |
| Tauri CLI                 | 2.11.4 to 2.11.5; stays on ~2.11.5                                  |
| @types/node               | 22.20.2 to 22.20.5                                                  |
| esbuild                   | 0.28.1 to 0.28.2                                                    |
| Prettier                  | 3.9.6 to 3.9.9                                                      |
| Vite                      | 7.3.6 to 7.3.7                                                      |
| source-map-js, transitive | 1.2.1 to 1.2.2 security fix                                         |
| CodeQL Action             | full-SHA pin v4.38.0 to v4.38.2                                     |

Lockfiles were updated. No application API migration, new runtime dependency,
signature/TLS relaxation, updater key change or release-trigger change was required.
[Dependency policy](DEPENDENCY_POLICY.md) includes official advisory/release sources.

## 9. Deliberately deferred upgrades

Tauri 2.12 and its newer plugin/native notification ecosystem require coordinated
windows 0.62/webview2-com 0.39 migration and higher MSRV; the security fix is available
on the retained 2.11 line. Updater/signing changes need signed install/restart
acceptance. TypeScript 6/7, Vite 8, Node/types majors, Tauri 3 alpha and Actions majors
need separate migration/runner validation. Tokio's compatible patch has no reproduced
application defect motivating churn. winreg/minisign API changes need focused review.
Existing Linux glib and transitive maintenance debt remains documented under the
original narrow policy; nothing was hidden by a new advisory ignore.

## 10. Documentation added or reorganized

Added DEVELOPMENT, ARCHITECTURE, TESTING and UPDATER. Updated NOTIFICATIONS,
PROVIDERS and WINDOWS_ACCEPTANCE, plus DEPENDENCY_POLICY and UPDATER_SIGNING.
Historical investigation/status documents and screenshot provenance remain linked.
CONTRIBUTING now matches Windows CI and includes the Swiph3l why-comment convention,
provider/privacy requirements and focused PR expectations. Concise bug/feature/PR
templates were added. This report records current validation separately from beta
history. No historical investigation was deleted.

## 11. README improvements

The first screen explains the unofficial Synology ChatPlus/Synology Chat Windows
client, multi-service purpose, badges and truthful provider status. Features,
GitHub Releases, stable/pre-release choice, installation, privacy, screenshots with
provenance/alt text, contributing and safe bug reporting are easy to find.
Developer details link to dedicated guides. Changelog entries describe user behavior
and preserve: Thanks to Azathoth for reporting the update-dialog scrolling issue.

## 12. Proposed GitHub description

Unofficial open-source Windows desktop client for Synology ChatPlus and Synology
Chat, with multi-service messaging, Discord and tray notifications.

## 13. Proposed GitHub topics

synology, synology-chat, chatplus, synology-nas, windows, windows-app, desktop,
desktop-client, tauri, webview2, self-hosted, messaging, discord, mattermost,
open-source. These are recommendations; repository settings were not modified.

## 14. Regression tests

Frontend coverage exercises independent provider selectors/composers, trusted versus
synthetic input, correct/latest conversation context, retained child focus,
minimized/restore/switch transitions, provider zero, exact/unknown/partial proofs,
completion retries, stale generations, saturated history and native rail snapshots.
Native tests cover immediate latching, pending-zero rejection/retry, aggregate
invariants after transitions, saturation boundary acknowledgement, typed bounded
diagnostics, exact event delivery/retry/mute/permission policy and activation policy.

Six download tests cover formats/spaces/Unicode/escaped names, security boundaries,
real existing-file bytes, eight simultaneous reservations, strict CDN/blob routes and
cancel/failure/resume/terminal cleanup policy. They interpret native lifecycle state,
not a real authenticated download. The exact A-K matrix is mapped in
[TESTING.md](TESTING.md#notification-transition-matrix) and manual acceptance.

## 15. Exact validation results

| Check                                                  | Result                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| npm test                                               | PASS: 196 passed, 0 failed/skipped                                                                                  |
| TypeScript and Prettier                                | PASS: typecheck and format:check                                                                                    |
| Production frontend and both bootstraps                | PASS: npm run build                                                                                                 |
| Release asset guard                                    | PASS: development fixture excluded                                                                                  |
| Rust debug tests                                       | PASS: 118 passed, 0 failed, 1 expected ignored production artifact/signature fixture                                |
| Rust release tests                                     | PASS: 118 passed, 0 failed, same expected ignored fixture                                                           |
| cargo check --locked; cargo fmt --check                | PASS for Windows x64 MSVC                                                                                           |
| Tauri build --debug --no-bundle                        | PASS: Windows development executable with embedded UI; no installer/updater artifacts                               |
| npm audit                                              | PASS: 0 vulnerabilities                                                                                             |
| cargo audit, fresh RustSec database                    | PASS with 7 previously documented warnings: six unmaintained notices and Linux glib unsoundness                     |
| cargo deny, original Windows policy                    | PASS: advisories/bans/licenses/sources; duplicate-crate and unmatched license allowance/exception warnings retained |
| Relative Markdown file/image links and heading anchors | PASS: 104 local file/image targets and 24 heading anchors across 25 Markdown files; 0 errors                        |
| Gitleaks new local commits                             | PASS: redacted scan found no leaks                                                                                  |
| Git whitespace                                         | PASS: git diff --check                                                                                              |

The production artifact/signature fixture was not run because no signed production
artifact was created. Existing signed HTTPS updater regressions passed. Hosted
GitHub Actions/CodeQL, installed updater restart and native UI/provider acceptance
were not run. The broken pre-existing cargo-audit cache was left unchanged; a fresh
task-scoped database was used outside the checkout.

## 16. Manual Windows tests still required

[WINDOWS_ACCEPTANCE.md](WINDOWS_ACCEPTANCE.md#current-reliability-pass-2026-10-07)
contains exact steps for each of Synology ChatPlus, Synology Chat and Discord:
active conversation, minimize, receive, confirm toast/rail/tray, restore without
clearing, then trusted click/scroll/type/reply and simultaneous indicator clearing.
It includes two-provider/final-provider reads; synthetic/switch/background-zero
rejection; two legitimate messages versus duplicate event; service/global mute;
toast activation through the existing process without click-to-clear and OS settings;
PDFs, ZIP archives, plain text, images and Office documents, encoded names, authenticated sessions,
existing files and simultaneous duplicates, cancel, pause, resume, failure, expired URLs and Windows
security/no automatic execution; updater and DPI/resolution checks. All remain
pending until performed on actual provider sessions and a Windows installation.

## 17. Files changed

The changes cover the CodeQL workflow and three contributor templates; package/npm
and Cargo manifests/locks; README/CHANGELOG/CONTRIBUTING; the current technical guides
and dependency/signing policy; native unread, notification bridge/policy, diagnostics,
commands, main initialization, services, tray and new downloads module; frontend
unread snapshot, services/settings, shared provider lifecycle and four adapter/type
files; footer/minimized/services/Synology/shared-unread tests and new unread-state
tests. Generated dist/bootstrap and local build/audit output remain ignored or outside
the checkout. Exact inventory:

```text
.github/ISSUE_TEMPLATE/bug_report.md
.github/ISSUE_TEMPLATE/feature_request.md
.github/pull_request_template.md
.github/workflows/codeql.yml
CHANGELOG.md
CONTRIBUTING.md
README.md
docs/ARCHITECTURE.md
docs/DEPENDENCY_POLICY.md
docs/DEVELOPMENT.md
docs/NOTIFICATIONS.md
docs/PROVIDERS.md
docs/RELIABILITY_2026-10-07.md
docs/TESTING.md
docs/UPDATER.md
docs/UPDATER_SIGNING.md
docs/WINDOWS_ACCEPTANCE.md
package-lock.json
package.json
src-tauri/Cargo.lock
src-tauri/Cargo.toml
src-tauri/src/commands.rs
src-tauri/src/desktop_notifications.rs
src-tauri/src/diagnostics.rs
src-tauri/src/downloads.rs
src-tauri/src/main.rs
src-tauri/src/notification_bridge.rs
src-tauri/src/services.rs
src-tauri/src/tray.rs
src-tauri/src/unread.rs
src/app/unread.ts
src/settings/settings.ts
src/theme/provider-unread.ts
src/theme/providers/chatplus.ts
src/theme/providers/discord.ts
src/theme/providers/synology-chat.ts
src/theme/providers/types.ts
src/ui/services.ts
tests/footer.test.mjs
tests/minimized-notification.test.mjs
tests/services.test.mjs
tests/synology-adapters.test.mjs
tests/unread-state.test.mjs
tests/unread.test.mjs
```

## 18. Logical local commits

| Hash    | Subject                                                   |
| ------- | --------------------------------------------------------- |
| 3c052cf | fix: acknowledge genuine provider reads                   |
| f2566dd | fix: support authenticated attachment downloads           |
| 131df5a | fix: retry provider reads after native arrival completion |
| d1e2c43 | test: cover authoritative unread presentation             |
| 5e03096 | chore: apply compatible dependency security patches       |
| 39488e2 | fix: unify unread state and presentation                  |
| 5b20fc3 | fix: stabilize native notification lifecycle              |
| c267849 | docs: reorganize developer and acceptance guidance        |
| 59ee100 | docs: improve user-facing README discoverability          |
| 912743a | fix: release failed attachment download reservations      |
| 7151354 | fix: remove obsolete notification cooldown control        |

The final report commit is listed in the completion message/git log. At the
maintainer's request, author and committer dates for the 12 unpublished commits
after `79cd4e4` were redistributed across 5-7 October 2026 (+02:00). The dates were
assigned for this history layout; development and validation took place on 7 October.
Commit order and implementation content were preserved; this report was updated
with the new hashes and this timestamp note. Published history was not rewritten.

## 19. Working tree

The checkout started clean. All task changes, including this report, are committed;
final git status is clean. Generated build outputs remain ignored.

## 20. Publication boundary

Nothing was tagged, pushed, published or deployed. No repository settings changed,
release/version bump, installer packaging or signing operation occurred. Real Windows
acceptance remains a gate before the next public build.
