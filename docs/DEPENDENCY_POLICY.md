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

At review, published Tauri 2.11.5 and tauri-utils 2.9.3 match the lockfile.
The [tauri-utils dependency metadata](https://crates.io/api/v1/crates/tauri-utils/2.9.3/dependencies)
still requires urlpattern ^0.3. Published urlpattern 0.6.0 uses ICU properties,
but is outside that constraint. GTK 0.18.2 requires glib ^0.18, which excludes the
fixed 0.20 line. Adding a second glib or force-overriding incompatible versions
does not repair the existing dependency chain. No unrelated dependency upgrades
or application changes are made to hide these findings.

Prefer compatible parent upgrades as they become available. Cargo-deny's
[advisory policy](https://embarkstudios.github.io/cargo-deny/checks/advisories/cfg.html)
separates maintenance scope from unsoundness; unsoundness remains set to `all`.
