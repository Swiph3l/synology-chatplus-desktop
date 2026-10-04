# Development validation — 2026-10-04

The current **0.5.0-beta.4** candidate focuses on provider-specific notification
and unread reliability for Synology ChatPlus, Synology Chat and Discord. See
[BETA4_RELIABILITY.md](BETA4_RELIABILITY.md) for the implementation, source audit,
automated validation, review and local development build. The explicit
[three-provider Windows matrix](WINDOWS_ACCEPTANCE.md#20-2026-10-04-beta4-provider-reliability-acceptance)
remains **PENDING**, including real toast delivery, read persistence and activation.
No release, tag or publication was performed.

The preceding **0.5.0-beta.3** follow-up introduced guarded automatic updates,
six-section settings, English/Polish/Spanish resources and the compact footer.
Its [report](MAINTAINER_FOLLOWUP.md) and section 19 acceptance checklist remain
historical evidence. The updater implementation is unchanged by beta.4.

## Historical validation — 2026-10-01

This report records the completed development pass at **9a123c2**, before the
**0.5.0-beta.3** prerelease preparation. Its beta.2 versions and validation results
below are historical evidence. The current release target and changes are recorded
in [CHANGELOG.md](../CHANGELOG.md#050-beta3) and [WINDOWS_BETA.md](WINDOWS_BETA.md).
The remaining native acceptance gates still apply; final stable 0.5.0 is not being
prepared.

Development remained **0.5.0-beta.2** during that pass. No push, final bump, tag, release, signed
release packaging or remote issue closure was performed.

## Development finalization and stable gate

Finalization started on main at **9275b42**, equal to origin/main, with no
unpublished commits. The remaining diff contained menu/removal, Mattermost and
Synology provider-icon work; no unrelated tracked files were found. Discord,
per-instance profiles, Services styling and the updater channel fix were already
committed and were not recommitted. Existing history remains intact.

| Commit  | Responsibility                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| ffc6ad8 | Native service menu and confirmed immediate removal, Settings routing, draft preservation, Save/removal serialization and regression tests |
| e9fc9ef | Reject Windows profile ID case collisions and reserved device names; preserve valid IDs and profile paths                                  |
| 9ae25b0 | Experimental Mattermost Rust/frontend registration, custom origins, instance tests, icon and documentation                                 |
| cb18686 | Distinct Synology ChatPlus/Chat rail icons and trademark notices                                                                           |

Menu and removal share Settings destinations, confirmation and lifecycle
interfaces, so they form one complete commit. Mattermost follows the shared
implementation with its own tests/docs. Profile validation and icons are
independent corrections. Every intermediate source tree received relevant tests
before its commit; tests stay with the behavior they verify.

### Full automated validation

| Command                                                                           | Result                                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| npm ci                                                                            | PASS: 41 packages installed, 42 audited                                         |
| npm run format:check                                                              | PASS                                                                            |
| npm run typecheck                                                                 | PASS                                                                            |
| npm test                                                                          | PASS: 56 passed, 0 failed, 0 skipped                                            |
| npm run build                                                                     | PASS: TypeScript, Vite assets and theme bootstrap                               |
| npm run check:release                                                             | PASS: development fixture excluded                                              |
| cargo fmt --manifest-path src-tauri/Cargo.toml -- --check                         | PASS                                                                            |
| cargo check --locked --manifest-path src-tauri/Cargo.toml                         | PASS                                                                            |
| cargo test --locked --manifest-path src-tauri/Cargo.toml                          | PASS: 62 passed, 0 failed, 1 ignored                                            |
| cargo test --release --locked --manifest-path src-tauri/Cargo.toml                | PASS: 62 passed, 0 failed, 1 ignored                                            |
| npm audit                                                                         | PASS: zero vulnerabilities                                                      |
| cargo audit --file src-tauri/Cargo.lock                                           | PASS: normal database/index refresh; seven existing policy-tracked warnings     |
| cargo deny --manifest-path src-tauri/Cargo.toml --config deny.toml --locked check | Windows PASS; duplicate-crate and unmatched-license-allowance warnings retained |
| node scripts/audit-linux.mjs                                                      | Windows-policy PASS; Linux REQUIRES REVIEW                                      |
| Gitleaks                                                                          | PASS: redacted history, candidate tree and unreachable-object scans             |
| Repository release-identity validation                                            | PASS: all six source/lockfile version values equal 0.5.0-beta.2                 |
| git diff --check                                                                  | PASS                                                                            |

Commands use npm.cmd because PowerShell disables npm.ps1, and the existing local
Rust toolchain. The default audit cache had origin/ownership errors; the exact
audit command then passed using a process-scoped, ignored workspace Cargo cache
with normal RustSec/crates.io refreshes. No dependency policy, advisory ignore or
signature check was weakened.

The ignored Rust test, production_artifact_signature_verifies, requires a separate
production artifact and its signature. Signed HTTPS updater fixture tests ran,
including valid/bad signatures, channels, offline failure and cancellation.
Existing updater documentation already states that Stable receives production
releases only, Pre-release accepts beta/RC and newer stable versions, signatures
and HTTPS are mandatory, and install/restart requires explicit action.

### Dependency findings

Whole-lockfile audit reports the seven findings tracked in
[DEPENDENCY_POLICY.md](DEPENDENCY_POLICY.md): six unmaintained notices for
proc-macro-error and the unic dependency family, plus glib 0.18.5 unsoundness
RUSTSEC-2024-0429. The Linux wrapper confirms that exact exception and its absence
from the Windows normal/build/dev graph. Linux distribution remains blocked
pending review/fix. Windows cargo-deny passed advisories, bans, licenses and sources;
no new Windows release-blocking security finding was reported.

### Decision

**NOT READY FOR v0.5.0**. Automated results do not resolve the previously reported
authenticated ChatPlus login incident or establish installed migration,
authenticated profile retention and the remaining native acceptance matrices.
See the current [Windows status](WINDOWS_ACCEPTANCE.md#18-development-finalization-status).
Issues #14 through #19 remain KEEP OPEN for their acceptance gaps.

All version-bearing files remain 0.5.0-beta.2: package.json, both root values in
package-lock.json, src-tauri/Cargo.toml, the chatplus-desktop Cargo.lock entry and
src-tauri/tauri.conf.json. No stable changelog section, stable README positioning or
chore: prepare v0.5.0 release commit was created. No tag, push, publication or issue
closure occurred. The tree was clean after the four development commits; this
documentation records the final gate result.

## Acceptance follow-up (earlier evidence)

The later [Windows acceptance report](WINDOWS_ACCEPTANCE.md) supersedes the native
and screenshot limitations below where fresh evidence is explicitly recorded.
The actual development app was inspected through WebView2's debugging interface
and a targeted Win32 harness, despite the unavailable Computer Use native pipe.
Two native regressions were fixed, followed by a focused rail/Services styling
commit and separate experimental Discord commits. Current checks pass: 32 frontend
tests and 47 Rust tests in each debug/release run, with one production-artifact test
ignored in each. Fresh setup, Services and rail screenshots are privacy-reviewed.

The reported authenticated session stuck at login is still an acceptance gate;
two original-profile launches showed authenticated ChatPlus, but do not establish
that the entire incident is resolved. Actual Windows 125%/150% DPI, live messages,
two authenticated Discord accounts and the remaining native matrices are open.
The recommendation remains **NOT READY FOR RC AUDIT**. All prior commits remain
intact; the following sections retain the first-pass record for provenance.

## Branch and implementation

Started clean on `beta/fixes` at `42e5e95`. `main` at `e67a3cb` contained every
beta/fixes commit plus beta.2 preparation and standalone Windows asset collection.
`main..beta/fixes` and the three-dot diff were empty. Switched to main without
rewriting history; both branches and all prior commits remain intact.

- Typed ProviderDefinition/ServiceConfig/ServiceSession model and closed provider registry.
- Local 56-pixel rail with isolated lazy child WebViews; activated sessions stay alive while hidden.
- Deterministic one-time legacy migration preserving preferences and the original profile path.
- Distinct experimental Synology Chat and Slack sessions; unread/native notifications disabled.
- Per-service unread caches and desktop aggregation; no title fallback or navigation reset.
- Service-aware notification gates, independent duplicate filter, focus suppression and source-service click routing.
- Existing Settings keep-open/inline Save confirmation tested; separate Close and service editing added.
- Scoped dark reaction styling, stable Windows theme/menu lifecycle and active-view restore focus.
- Serialized service transitions and per-service cached connection state.
- Pre-release accepts newer stable releases using real SemVer; signatures/channel preference preserved.
- README and provider/security/notification/updater/release docs refreshed. About already uses build metadata; layout retained.

## Issue classification

| Issue                  | Status                                                                                   | Remaining evidence                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| #14 multiple instances | Plugin integration reviewed; restore improved                                            | Native normal/minimized/tray/Settings/About repeated-launch checks         |
| #15 menu after theme   | Existing frame/menu mitigation preserved                                                 | Native menu/theme visual check                                             |
| #16 reaction styling   | Code correction and scoped regression test                                               | Live-server visual confirmation                                            |
| #17 unread instability | Title fallback/navigation clearing removed; per-service state tested                     | Real read/reload/reconnect/startup transitions                             |
| #18 Save               | Keep-open, inline confirmation and error handling validated in DOM tests; Close separate | Native window/focus confirmation                                           |
| #19 foundation         | Provider model, migration, profiles and rail implemented                                 | Native layout/session acceptance; additional providers remain experimental |

Related prior history: `180a3c1` single-instance/notification work and `2237715`
desktop beta preparation. Issue-related commits use `Refs` because complete native
acceptance is unproven; no remote issue was closed.

## Automated checks

| Check                                      | Result                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| npm ci / format:check / typecheck          | PASS                                                                                               |
| npm test                                   | PASS: 26 tests                                                                                     |
| npm build / check:release                  | PASS; debug fixture excluded from production assets                                                |
| cargo fmt --check / cargo check --locked   | PASS                                                                                               |
| cargo test --locked                        | PASS: 45 passed, 1 ignored                                                                         |
| cargo test --release --locked              | PASS: 45 passed, 1 ignored                                                                         |
| npm audit                                  | Zero reported vulnerabilities                                                                      |
| Windows cargo deny                         | PASS with duplicate/license warnings                                                               |
| cargo audit, fresh local advisory database | Completed with seven existing allowed maintenance/Linux warnings; index-refresh warning            |
| Linux audit wrapper                        | REQUIRES REVIEW: glib 0.18.5 / RUSTSEC-2024-0429, absent from Windows graph; Linux release blocked |
| Gitleaks, new commits                      | PASS, redacted scan                                                                                |

The ignored Rust test requires a separately built production artifact and signature;
this pass creates no final assets. Signed HTTPS updater fixture tests ran normally.
The original cargo-audit cache lacked an origin remote, so a fresh ignored local
database was used. Warnings were not suppressed to obtain passing results.

## Local knowledge

Created outside Git at `E:\chatplus_synology_client\AI\Repository`:
PROJECT.md, ARCHITECTURE.md, CODEMAP.md, DECISIONS.md, KNOWN_ISSUES.md, PROVIDERS.md,
NOTIFICATIONS.md, UPDATER.md, TESTING.md, RELEASE_PROCESS.md and SESSION_NOTES.md.
No keys, credentials, private server URLs, cookies or chat content are stored there.

## Native checks and v0.5.0 blockers

Computer Use's native pipe was unavailable after retry/reset. No manual Windows
behavior or new screenshots are claimed. Existing images are historical references;
About's obsolete `0.5.0-dev` image is not presented as a current screenshot.

1. Repeat launch with normal/minimized/tray/Settings/About states; verify one session,
   no duplicate windows and restored keyboard focus.
2. Check child-view layout/resizing/DPI, menu/theme changes, reaction contrast and Save/Close.
3. Test installed migration/login-cookie retention, independent service profiles,
   switching/disabling/removing services, reconnect and restart.
4. Test real messages focused/unfocused/minimized/tray/inactive, privacy modes,
   denied permission, Do Not Disturb, sound off, test toast, source click and cooldown-zero duplicates.
5. Test unread/read transitions, focus without clearing, reload/reconnect/startup.
6. Validate Synology Chat/Slack login and SSO; keep experimental labels and disabled
   desktop capabilities. External-IdP cookie handoff is not implemented.
7. Complete a separately authorized signed beta/RC-to-stable install/restart audit
   and review security/platform warnings before final release.
8. Capture fresh privacy-reviewed setup/settings/notifications/updates/About/rail
   screenshots from the actual build.

Never-activated services cannot notify. Pre-release discovery is bounded to 100
published releases. Identical notification contents can be conservatively suppressed
for five seconds without a guaranteed provider message ID. Sidebar unread is boolean,
not a total of hidden/muted conversations. No background push exists after full exit.

## Deferred version bump and commits

Final bump files: `package.json`, root package versions in `package-lock.json`,
`src-tauri/Cargo.toml`, the application entry in `src-tauri/Cargo.lock`, and
`src-tauri/tauri.conf.json`. Refresh README/changelog/release target docs and actual
screenshots as appropriate; keep historical versions and updater fixtures intact.

Use `git log e67a3cb..HEAD --oneline` for all local development commit SHAs/subjects.
