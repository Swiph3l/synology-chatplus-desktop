# Testing

Automated tests validate policy, state transitions and synthetic provider DOM.
Native acceptance covers actual WebView2, WKWebView or WebKitGTK behavior,
notification presentation, provider sessions and dialogs. Record automated and
native evidence separately for each operating system and architecture. macOS and
Linux are candidate platforms; a build alone does not establish their acceptance.
Stable `1.0.0` acceptance requires native results on every advertised target,
authenticated provider and separate-account checks, and installed signed-update
verification. Record unperformed checks as pending.

## Full automated checks

From the repository root, with the host's native development dependencies available
(including the MSVC/C++ environment on Windows):

```sh
npm ci
npm run check:dependencies
npm run format:check
npm run typecheck
npm test
npm audit
npm run build
npm run check:release
node scripts/check-glib-backport.mjs --metadata
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
git diff --check
```

Use `npm.cmd` where PowerShell restricts scripts. `npm run build` produces the
frontend assets and provider/theme bundles embedded by native builds. The release
asset check rejects development fixtures in production output. Prettier and
rustfmt provide formatting checks; there is no separate application lint script.

CI runs native checks on Windows x64, Ubuntu 24.04 x64, macOS Apple Silicon and macOS
Intel, plus a separate frontend job on the other supported Node major. Linux
headless native tests use `xvfb-run -a cargo test --locked --manifest-path
src-tauri/Cargo.toml`. Security workflows cover npm, Rust advisories,
licenses/sources, secrets and static analysis. Follow
[DEPENDENCY_POLICY.md](DEPENDENCY_POLICY.md) when reviewing findings.

## Focused regression checks

Examples:

```sh
node --test tests/theme.test.mjs tests/provider-bootstrap.test.mjs
node --test tests/discord-unread.test.mjs tests/discord-read.test.mjs tests/provider-read.test.mjs
node --test tests/synology-adapters.test.mjs tests/minimized-notification.test.mjs
node --test tests/whatsapp.test.mjs tests/whatsapp-unread.test.mjs
node --test tests/external-links.test.mjs tests/messenger.test.mjs
cargo test --locked --manifest-path src-tauri/Cargo.toml authentication_diagnostics::
cargo test --locked --manifest-path src-tauri/Cargo.toml unread::
cargo test --locked --manifest-path src-tauri/Cargo.toml services::removal_tests
```

Some Node suites rebuild the ignored provider bootstrap bundles so they exercise
production code. Do not substitute copied selectors or real account data for
synthetic fixtures. Keep fixtures faithful to the public provider UI that was
actually inspected.

Messenger authentication diagnostics tests must verify that serialization contains
only fixed categories, booleans and valid HTTP status codes, including failures
on unrecognized Google/Facebook routes. Cover hostile URL/query sentinels,
lookalike hosts, non-Messenger services, stale navigation and the 64-event memory
bound. On Windows, use an isolated synthetic provider profile to verify main-view
and related-popup responses reach **Copy diagnostics** without changing request
methods, POST data, callbacks or navigation. Keep real credentials, cookies,
headers, bodies and account details out of fixtures and reports. A successful
existing session and a successful fresh login are separate acceptance checks;
HTTP 400 remediation must not be reported as passing without a real reproduction.

| Area                                        | Primary suites or modules                                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer read lifecycle and arrival tokens  | `unread.test.mjs`, `unread-state.test.mjs`, native `unread`                                                                                  |
| Provider evidence and foreground projection | `synology-adapters.test.mjs`, `discord-unread.test.mjs`, `whatsapp-unread.test.mjs`, `messenger.test.mjs`, `minimized-notification.test.mjs` |
| Explicit scoped read actions                | `provider-read.test.mjs`, `discord-read.test.mjs`, native `provider_read`                                                                    |
| Native notification identity and delivery   | Native `notification_bridge`, `desktop_notifications`, `notification_presentation`                                                           |
| Service IDs, profiles, startup and settings | `services.test.mjs`, `service-removal.test.mjs`, `service-settings.test.mjs`, native `services` and `state`                                  |
| Theme persistence and provider isolation    | `theme.test.mjs`, `provider-bootstrap.test.mjs`                                                                                              |
| Navigation and downloads                    | `navigation.test.mjs`, `attachment-download.test.mjs`, native `navigation`, `external_links` and `downloads`                                 |
| Platform packages and native integration    | Release target/collection/metadata suites, native `platform`; [platform acceptance](PLATFORMS.md#native-acceptance-checklist)                |
| Updater and release boundaries              | `updates.test.mjs`, release/wrapper/metadata/checksum suites, native updater tests                                                           |
| Locales and UI contracts                    | `localization.test.mjs`, settings, rail, footer and notification-color suites                                                                |

## Performance regression checks

Run the deterministic DOM-work checks alongside the read-state tests:

```sh
node --test tests/provider-dom.test.mjs tests/unread.test.mjs tests/discord-unread.test.mjs
cargo test --locked --manifest-path src-tauri/Cargo.toml tray::tests
cargo test --locked --manifest-path src-tauri/Cargo.toml connection::tests
```

The fixtures count pane discovery, content-context checks and active Discord
viewport queries. Empty or presentation-only mutation batches need no pane
discovery. Badge observations retain their snapshots while layout-dependent read
checks require a live read candidate, including Discord's verified current view,
pending acknowledgements and toast navigation. Content changes, pane replacement, navigation and new arrivals must
still revoke stale evidence before any acknowledgement.

Tray tests verify that repeated presentation values skip native setters, failed
writes remain retryable, and translated labels and icon state update independently.
Connection tests retain separate per-service transport states while suppressing
duplicate reports.

Operation counts are regression budgets, not measurements of whole-application
CPU or memory. Compare native builds using the same operating system, engine,
services, accounts, window state and warm-up period; include the shell and its
WebView processes. Keep
native measurements, environment details and raw profiles outside the source
checkout. Report live provider acceptance separately from fixture results.

## Unread and notification invariants

Regression coverage should establish that:

- Focus, service selection, restore, toast click and toast dismissal never
  acknowledge unread by themselves.
- Current-conversation read evidence cannot clear unrelated channels, threads,
  services or newer arrivals.
- Missing, collapsed, filtered or virtualized provider DOM is unknown unless the
  adapter has reliable evidence of a complete zero.
- Explicit local acknowledgement is distinguished from provider-confirmed read.
  Discord Inbox automation requires its supported public controls and fresh
  reliable provider zero; a click, timeout, disabled button or error is not proof.
- Two instances of the same provider retain separate profiles, unread and actions.
- Mute and permission changes affect delivery without clearing unread or silently
  rewriting saved notification intent.
- Distinct browser notification events survive identical previews; replaying one
  event does not deliver it twice.
- Rail, aggregate and tray inputs agree with the same authoritative native snapshot.
- Background startup neither changes selection nor focuses a provider, and stale
  callbacks cannot resurrect a removed or reconfigured session.

Include races involving arrivals during read queries, service replacement,
foreground changes, shutdown and failed native submissions. Add a regression for
a reproduced failure without weakening existing assertions.

## Native and release checks

Build a standalone debug app with:

```sh
npm run tauri -- build --debug --no-bundle
```

Use the [platform acceptance checklist](PLATFORMS.md#native-acceptance-checklist)
for actual provider, notification, theme, session and desktop behavior on every
target. Windows additionally uses [WINDOWS_ACCEPTANCE.md](WINDOWS_ACCEPTANCE.md)
for its toast/download contracts. Record build identity, OS/architecture and engine
versions, provider version and each observed result. Keep logs and private
screenshots outside the repository. Do not count an unimplemented platform feature
or an unperformed authenticated-provider check as passing.

Run optimized Rust tests when changing behavior sensitive to build mode:

```sh
cargo test --release --locked --manifest-path src-tauri/Cargo.toml
```

The ignored `production_artifact_signature_verifies` test requires a valid signed
production installer supplied through `CHATPLUS_SIGNED_ARTIFACT`. Run that fixture
explicitly when validating production signatures. It does not replace an installed
signed-updater test. Packaging, installation and restart gates are covered by the
[release checklist](RELEASE_CHECKLIST.md) and [updater guide](UPDATER.md).
Each release target also needs its strict `cargo deny --target <rust-target>` gate.
The GTK3 graph includes a verified glib iterator backport. Its source/resolution
guard must pass, and `node scripts/audit-linux.mjs` requires both `cargo-audit`
and `cargo-deny` to check the compiled dependency graph and separately review
the original registry identity. A path dependency disappearing from an advisory
report is not evidence that it is fixed.

On Linux, exercise the first-party integration regression in both modes:

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml --test glib_variant_iter
cargo test --release --locked --manifest-path src-tauri/Cargo.toml --test glib_variant_iter
```

The Linux CI job runs the optimized regression in addition to its full debug
suite, and release jobs run full debug/release suites. Until those native checks
complete for the candidate, record them as pending. These checks do not establish
authenticated provider, desktop or installed-update acceptance.
