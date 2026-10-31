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

[audit-linux.mjs](../scripts/audit-linux.mjs) permits exactly one result to be
reported as requiring Linux review without failing the Windows gate:
`glib 0.18.5` / `RUSTSEC-2024-0429`, provided glib is absent from the Windows
normal/build/development graph. A changed version, another advisory, malformed
output or tool failure fails closed. This exception does not approve a Linux release
and is not used to bypass the signed release job's strict Linux target gate.

The candidate's locked graph reaches glib through Tauri's GTK3/WebKitGTK
dependencies. The [advisory](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
is fixed in glib 0.20 or later, while the GTK3 dependencies require glib 0.18.
The compatible 0.18 line has no fixed version. Linux distribution remains blocked
until that chain is repaired; native CI/build preparation does not remove the
block. The aggregate release requires all four target manifests and therefore
cannot silently publish the other targets after a Linux security failure.

Before distributing Linux binaries, repair the dependency chain and pass the strict
target check. A review note or advisory ignore is not a passing gate:

```sh
cargo deny --manifest-path src-tauri/Cargo.toml --config deny.toml --target x86_64-unknown-linux-gnu --locked check
```

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
