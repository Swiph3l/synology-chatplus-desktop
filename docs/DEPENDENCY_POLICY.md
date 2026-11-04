# Dependency policy

Dependency changes must preserve supported runtimes, compatible native bindings,
license obligations and signed update verification. The manifests and lockfiles
are the version inventory; this guide describes the checks required to change them.

## Version compatibility

- Keep the JavaScript Tauri API, native Tauri and CLI on compatible minor lines.
  Upgrade Windows and WebView2 COM bindings together with their Tauri parents.
  Run `npm run check:dependencies` to check these relationships.
- Keep `@types/node` on the oldest supported Node major in `package.json`.
  Review CI and typings together when changing supported runtimes.
- Commit npm and Cargo lockfile changes. Prefer targeted updates and review
  transitive changes before accepting a new lockfile.
- Treat compiler, bundler, native binding and updater migrations as coordinated
  changes. Include migration work and relevant native acceptance in the PR.
- Pin GitHub Actions to full commit SHAs with readable version comments. Review
  action runtimes, permissions and artifact behavior when updating.

## Security and license gates

The [security workflow](../.github/workflows/security.yml) runs npm auditing,
RustSec, cargo-deny and Gitleaks. [deny.toml](../deny.toml) defines the dependency
policy; [check-dependencies.mjs](../scripts/check-dependencies.mjs) checks
cross-language version constraints.

```sh
npm run check:dependencies
npm audit
node scripts/check-glib-backport.mjs --metadata
cargo audit --file src-tauri/Cargo.lock
cargo deny --manifest-path src-tauri/Cargo.toml --config deny.toml --locked check
node scripts/audit-linux.mjs
```

The default cargo-deny target is `x86_64-pc-windows-msvc`, including build and
development dependencies. Each signed release job additionally runs the strict
gate for its actual target: `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`,
`aarch64-apple-darwin` or `x86_64-apple-darwin`. Vulnerabilities, unsoundness, yanked crates, unapproved
licenses and unknown sources fail the gate. The advisory ignore list is empty.
Direct unmaintained dependencies fail; transitive maintenance notices remain
visible in the whole-lockfile audit and need dependency review.

Third-party licenses remain in force under the project's GPL license. The
crate-specific `webpki-root-certs` exception permits CDLA-Permissive-2.0 and retains
its license text in [third-party](../third-party/webpki-root-certs-LICENSE.txt).
See [licensing](LICENSING.md) for distribution requirements.

## Linux advisory boundary

The GTK3/WebKitGTK graph requires glib 0.18. The published `0.18.5` crate has
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html), an
invalid immutable out-parameter in `VariantStrIter::impl_get`. The repository
vendors that exact crate at [vendor/glib-0.18.5](../vendor/glib-0.18.5) and applies
the upstream two-line mutable out-parameter fix from
[gtk-rs commit 05dff0e](https://github.com/gtk-rs/gtk-rs-core/commit/05dff0ee696f9bcd8617cd48c4b812d046d440cb).
The crate retains version `0.18.5`; this is a reviewed source backport, not an
upgrade to the incompatible glib 0.20 API.

[security/glib-backport.json](../security/glib-backport.json) records the original
registry source, archive checksum, complete file inventory and patched file hash.
[check-glib-backport.mjs](../scripts/check-glib-backport.mjs) verifies the retained
source and, with `--metadata`, the actual Cargo dependency resolution. Every GTK
consumer must resolve to that same checked copy. Missing, additional or modified
source files and an unexpected package resolution fail the guard.

Registry advisory scanners do not establish that a path dependency contains the
fix. [audit-linux.mjs](../scripts/audit-linux.mjs) therefore combines the source
and resolution guard, the strict Linux target audit and a separate advisory review
using the original registry package identity. The original advisory remains
recorded rather than disappearing behind the path override. Unexpected advisories,
malformed output and tool failures must fail. The advisory ignore list remains
empty; the former Windows-only Linux warning exception no longer approves a run.

Run the source/audit checks on any development host with Cargo, cargo-audit and cargo-deny.
On Linux, also run the integration regression in both build modes; optimized
execution matters for this pointer-write defect:

```sh
node scripts/check-glib-backport.mjs --metadata
node scripts/audit-linux.mjs
cargo deny --manifest-path src-tauri/Cargo.toml --config deny.toml --target x86_64-unknown-linux-gnu --locked check
cargo test --locked --manifest-path src-tauri/Cargo.toml --test glib_variant_iter
cargo test --release --locked --manifest-path src-tauri/Cargo.toml --test glib_variant_iter
```

All checks need results for the candidate revision. A vendored source hash is not
native runtime acceptance, and an audit pass does not cover other code paths or
the operating system's GLib libraries. Retire the backport when a compatible
maintained dependency graph supplies the fix. The aggregate release still
requires all four target manifests and security gates; Linux failures block the
whole draft instead of silently dropping a platform.

Inspect normal/build and development edges when evaluating reachability:

```sh
cargo tree --locked --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --edges normal,build,dev -i <crate>
cargo tree --locked --manifest-path src-tauri/Cargo.toml --target x86_64-unknown-linux-gnu --edges normal,build,dev -i <crate>
```

Dependency presence establishes graph reachability, not an exploitable call path.
Do not force incompatible child versions or add a second fixed crate and assume
the original vulnerable chain is repaired. Prefer compatible parent upgrades.

## Reviewing an update

Record the reason for the change, affected dependency paths, migration details
and validation in the PR. Run the applicable [test gates](TESTING.md), including
production asset checks. Native COM, session, notification and updater changes
also require the relevant [platform acceptance](PLATFORMS.md#native-acceptance-checklist)
and [Windows acceptance](WINDOWS_ACCEPTANCE.md) cases for affected targets.
Keep one-off audit output and machine-specific logs outside the source checkout.
