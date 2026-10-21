# Pull-request and dependency review — 2026-10-23

The live GitHub REST response contained **15 open dependency PRs**. Their exact
head commits, changed files and checks were inspected against current `main`
`3450286a99e66fac9062be8a52a515643e5c4354` and the existing local reliability work.
The local work was preserved in a snapshot before three isolated worktrees were
created for review. GitHub PRs, comments and branches were not modified.

## Disposition of every open PR

“Applied” below means the intended update is present in the local working tree,
including required fixes. It does not mean the original PR was merged.

| PR                                                                  | Proposed update           | Local result                                                                                  |
| ------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------- |
| [#4](https://github.com/Swiph3l/synology-chatplus-desktop/pull/4)   | WinRT notifications 0.8.1 | Already integrated before this review; original branch is redundant.                          |
| [#5](https://github.com/Swiph3l/synology-chatplus-desktop/pull/5)   | TypeScript 7.0.2          | Applied; CLI usage remains compatible, with complete frontend tests/builds.                   |
| [#6](https://github.com/Swiph3l/synology-chatplus-desktop/pull/6)   | Windows 0.62.2            | Applied together with the native Tauri/WebView2 migration.                                    |
| [#8](https://github.com/Swiph3l/synology-chatplus-desktop/pull/8)   | WebView2 COM 0.39.1       | Applied in the same migration; separate ABI-family updates fail native compilation.           |
| [#11](https://github.com/Swiph3l/synology-chatplus-desktop/pull/11) | Checkout 7.0.1            | Applied using its verified immutable commit and retained credential/source guards.            |
| [#20](https://github.com/Swiph3l/synology-chatplus-desktop/pull/20) | Winreg 0.56.0             | Applied with two required `Vec<u8>` to `Cow<[u8]>` conversions in autostart code.             |
| [#26](https://github.com/Swiph3l/synology-chatplus-desktop/pull/26) | Setup Node 7.1.0          | Intended action update applied; its unrelated historical changes were not replayed.           |
| [#27](https://github.com/Swiph3l/synology-chatplus-desktop/pull/27) | Upload artifact 7.0.2     | Applied with explicit archive, overwrite and hidden-file policy.                              |
| [#28](https://github.com/Swiph3l/synology-chatplus-desktop/pull/28) | Download artifact 8.0.2   | Applied with a failing integrity-mismatch policy.                                             |
| [#29](https://github.com/Swiph3l/synology-chatplus-desktop/pull/29) | Node types 26.6.5         | Deferred: Node 22 remains supported and must not gain APIs available only in newer runtimes.  |
| [#30](https://github.com/Swiph3l/synology-chatplus-desktop/pull/30) | Tauri API 2.12.3          | Applied with native Tauri 2.12.5; the original 83-file historical diff was not replayed.      |
| [#31](https://github.com/Swiph3l/synology-chatplus-desktop/pull/31) | Vite 8.3.4                | Applied; the Rolldown/Oxc migration passed builds and provider-bootstrap checks.              |
| [#32](https://github.com/Swiph3l/synology-chatplus-desktop/pull/32) | Tauri CLI 2.12.1          | Applied with the synchronized framework; signing remains a separate release operation.        |
| [#35](https://github.com/Swiph3l/synology-chatplus-desktop/pull/35) | Minisign 0.10.0           | Applied to the development test dependency; actual signed HTTPS updater tests pass.           |
| [#36](https://github.com/Swiph3l/synology-chatplus-desktop/pull/36) | CodeQL 4.39.0             | Applied to both init and analyze; its original one-sided update caused the recorded failures. |

PR #30 contained nine commits and 83 changed files; #26 contained nine commits and
85 files. Both were conflicted against current main when inspected. A dependency
title or an older successful check is insufficient evidence to accept that entire
comparison. The focused changes were tested with the current provider milestone.

## Compatibility and recurring checks

The native interface graph is Tauri 2.12.5, runtime-wry 2.12.3, Wry 0.57.0,
WebView2 COM 0.39.1 and Windows 0.62.2. Tauri build/codegen/macros resolved to 2.7.4.
The JavaScript API is 2.12.3, matching the native minor as required by
[Tauri's dependency guidance](https://v2.tauri.app/develop/updating-dependencies/).

`npm run check:dependencies` now checks both manifests/lockfiles, the native test
declaration and the Windows/WebView interface family. It runs in CI, CodeQL,
security and release preparation. Regression cases cover the independent updates
that caused the reviewed incompatibilities, including a separate safe Windows
dependency behind an independent notification API.

Dependabot now groups the JavaScript Tauri pair, the native Tauri/Windows family
and GitHub Actions; routine compatible updates are grouped separately. This uses
[documented dependency grouping](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#groups--).
Cross-ecosystem Tauri changes still require the alignment check and joint review;
grouping does not authorize automatic merging. TypeScript/Vite major migrations
remain separately reviewable.

Node 22.23.4 and Node 24.13.0 both passed the frontend candidate. The Windows Node
22 job retains its existing release-gate name; a supplementary Ubuntu Node 24
frontend job was added. See the [action review](ACTIONS_DEPENDENCY_REVIEW_2026-10-23.md)
for exact immutable SHAs, the CodeQL failure evidence and artifact/signing guards.

## Security audit follow-up

The unchanged npm baseline had no reported vulnerabilities. The fresh official
RustSec database at `640bf5a9f06e66d8721e8772766531fe77c8630d` (2026-10-22) found
five blocking entries in the native lockfile, also present after the initial
framework migration:

- [RUSTSEC-2026-0382](https://rustsec.org/advisories/RUSTSEC-2026-0382):
  `rustls-webpki` 0.103.15; fixed from 0.103.16 on that stable line.
- [RUSTSEC-2026-0383](https://rustsec.org/advisories/RUSTSEC-2026-0383):
  `webpki-root-certs` 1.0.9; fixed from 1.0.10.
- [RUSTSEC-2026-0367](https://rustsec.org/advisories/RUSTSEC-2026-0367),
  [0368](https://rustsec.org/advisories/RUSTSEC-2026-0368), and
  [0369](https://rustsec.org/advisories/RUSTSEC-2026-0369):
  the updater's optional legacy `zip` 4.6.1 dependency; patched upstream ZIP
  versions start at 9.0.0. The supported update format here is signed raw NSIS EXE.

The final lock uses `rustls-webpki` 0.103.16 and `webpki-root-certs` 1.0.10.
Updater 2.14.0 explicitly retains Rustls and system-proxy support while disabling
its unused legacy ZIP feature, removing `zip` from the application lock entirely.
The supported signed raw NSIS format remains accepted; archive-wrapped Windows
manifests remain rejected. The bundled root-certificate license is byte-identical
to the new crate's license, so its redistribution text remains correct.

Legacy signatures remain accepted; a signed version, when present, must match the
manifest. New tests verify legacy-signature/tamper behavior, signed-version
mismatches and raw-installer versus archive-manifest policy. The existing
production-key verification was also run against previously published installers,
without executing or installing them. See [updater details](UPDATER.md).

No advisory ignore entries, reduced test coverage or weakened release gates were
introduced. npm audit and the whole-lock RustSec audit report zero vulnerabilities;
Windows cargo-deny passes advisory, license, source and dependency policies.
Existing transitive maintenance notices remain visible. The existing Linux-only
`glib` unsoundness still requires review and blocks Linux distribution; it is absent
from the Windows graph and its narrowly scoped existing policy was not changed.

## Final validation

| Check                                                          | Result                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| Clean npm install, formatting, dependency alignment, typecheck | Passed                                                          |
| Full JavaScript tests                                          | 347 passed, 0 failed                                            |
| Rust formatting and locked check                               | Passed                                                          |
| Full locked Rust tests                                         | 191 passed, 0 failed; production artifact case run separately   |
| Production public-key artifact verification                    | Published installer accepted; no execution/install              |
| npm audit / whole-lock cargo audit                             | Zero reported vulnerabilities                                   |
| Windows cargo-deny                                             | Advisories, licenses, sources and bans passed                   |
| Linux policy review                                            | Existing glib exception remains explicit; Linux release blocked |
| Native UI smoke check                                          | Pending: Computer Use helper unavailable (Windows error 2)      |
| GitHub-hosted CI                                               | Pending: local changes have not been pushed                     |

## Evidence and delivery boundaries

The optimized Windows application build passed, with no bundle, tag or release
created. The runnable artifact is `src-tauri/target/release/chatplus-desktop.exe`,
SHA-256 `BB6A879ED0D1F938672CA40C01EE01470AD8305AE32EC5A15B5C2C1721EE9329`.
It retains the existing isolated `reliability-20261022` QA profile. Exit an older
running instance through File → Quit before opening the new binary; a second
launch otherwise activates the old process.

Detailed snapshots, diffs, independent candidate logs and audit output are outside
Git under `E:\chatplus_synology_client\validation\pr-review-2026-10-23`.
No user profiles, authentication sessions or signing keys were accessed or reset.
No tag, release, push or remote merge was performed. Hosted checks have not run on
this unpublished working tree. Native provider/picker/notification smoke testing
remains necessary after the framework migration.
