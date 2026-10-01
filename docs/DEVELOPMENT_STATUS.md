# Development validation — 2026-10-01

Development remains **0.5.0-beta.2**. No push, final bump, tag, release, signed
release packaging or remote issue closure was performed.

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
