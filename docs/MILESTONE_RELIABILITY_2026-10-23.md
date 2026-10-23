# Reliability and provider milestone — 23 October 2026

## Baseline audit before this request's changes

Baseline: `6618985514bfbba2f4c32af9ebb1a032fe0c4219`. This request repeats the
provider milestone and explicitly requires toast activation to leave unread
unchanged until provider/view evidence exists. That supersedes the preceding
iteration's exact local click acknowledgement. No release or tag is authorized.

| Input at baseline                   | Existing transition                                                                                                                            | Required result                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Valid provider browser notification | Validate origin/service/bridge epoch, deduplicate native identity, latch native arrival, query viewing proof, submit native toast under policy | Preserve the distinct unread arrival independently of delivery success          |
| Native foreground/service selection | Project native visibility and selection into public browser focus APIs; refresh one Rust-owned unread snapshot                                 | No global read acknowledgement                                                  |
| Trusted conversation interaction    | Validate active conversation/latest viewport and foreground generation; accept reliable provider zero or exact message proof                   | Retire only proven arrivals; preserve unrelated channels and instances          |
| Windows toast activation            | Validate retained event and configured instance, restore existing service, acknowledge the exact local arrival, call provider `ReportClicked`  | Remove the local acknowledgement; route only, then await provider/view evidence |
| Toast dismissal/timeout             | No unread acknowledgement callback                                                                                                             | Keep unread                                                                     |
| Explicit Synology all-read          | Capture configured instance under the lifecycle guard; acknowledge known local state and project after unlocking                               | Keep the action explicitly local                                                |
| Explicit Discord current-read       | Require active foreground conversation and exact renderer viewing evidence                                                                     | Keep other messages/channels unread                                             |
| Explicit Discord Inbox-read         | Bounded public Inbox/Unreads control flow, scoped errors/identity checks, fresh provider-zero evidence and captured native boundary            | No guessed remote success or clearing newer arrivals                            |
| Partial/missing WhatsApp DOM        | Dedicated positive badge adapter; missing/virtualized/filtered lists remain unknown                                                            | Never infer provider-wide zero                                                  |

The native notification permission path distinguishes Windows sender availability,
saved global/per-service preferences, browser-origin permission and actual submission
results. A browser `denied` value must not overwrite saved desktop preferences.
The Windows browser Notification constructor is retained; replacing it with Tauri's
IPC polyfill would bypass the remote WebView notification bridge. Other platforms
use the registered Tauri notification plugin.

Provider sessions use stable service IDs and isolated profile directories. WhatsApp
already exists in both registries, uses the official URL and normal WebView2
identity, bundles provider artwork, supports multiple isolated instances, and is
labelled Experimental in all seven locales. Current/all WhatsApp read actions are
hidden because no safe authenticated UI operation has been verified. The current
integration does not collect credentials, QR secrets, contact lists or history.

Existing theme/bootstrap and provider audits are being checked against actual source
and regression coverage. Structural theme tests cannot establish absence of visual
flashes on authenticated provider pages. Existing automated and manual evidence is
reported separately below; unperformed tests must remain explicitly pending.

## Results: the requested eighteen report items

1. **White-flash root cause.** The audited provider CSS animates `.jump-highlight`
   with `--eos-bg-fill-theme-light`, resolving to pale `#ecf3fc`, while dark message
   text is light. The existing dark-root token correction uses `#20344f` and
   matching hover/active colors. Native pre-document backgrounds, singleton CSS
   repair and transient-surface coverage also remain in place. This is verified
   source/CSS evidence consistent with the supplied screenshot; the actual
   authenticated row was not inspected frame by frame. [Theme re-audit](THEME_AUDIT_2026-10-23.md).
2. **Theme files.** The existing fix is in `src/theme/bootstrap.ts`,
   `src/theme/dark.css`, `src-tauri/src/services.rs` and `src-tauri/src/window.rs`.
   This re-audit adds a Light/System-Light root-replacement and stylesheet-repair
   regression in `tests/theme.test.mjs`; no unsupported broader color override
   was added. Dark/Light/System structural coverage passes.
3. **Windows notification permission.** Rust uses native Windows sender state
   and submission results as the desktop authority. Browser permission is tracked
   separately for each configured origin/profile. Browser `denied` does not
   overwrite saved desktop delivery or service mute preferences. Windows does not
   install the Tauri JavaScript notification polyfill over the provider's native
   Notification constructor. Existing explicit origin permission repair remains
   available. Per-user OS permission and actual banner visibility still need the
   live checks below.
4. **Notification architecture changes.** Toast activation now restores only the
   retained configured instance and calls its public `ReportClicked`; it never
   calls an unread acknowledgement. Removed the intervening toast-only exact-read
   tombstones and clicked-count offsets. Arrival deduplication, source identity,
   local/global preferences, silence, bounded history, UI-apartment completion,
   generation checks and content-free diagnostics remain. Dismissal, timeout and
   focus also leave unread unchanged. Actual provider/view evidence and separate
   explicit read actions retain their existing paths.
5. **Discord global-clear cause.** The earlier selected/hovered-guild rule could
   infer read from equality between a guild label and its name; hidden channels
   were not established read. Combined with provider-zero retirement, that was a
   structural overly broad clear path. Current semantics treat those ambiguous
   states as unknown and require complete provider-wide metadata or exact message
   proof. Service selection has no mark-all call. During this request's baseline
   Windows inspection both Discord service dots remained after selection and
   four unread guild markers were visible. This is a limited observation on the
   preceding compiled build, not a controlled reproduction on the final artifact.
   [Read audit](READ_ACTIONS_2026-10-22.md).
6. **Discord current-read.** The explicitly local current action requires the
   selected foreground instance, latest unobscured conversation viewport and
   exact rendered notification-message evidence. It retires only proven arrivals;
   other channels, messages and service IDs remain unread. No Escape shortcut,
   arbitrary sidebar interaction or private Discord API is used to claim remote read.
7. **Discord all-read.** The bounded Inbox/Unreads controller uses the provider's
   public read control. Actual Polish controls inspected in Windows were
   `Nieprzeczytane wiadomości` and `Oznacz wszystko jako przeczytane`; these names
   differed from the expected strings and now have a regression that failed
   before the fix. The operation requires a unique scoped control, no visible
   error/confirmation and fresh complete provider-zero evidence before retiring
   its captured pre-action arrivals. It preserves newer arrivals and rejects
   ambiguous/renamed/replaced controls or source changes. The live inspection
   exposed two same-labelled accessibility controls; their DOM identity and the
   final operation are not yet verified. No deduplication was guessed from UIA.
   Discord documents unmuted-channel and direct/group-DM Inbox scope, rather than
   a promise about every muted channel. [Official Inbox FAQ](https://support.discord.com/hc/en-us/articles/360045027712-Inbox-FAQ).
8. **Service context menu.** Daily Open, supported mute/unmute and Service settings
   stay at the top; More groups supported read commands, scoped browser permission
   repair and desktop notification settings. Remove is separated. Rename lives
   in Service settings. Actions target the clicked stable ID and revalidate the
   configured instance. Unsupported reads are hidden rather than advertised.
9. **WhatsApp architecture.** The existing `whatsapp` entry uses the closed Rust
   and TypeScript registries, exact HTTPS `web.whatsapp.com` origin, bundled
   provider artwork and normal Chromium/WebView2 identity. No unofficial API,
   credentials handler, QR interception, history export or automated messaging
   was introduced. Synology CSS is not injected into WhatsApp.
10. **WhatsApp login/session.** Official QR and phone-number pairing are left to
    WhatsApp's own page, with storage isolated by stable service ID. Prior user
    evidence showed successful pairing; independent reload/restart/logout and
    linked-device persistence checks were not completed in this request. No
    existing profile was copied, reset or signed out. Account pairing requires
    the user's manual interaction.
11. **WhatsApp unread.** The dedicated positive-only adapter now reads accessibility
    metadata only on dedicated unread badges. A reproduced false positive from
    a contact named `2 unread messages` is fixed. Regression tripwires verify that
    contact, preview, action and photo labels/text are not inspected. Missing,
    filtered, archived, collapsed or virtualized DOM stays unknown; counts remain
    unavailable and no provider-wide zero is invented. Authenticated current badge
    markup remains unverified. [WhatsApp audit](WHATSAPP_2026-10-22.md).
12. **WhatsApp notifications.** Accepted browser notifications use the common
    native coordinator and deduplication path, rather than independent browser
    display. DOM badges do not manufacture message payloads. Routing restores the
    exact configured instance; its provider-owned click handler may open a chat,
    while unread still requires provider/view proof. Real focused/unfocused/
    minimized/tray-hidden receipt remains pending.
13. **WhatsApp read capabilities.** Current/global read actions remain unsupported
    and hidden. No safe authenticated public chat-read mapping has been established.
    The implementation neither mass-clicks chats nor claims a remote read. The
    corrected toast policy is especially important while WhatsApp read proof is unknown.
14. **Multiple instances.** Same-provider services keep independent IDs, profile
    directories, notification preferences and state. Existing serialization,
    reordering, source-epoch and read-boundary tests pass. Preparing isolated QA
    also found a shared Windows autostart integration: all application identifiers
    used production's Run entry. The plugin and reconciliation now derive the
    same identifier-specific entry, preserving the canonical production name.
    Pure regressions cover identity separation; no existing account or Windows
    registry value was changed by preparation tools.
    [Autostart audit](AUTOSTART_ISOLATION_2026-10-23.md).
15. **Automated validation.** Full repository `npm run format:check`, `npm run
typecheck`, `npm test` (**368 passed** in the workspace, including six existing
    untracked performance tests outside this milestone), frontend build, dependency and release
    checks passed. `cargo fmt --check`, `cargo check --locked` and `cargo test
--locked` passed (**217 passed**, one signed-artifact fixture ignored in the
    routine run). That fixture was then run explicitly and passed (**1/1**), for
    **218 distinct Rust tests**. The frontend gates also passed under Node 22;
    its tracked-test-only run passed **362 tests**, excluding the six unrelated
    performance tests. The full workspace run passed under Node 24 too.
    `git diff --check` passed. No test was disabled to
    hide a failure. Eleven tests asserting the superseded toast-click-read policy
    were replaced by lifecycle/no-read and genuine-provider-proof regressions;
    Inbox boundary coverage remains. Builds and account acceptance are distinct.
16. **Windows manual QA.** Baseline inspection observed four unread Discord guild
    markers, preserved service dots and the actual Polish Inbox control names.
    No message bodies or contact lists were exported to the repository or QA logs;
    control labels and unread-marker counts were used for this inspection. The separately
    built synthetic QA app has two exclusively created local profiles and real
    Notification buttons, but it was not launched: Computer Use continued reporting
    the earlier physical-Escape stop even after the user explicitly requested
    resumption and the JavaScript session was renewed. The user offered to prepare
    real accounts/test messages; those events were not exercised. No final-build
    toast-click, dismissal, native banner, read-all or authenticated no-flash result
    is claimed.
    In the follow-up the user reported manually launching the build and logging
    into Discord and WhatsApp. Read-only process metadata confirms the running
    executable is `Repository/src-tauri/target/release/chatplus-desktop.exe`.
    Computer Use still returned the earlier Escape stop in this new turn, so
    login state and incoming-notification behavior were not independently inspected.
17. **Remaining limitations.** The full authenticated matrix below is pending.
    WhatsApp/Messenger cannot prove current-chat read. Discord live Inbox control
    uniqueness/completion still needs acceptance; its safe fallback preserves
    unread and reports guidance. Browser notifications that a provider never emits
    cannot be intercepted. A matching sender registration and Windows policy are
    required for visible production toasts; debug QA's PowerShell sender does not
    verify the installed ChatPlus sender. Closing the process stops background
    observation; cold-process notification activation remains unverified. The
    iPhone WhatsApp device label still uses the normal Edge identity, with no
    demonstrated supported arbitrary ChatPlus name override.
18. **Support status.** WhatsApp remains **Experimental**, with matching seven-locale
    UI and trademark attribution. The unperformed authenticated acceptance checks
    do not support promoting it to fully supported. No release/tag is created by
    this task; no push was performed.

## Manual acceptance still to perform

| Provider / scenario                                                                          | Current evidence                                                                    | Status                                                |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Synology ChatPlus and Discord focus/service selection                                        | Baseline UI inspection plus current reducer/DOM regressions                         | Partial; final-build controlled account trial pending |
| Native toast display/click/dismissal in focused, unfocused, minimized and tray-hidden states | Automated coordinator/lifecycle policy plus prepared two-instance local fixture     | Native UI pending                                     |
| Discord current-channel/thread proof and unrelated-channel preservation                      | Exact-message/route/viewport/generation/instance automated coverage                 | Authenticated controlled trial pending                |
| Discord explicit Inbox all-read                                                              | Current Polish control labels observed; scoped failure/zero/boundary tests pass     | Final live control/completion trial pending           |
| WhatsApp QR/phone pairing, reload, restart, logout                                           | Prior user pairing evidence, isolated profile/URL tests, official entry flow        | Independent authenticated trial pending               |
| WhatsApp unread, duplicate delivery and correct toast route across two instances             | Dedicated badge/unknown-state and shared native routing regressions                 | Authenticated trial pending                           |
| ChatPlus Dark incoming/switch/thread/history/composer/edit/reaction/menu                     | Audited CSS cause, existing computed-animation fixture, structural regression suite | Authenticated visual trial pending                    |
| Light/System restoration                                                                     | Structural media-query/root-replacement/native background coverage                  | Final native visual trial pending                     |

The safe synthetic artifact is
`validation/provider-milestone-2026-10-23/qa/ChatPlus-Milestone-QA-base-isolated.exe`.
Its earlier `base.exe` sibling predates the autostart isolation fix and must not be
used. The fixture binds only loopback, contains fixed sample content, sends no
messages to contacts, and cannot substitute for authenticated provider acceptance.

The manually launched compiled release is
`Repository/src-tauri/target/release/chatplus-desktop.exe`. Its release build
passed at 10:31:36 UTC. It uses the production identifier and account profiles;
it is separate from the isolated synthetic QA app. The executable predates the
final documentation commits, which do not change its functional source.
