# Testing

Automated fixtures validate policy and transitions. They do not prove native Windows
toast delivery, WebView2 provider behavior, installed session retention or signed
installer restart. Keep those results separate in reports.

## Automatic validation

From the repository root, with the Rust MSVC/C++ environment loaded:

```sh
npm ci
npm run format:check
npm run typecheck
npm test
npm audit
npm run build
npm run check:release
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo test --release --locked --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --debug --no-bundle
```

Use `npm.cmd` where PowerShell restricts scripts. Formatting uses Prettier and
rustfmt; there is no separate application lint script. `npm run build` performs
TypeScript checking as well as production assets and both provider bootstrap bundles.
The release check rejects development fixture markers/chunks in output.

CI validates Windows development on push/PR, CodeQL analyzes JavaScript/TypeScript,
Rust and Actions for the public repository, and security CI checks npm, RustSec,
licenses/sources and secrets. Follow [DEPENDENCY_POLICY.md](DEPENDENCY_POLICY.md) for
the narrow Linux advisory review; do not ignore unrelated findings.

## Regression suites

| Suite / source                                    | What it validates                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| tests/unread.test.mjs                             | Shared renderer lifecycle, foreground generations, trusted conversation evidence, pending arrivals and proof retirement          |
| tests/synology-adapters.test.mjs                  | Separate ChatPlus and Synology Chat selectors, unread/zero scope, latest panes, composer mapping and visibility projection       |
| tests/discord-unread.test.mjs                     | Guild/DM evidence, complete aggregate rules, route/message proofs and public focus projection                                    |
| tests/minimized-notification.test.mjs             | Real adapter fixtures with native host projection for minimized/selected and inactive providers                                  |
| tests/services.test.mjs and tests/footer.test.mjs | Rail identity, enabled filtering and stale initial/event ordering                                                                |
| Native unread/notification modules                | Per-service state, aggregate invariants, native read validation, event identity/delivery and apartment-safe completion           |
| Native downloads module                           | Filename/security rules, duplicate reservation, URL eligibility and download status policy                                       |
| Settings/service/navigation/localization suites   | Saves/removal, mute drafts, origin validation and EN/PL/ES behavior                                                              |
| Rust updater_tests.rs and updates.rs              | Ephemeral signed HTTPS downloads, signature rejection, cancellation, channels, startup/six-hour schedule and stale result guards |
| Release/wrapper/metadata/checksum suites          | Signing isolation, tag/version identity, URL-safe names, actual installer targets and checksums                                  |

Download automation covers filename/trust boundaries, real existing-file preservation,
parallel name reservation and lifecycle-status interpretation. It does not execute
a real authenticated transfer or native Save As/cancel/failure dialog; in-progress,
completed, paused, failed and cancelled native operations remain manual acceptance.

Add regression coverage for every reproduced bug, using provider-specific fixtures
rather than assuming one DOM works everywhere. Safe public examples and synthetic
conversation IDs belong in fixtures; real conversation content and credentials do
not. Keep changed-provider fixtures faithful to independently inspected DOM.

## Notification transition matrix

For each Synology ChatPlus, Synology Chat and Discord adapter, automatic regressions
and the manual Windows plan cover:

| Case | Transition                                                                                    | Expected                                                     |
| ---- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| A    | Selected conversation then minimize then new message                                          | Service unread, rail and tray aggregate true; toast eligible |
| B    | A then restore only                                                                           | Unread remains true                                          |
| C    | Restore then trusted interaction in correct latest conversation with reliable read/zero proof | Service unread clears                                        |
| D    | Restore then type/send in mapped active composer with reliable read/zero proof                | Stale service latch clears; other unread remains             |
| E    | Two services unread then read one                                                             | Only one clears, aggregate/tray stays true                   |
| F    | Read the last unread service                                                                  | Rail, aggregate and tray clear                               |
| G    | Synthetic input                                                                               | No acknowledgement                                           |
| H    | Switch service only                                                                           | No acknowledgement                                           |
| I    | Provider badge disappears in background                                                       | Native unread stays latched                                  |
| J    | Two distinct consecutive messages, including identical previews                               | Neither lost to cooldown/content deduplication               |
| K    | Repeated processing/mutations for the same event                                              | One native toast                                             |

Include stale foreground generations, in-flight arrivals, route/pane changes,
positive/unknown provider aggregate, service mute, disabled global notifications and
failed native submission/retry. The same presentation snapshot must satisfy
`per-service native == rail` and `any(enabled unread) == aggregate == tray input`
after every accepted transition.

## Development and release validation

A development binary from `--debug --no-bundle` runs the production frontend without
a Vite server and without signing credentials. Keep validation logs outside the
repository. If another ChatPlus process is already running, a second launch activates
that process; close it before inspecting a specific build.

The ignored `production_artifact_signature_verifies` Rust fixture needs a separately
built production artifact and signature; normal unit-test runs cannot substitute for
it. Signed updater installation/restart requires an authorized release package and
manual acceptance. [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) covers the release gate.

Follow [WINDOWS_ACCEPTANCE.md](WINDOWS_ACCEPTANCE.md#current-reliability-pass-2026-10-07)
for actual provider notifications, downloads, permissions, activation, DPI and updater.
Record build commit, Windows/WebView2 versions, provider version and each result as
observed/pass/fail/pending. Existing dated evidence is linked from
[DEVELOPMENT.md](DEVELOPMENT.md); it must not be counted as testing a newer revision.
