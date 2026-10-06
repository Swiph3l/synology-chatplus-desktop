# Dependency audit policy

The default cargo-deny graph is the Windows beta target,
`x86_64-pc-windows-msvc`. The security workflow also audits
`x86_64-unknown-linux-gnu` and the complete lockfile. This is a release-target
policy, not a claim that an advisory is harmless on every platform.

## Enforcement

- `npm audit` and Gitleaks remain blocking and unchanged.
- `cargo audit --file src-tauri/Cargo.lock` checks the whole lockfile. Actual
  vulnerability findings fail. Informational unmaintained warnings are printed,
  without `--deny warnings` converting every notice into a universal blocker.
- `cargo deny ... check` checks the Windows graph, including build/dev dependencies.
  Vulnerabilities, all unsoundness, yanked crates, disallowed licenses and sources
  remain blocking. `ignore` is empty. Direct unmaintained dependencies fail;
  transitive maintenance notices are reported by the whole-lockfile audit and
  require tracking, not an automatic Windows-beta rejection.
- `node scripts/audit-linux.mjs` runs strict Linux advisory checking. Only the
  exact `glib 0.18.5` / `RUSTSEC-2024-0429` unsoundness may be reported as
  REQUIRES REVIEW without failing the Windows gate, after checking that glib is
  absent from the Windows normal/build/dev graph. Every other error, changed
  version, additional unsoundness, malformed result or tool failure blocks.
  There is no blanket `continue-on-error` or future-advisory ignore.
- A Linux release must pass strict `cargo deny --target x86_64-unknown-linux-gnu`
  checking or receive a separate evidence-based release decision. The Windows
  exception does not authorize Linux distribution. The Windows-only draft workflow does not distribute Linux.

## Reviewed dependency paths (base version 0.5.0)

Reproduce with `cargo tree --locked --manifest-path src-tauri/Cargo.toml
--target <target> --edges normal,build -i <crate>` for both targets above.
Also inspect `--edges normal,build,dev`; none of the findings below is dev-only.
Here, Windows reachable means present in the dependency graph, not proof of a
specific exploitable runtime call path.

| Advisory          | Crate                    | Immediate parent / path                                                                | Target and dependency role     | Windows reachable | Upgrade path                                                       | Classification                                       |
| ----------------- | ------------------------ | -------------------------------------------------------------------------------------- | ------------------------------ | ----------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| RUSTSEC-2024-0429 | glib 0.18.5              | gtk 0.18.2, gio, gdk, cairo-rs, webkit2gtk and other GTK wrappers; Tauri/Wry GTK stack | Linux runtime                  | No                | glib >=0.20; requires compatible GTK/WebKit/Tauri parent migration | REQUIRES REVIEW for Linux; NON-BLOCKING WINDOWS BETA |
| RUSTSEC-2024-0370 | proc-macro-error 1.0.4   | glib-macros 0.18.5 / gtk3-macros 0.18.2                                                | Linux host build (proc-macros) | No                | Parent macro crates must migrate to maintained diagnostics tooling | NON-BLOCKING WINDOWS BETA                            |
| RUSTSEC-2025-0075 | unic-char-range 0.9.0    | unic-char-property / unic-ucd-ident -> urlpattern 0.3.0 -> tauri-utils 2.9.3           | Windows + Linux runtime/build  | Yes               | Tauri utils migration to newer urlpattern/Unicode implementation   | NON-BLOCKING WINDOWS BETA                            |
| RUSTSEC-2025-0080 | unic-common 0.9.0        | unic-ucd-version -> unic-ucd-ident -> urlpattern -> tauri-utils                        | Windows + Linux runtime/build  | Yes               | Same parent migration                                              | NON-BLOCKING WINDOWS BETA                            |
| RUSTSEC-2025-0081 | unic-char-property 0.9.0 | unic-ucd-ident -> urlpattern -> tauri-utils                                            | Windows + Linux runtime/build  | Yes               | Same parent migration                                              | NON-BLOCKING WINDOWS BETA                            |
| RUSTSEC-2025-0098 | unic-ucd-version 0.9.0   | unic-ucd-ident -> urlpattern -> tauri-utils                                            | Windows + Linux runtime/build  | Yes               | Same parent migration                                              | NON-BLOCKING WINDOWS BETA                            |
| RUSTSEC-2025-0100 | unic-ucd-ident 0.9.0     | urlpattern 0.3.0 -> tauri-utils 2.9.3                                                  | Windows + Linux runtime/build  | Yes               | Same parent migration                                              | NON-BLOCKING WINDOWS BETA                            |

The six maintenance notices do not identify a patched vulnerability version.
They remain technical debt: review replacement progress before each beta and when
Dependabot changes the parent graph. New vulnerability or unsoundness advisories
are not covered by this maintenance classification.

### glib unsoundness

[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) concerns
invalid pointer handling in `VariantStrIter`, with fixes starting at 0.20.0.
It is not merely an unmaintained warning. The Linux graph includes affected code;
absence of direct application calls does not prove transitive unreachability.
The Windows graph has neither glib nor the GTK macro dependency chain.

### Parent upgrade evaluation

The original review used Tauri 2.11.5 and tauri-utils 2.9.3. The 2026-10-07
security backport moves Tauri to 2.11.6 while retaining tauri-utils 2.9.3.
The [tauri-utils dependency metadata](https://crates.io/api/v1/crates/tauri-utils/2.9.3/dependencies)
still requires urlpattern ^0.3. Published urlpattern 0.6.0 uses ICU properties,
but is outside that constraint. GTK 0.18.2 requires glib ^0.18, which excludes the
fixed 0.20 line. Adding a second glib or force-overriding incompatible versions
does not repair the existing dependency chain. No unrelated dependency upgrades
or application changes are made to hide these findings.

Prefer compatible parent upgrades as they become available. Cargo-deny's
[advisory policy](https://embarkstudios.github.io/cargo-deny/checks/advisories/cfg.html)
separates maintenance scope from unsoundness; unsoundness remains set to `all`.

## 2026-10-07 reliability audit

Classification: **A** compatible patch/minor; **B** coordinated migration and testing;
**C** major or prerelease migration, deferred. Versions below are resolved versions,
not a claim that every latest release improves this application.

### Applied

| Dependency                 | Before / after                   | Class | Reason / migration                                                                                                                        |
| -------------------------- | -------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Rust Tauri                 | 2.11.5 to 2.11.6                 | A     | Security backport binds queued IPC replies to their owning WebView; no application API migration. Both manifest requirements use ~2.11.6. |
| Tauri CLI                  | 2.11.4 to 2.11.5                 | A     | Compatible packaging patch. CLI stays on ~2.11.5; JavaScript API remains 2.11.1 to keep the audited 2.11 integration.                     |
| @types/node                | 22.20.2 to 22.20.5               | A     | Patch on the Node 22 CI typing line.                                                                                                      |
| esbuild                    | 0.28.1 to 0.28.2                 | A     | Patch for existing test/theme bundling; no new dependency.                                                                                |
| Prettier                   | 3.9.6 to 3.9.9                   | A     | Markdown formatting fixes for the documentation pass.                                                                                     |
| Vite                       | 7.3.6 to 7.3.7                   | A     | Compatible production/development build patch.                                                                                            |
| source-map-js (transitive) | 1.2.1 to 1.2.2                   | A     | Fix indexed source-map denial of service through the existing PostCSS graph; no override or direct dependency added.                      |
| CodeQL Action              | pinned v4.38.0 to pinned v4.38.2 | A     | Same major, refreshed default CodeQL bundle; SHA pin and minimal permissions retained.                                                    |

The Tauri update addresses [GHSA-w28w-mhc8-qvjv](https://github.com/tauri-apps/tauri/security/advisories/GHSA-w28w-mhc8-qvjv)
using the [2.11.6 backport](https://github.com/tauri-apps/tauri/releases/tag/tauri-v2.11.6).
The source-map update addresses [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
Other release references: [CLI 2.11.5](https://github.com/tauri-apps/tauri/releases/tag/tauri-cli-v2.11.5),
[esbuild 0.28.2](https://github.com/evanw/esbuild/releases/tag/v0.28.2),
[Vite 7.3.7](https://github.com/vitejs/vite/releases/tag/v7.3.7),
[Prettier 3.9.9](https://github.com/prettier/prettier/releases/tag/3.9.9),
and [CodeQL Action v4.38.2](https://github.com/github/codeql-action/releases/tag/v4.38.2).

### Deliberately deferred / retained

| Area                                                              | Class | Decision                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tauri 2.12.1, API/CLI 2.12.1; new Tauri plugin lines              | B     | Tauri 2.12 moves native windows/webview2-com to 0.62/0.39 and MSRV to 1.90. That changes the COM types used by notification/download bridges and requires one coordinated Windows migration. Security fix is backported; evaluate focus fixes during that separate pass. |
| webview2-com 0.39.1, windows 0.62, tauri-winrt-notification 0.8.1 | B     | Native interface/notification migration; mixing bindings can make COM types incompatible. Current aligned bindings are retained.                                                                                                                                         |
| updater plugin 2.12/2.13 and signing-tool changes                 | B     | Existing official 2.11 updater has signed HTTPS regressions; no demonstrated failure justifies changing install/signature behavior during this pass. Require signed install/restart acceptance when migrated.                                                            |
| TypeScript 6/7                                                    | C     | Major compiler/configuration migration; 7 uses the new native compiler. Current 5.9.3 type checks are sufficient for this reliability scope.                                                                                                                             |
| Vite 8                                                            | C     | Major bundler migration to Rolldown, with changed plugin/build behavior; keep validated Vite 7.                                                                                                                                                                          |
| @types/node 26 / Node major change                                | C     | CI targets Node 22; changing type APIs ahead of the CI runtime could allow unsupported calls. Local Node 24 is also compatible with Vite 7.                                                                                                                              |
| Tauri 3 alpha                                                     | C     | Prerelease architecture and API migration; outside this maintenance pass.                                                                                                                                                                                                |
| checkout 7, setup-node 7, upload-artifact 7, download-artifact 8  | C     | Actions major/runtime/behavior changes need hosted-runner validation. Current full-SHA pins are the latest patch on their existing major lines.                                                                                                                          |
| Rust stable/tooling, linkedom, remaining direct Rust dependencies | A/B   | Audit found no application fix requiring broad graph churn. Rust 1.98.1 is available locally; CI already uses stable. linkedom 0.18.13 is current. Keep locked plugins, HTTP/TLS, serialization and test-signing crates; review each proposed change independently.      |
| Tokio 1.53.2                                                      | A     | Compatible patch available; retain 1.53.1 because this pass reproduces no Tokio defect and the targeted Tauri backport does not require it. Avoid unrelated async graph churn.                                                                                           |
| winreg 0.56 / minisign 0.10                                       | B     | Registry and signing-fixture changes need focused API/verification review; existing registration/signature paths are covered and no migration is needed for this pass.                                                                                                   |
| Linux GTK/glib and transitive Unicode maintenance debt            | B     | Parent constraints still need migration; the narrow existing Linux advisory policy remains in force.                                                                                                                                                                     |

Upstream migration references: [Tauri 2.12](https://github.com/tauri-apps/tauri/releases/tag/tauri-v2.12.0),
[Vite 8 migration](https://vite.dev/guide/migration), and
[TypeScript releases](https://github.com/microsoft/TypeScript/releases).
Registry versions were checked against [npm](https://www.npmjs.com/) and
[crates.io](https://crates.io/); Actions tags were checked in each official repository.
Gitleaks 8.30.1, cargo-audit 0.22.2, cargo-deny 0.20.2 and cargo-cyclonedx 0.5.9
already match the current published release and remain pinned, with Gitleaks
archive checksum verification unchanged. No updater key,
signature policy, TLS verification, CI permission or release trigger was weakened.

Lockfiles are updated with targeted npm installs and cargo update -p tauri --precise
2.11.6. Run the full commands in [TESTING.md](TESTING.md), including npm audit,
production frontend build, Rust tests, Tauri build and release isolation checks.
A local workflow parse cannot establish hosted CodeQL execution; CI remains required.

### Retained direct graph inventory

Registry review also checked the locked Rust graph: tauri-build 2.6.3; store 2.4.4,
autostart 2.5.1, opener 2.5.5, window-state 2.4.1, clipboard-manager 2.3.3,
single-instance 2.4.4, notification 2.4.0 and updater 2.11.0. New plugin lines are
part of the coordinated Tauri/native migration above. Current serialization/HTTP/TLS
versions already match published stable: semver 1.0.28, serde 1.0.229, serde_json
1.0.151, url 2.5.8, reqwest 0.13.5, rustls 0.23.45 and time 0.3.55. Test dependencies
base64 0.23.1 and rcgen 0.14.10 are current; minisign 0.9.1 remains as classified.
Direct Windows dependencies remain winreg 0.55.0, windows 0.61.3, webview2-com 0.38.2
and tauri-winrt-notification 0.7.3. The frontend test runner is Node's built-in runner;
linkedom 0.18.13 is current and no new testing framework was added.
