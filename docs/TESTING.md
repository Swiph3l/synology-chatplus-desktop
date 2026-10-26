# Testing

Automated tests validate policy, state transitions and synthetic provider DOM.
Native Windows acceptance covers actual WebView2 behavior, toast presentation,
provider sessions and dialogs. Record those forms of evidence separately.

## Full automated checks

From the repository root, with the Rust MSVC/C++ environment available:

```sh
npm ci
npm run check:dependencies
npm run format:check
npm run typecheck
npm test
npm audit
npm run build
npm run check:release
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
git diff --check
```

Use `npm.cmd` where PowerShell restricts scripts. `npm run build` produces the
frontend assets and provider/theme bundles embedded by native builds. The release
asset check rejects development fixtures in production output. Prettier and
rustfmt provide formatting checks; there is no separate application lint script.

CI runs the Windows frontend/native checks and a second frontend job on the other
supported Node major. Security workflows cover npm, Rust advisories,
licenses/sources, secrets and static analysis. Follow
[DEPENDENCY_POLICY.md](DEPENDENCY_POLICY.md) when reviewing findings.

## Focused regression checks

Examples:

```sh
node --test tests/theme.test.mjs tests/provider-bootstrap.test.mjs
node --test tests/discord-unread.test.mjs tests/discord-read.test.mjs tests/provider-read.test.mjs
node --test tests/synology-adapters.test.mjs tests/minimized-notification.test.mjs
node --test tests/whatsapp.test.mjs tests/whatsapp-unread.test.mjs
cargo test --locked --manifest-path src-tauri/Cargo.toml unread::
cargo test --locked --manifest-path src-tauri/Cargo.toml services::removal_tests
```

Some Node suites rebuild the ignored provider bootstrap bundles so they exercise
production code. Do not substitute copied selectors or real account data for
synthetic fixtures. Keep fixtures faithful to the public provider UI that was
actually inspected.

| Area                                        | Primary suites or modules                                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer read lifecycle and arrival tokens  | `unread.test.mjs`, `unread-state.test.mjs`, native `unread`                                                                                  |
| Provider evidence and foreground projection | `synology-adapters.test.mjs`, `discord-unread.test.mjs`, `whatsapp-unread.test.mjs`, `messenger.test.mjs`, `minimized-notification.test.mjs` |
| Explicit scoped read actions                | `provider-read.test.mjs`, `discord-read.test.mjs`, native `provider_read`                                                                    |
| Native notification identity and delivery   | Native `notification_bridge`, `desktop_notifications`, `notification_presentation`                                                           |
| Service IDs, profiles, startup and settings | `services.test.mjs`, `service-removal.test.mjs`, `service-settings.test.mjs`, native `services` and `state`                                  |
| Theme persistence and provider isolation    | `theme.test.mjs`, `provider-bootstrap.test.mjs`                                                                                              |
| Navigation and downloads                    | `navigation.test.mjs`, `attachment-download.test.mjs`, native `navigation`, `external_links` and `downloads`                                 |
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
CPU or memory. Compare native builds using the same services, accounts, window
state and warm-up period; include the shell and its WebView2 descendants. Keep
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

Use [WINDOWS_ACCEPTANCE.md](WINDOWS_ACCEPTANCE.md) for actual provider, notification,
theme, download, session and desktop behavior. Record the build identity, Windows
and WebView2 versions, provider version and each observed result. Keep logs and
private screenshots outside the repository.

Run optimized Rust tests when changing behavior sensitive to build mode:

```sh
cargo test --release --locked --manifest-path src-tauri/Cargo.toml
```

The ignored `production_artifact_signature_verifies` test requires a valid signed
production installer supplied through `CHATPLUS_SIGNED_ARTIFACT`. Run that fixture
explicitly when validating production signatures. It does not replace an installed
signed-updater test. Packaging, installation and restart gates are covered by the
[release checklist](RELEASE_CHECKLIST.md) and [updater guide](UPDATER.md).
